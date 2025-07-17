import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AriService } from 'src/services/ari.service';
import { IVRService } from 'src/services/ivr.service';
import { ChannelSession } from 'src/dto/ChannelSession';
import {
  ARI_APPLICATION_NAME,
  ARI_PASSWORD,
  ARI_URL,
  ARI_USERNAME,
  IVR_FILE_WRITE_DELAY,
  IVR_PLAYBACK_TIMEOUT,
  IVR_SESSION_CLEANUP_INTERVAL,
  IVR_WEBSOCKET_RECONNECT_DELAY,
  IVR_AUDIO_SAFETY_MARGIN,
} from 'src/shared/Constants';
import * as WebSocket from 'ws';

@Injectable()
export class AriEvent implements OnModuleInit {
  private ws: WebSocket;
  private readonly logger = new Logger(AriEvent.name);

  // Map para guardar información de cada llamada activa
  private activeChannels = new Map<string, ChannelSession>();

  private isConnected: boolean = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;


  constructor(
    private readonly configService: ConfigService,
    private readonly ariService: AriService,
    private readonly ivrService: IVRService,
  ) {}

  onModuleInit() {
    this.connectToARI();

    // Limpiar sesiones expiradas - intervalo configurable
    const cleanupInterval = this.configService.get<number>(IVR_SESSION_CLEANUP_INTERVAL) ?? 300000; // 5 min default
    setInterval(() => this.cleanExpiredSessions(), cleanupInterval);
  }

  /**
   * Conectar al WebSocket de Asterisk
   */
  private connectToARI() {
    const ariApp = this.configService.get<string>(ARI_APPLICATION_NAME);
    const ariUrl = this.configService.get<string>(ARI_URL);
    const ariUser = this.configService.get<string>(ARI_USERNAME);
    const ariPass = this.configService.get<string>(ARI_PASSWORD);

    const wsUrl = `${ariUrl}/events?api_key=${ariUser}:${ariPass}&app=${ariApp}`;

    this.logger.log(`🔗 Conectando WebSocket ARI: ${wsUrl.replace(ariPass || '', '***')}`);

    this.ws = new WebSocket(wsUrl, {
      rejectUnauthorized: false,
      // Configuración básica para estabilidad
      handshakeTimeout: 30000,
      headers: {
        'Connection': 'keep-alive'
      }
    });

    this.ws.on('open', () => {
      this.logger.log('WebSocket ARI CONECTADO - Aplicación mi_ari_app registrada');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.startHeartbeat();
    });

    this.ws.on('message', async (data) => {
      try {
        const event = JSON.parse(data.toString());
        await this.handleAriEvent(event);
      } catch (err) {
        this.logger.error('Error al parsear evento WebSocket:', err.message);
      }
    });

    this.ws.on('close', (code, reason) => {
      this.logger.error(`WebSocket ARI CERRADO - Code: ${code}, Reason: ${reason}`);
      this.isConnected = false;
      this.stopHeartbeat();
      this.handleReconnect();
    });

    this.ws.on('error', (err) => {
      this.logger.error(`🚨 WebSocket ERROR: ${err.message}`);
      this.isConnected = false;
    });

    // Responder a pings de Asterisk
    this.ws.on('ping', () => {
      this.ws.pong();
    });
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.logger.debug(' Heartbeat - Conexión ARI activa');
        this.ws.ping();
      } else {
        this.logger.warn(' WebSocket no está abierto - Reconectando');
        this.handleReconnect();
      }
    }, 30000); // Ping cada 30 segundos
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private handleReconnect() {
    if (this.reconnectAttempts < 5) {
      this.reconnectAttempts++;
      const delay = 2000 * this.reconnectAttempts; // 2s, 4s, 6s, 8s, 10s

      this.logger.warn(`Reconexión ${this.reconnectAttempts}/5 en ${delay}ms`);

      setTimeout(() => {
        this.connectToARI();
      }, delay);
    } else {
      this.logger.error('MÁXIMO DE REINTENTOS ALCANZADO - Esperando 5 minutos');

      // Resetear después de 30 segundos
      setTimeout(() => {
        this.reconnectAttempts = 0;
        this.connectToARI();
      }, 30000);
    }
  }

  public isWebSocketConnected(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }


  /**
   * Distribuir eventos de Asterisk
   */
  private async handleAriEvent(event: any) {
    this.logger.log(`Evento ARI: ${event.type} - Canal: ${event.channel?.id}`);

    switch (event.type) {
      case 'StasisStart':
        await this.handleStasisStart(event);
        break;
      case 'StasisEnd':
        await this.handleStasisEnd(event);
        break;
      case 'RecordingFinished':
        await this.handleRecordingFinished(event);
        break;
      case 'ChannelDtmfReceived':
        await this.handleDtmfReceived(event);
        break;
      default:
        this.logger.log(`Evento ignorado: ${event.type}`);
    }
  }

  /**
   * Llamada llega desde Asterisk
   */
  private async handleStasisStart(event: any) {
    const channelId = event.channel.id;
    const channelName = event.channel.name;
    const args = event.args;

    this.logger.log(`Nueva llamada - Canal: ${channelName} (${channelId})`);
    this.logger.log(`Tipo de consulta: ${args[0]}`);

    // Crear sesión para recordar qué está pasando
    const session = new ChannelSession(channelId);
    this.activeChannels.set(channelId, session);

    if (args && args.length > 0) {
      const consultType = args[0];

      if (consultType === 'placa') {
        await this.startPlacaFlow(channelId, session);
      } else if (consultType === 'papeleta') {
        await this.startPapeletaFlow(channelId, session);
      } else {
        this.logger.warn(`Tipo de consulta desconocido: ${consultType}`);
        await this.returnToAsterisk(channelId);
      }
    } else {
      this.logger.warn('No se recibieron argumentos en StasisStart');
      await this.returnToAsterisk(channelId);
    }
  }

  /**
   * Iniciar flujo de PLACA
   */
  private async startPlacaFlow(channelId: string, session: ChannelSession) {
    try {
      this.logger.log(`Iniciando consulta de PLACA para canal ${channelId}`);

      const recordingName = `placa_${channelId}_${Date.now()}`;
      session.startRecording('placa', recordingName);

      await this.ariService.recordChannel(channelId, recordingName);
      this.logger.log(`Grabación iniciada: ${recordingName}`);

    } catch (error) {
      this.logger.error(`Error iniciando flujo placa: ${error.message}`);
      await this.returnToAsterisk(channelId);
    }
  }

  /**
   * Iniciar flujo de PAPELETA
   */
  private async startPapeletaFlow(channelId: string, session: ChannelSession) {
    try {
      this.logger.log(`Iniciando consulta de PAPELETA para canal ${channelId}`);

      const recordingName = `papeleta_${channelId}_${Date.now()}`;
      session.startRecording('papeleta', recordingName);

      await this.ariService.recordChannel(channelId, recordingName);
      this.logger.log(`Grabación iniciada: ${recordingName}`);

    } catch (error) {
      this.logger.error(`Error iniciando flujo papeleta: ${error.message}`);
      await this.returnToAsterisk(channelId);
    }
  }

  /**
   * Grabación terminó - procesar con STT
   */
  private async handleRecordingFinished(event: any) {
    const recordingName = event.recording.name;

    // Buscar a qué canal pertenece esta grabación
    let targetChannelId = '';
    let session: ChannelSession | undefined;

    for (const [channelId, sess] of this.activeChannels.entries()) {
      if (sess.recordingName === recordingName) {
        targetChannelId = channelId;
        session = sess;
        break;
      }
    }

    if (!session) {
      this.logger.warn(`No se encontró sesión para grabación: ${recordingName}`);
      return;
    }

    this.logger.log(`Grabación terminada: ${recordingName} para canal ${targetChannelId}`);

    try {
      // Delay configurable para que el archivo se escriba completamente
      const writeDelay = this.configService.get<number>(IVR_FILE_WRITE_DELAY) ?? 1000;
      await new Promise(resolve => setTimeout(resolve, writeDelay));

      if (session.consultType === 'placa') {
        await this.processPlacaRecording(targetChannelId, session);
      } else if (session.consultType === 'papeleta') {
        await this.processPapeletaRecording(targetChannelId, session);
      }
    } catch (error) {
      this.logger.error(`Error procesando grabación: ${error.message}`);
      await this.returnToAsterisk(targetChannelId);
    }
  }

  /**
   * Procesar grabación de PLACA
   */
  private async processPlacaRecording(channelId: string, session: ChannelSession) {
    try {
      this.logger.log(`Procesando audio de placa para canal ${channelId}`);

      // 1. Mover archivo desde /var/spool/asterisk/recording/ a /tmp/asterisk/stt/
      await this.ariService.moveRecordingToSTTDirectory(session.recordingName);
      this.logger.log(`Archivo movido a /tmp/asterisk/stt/: ${session.recordingName}`);

      // 2. Descargar desde /tmp/asterisk/stt/
      const audioBuffer = await this.ariService.getRecording(session.recordingName);
      this.logger.log(`Audio obtenido: ${audioBuffer.length} bytes`);

      const audioFile = this.createMulterFile(audioBuffer, session.recordingName);
      this.logger.log(`Archivo Multer creado: ${audioFile.originalname}`);

      this.logger.log(`Enviando audio al servicio confirmarPlaca...`);
      const confirmacion = await this.ivrService.confirmarPlaca(audioFile);
      this.logger.log(`Respuesta de confirmarPlaca: success=${confirmacion.success}, placa="${confirmacion.placa}"`);

      if (confirmacion.success) {
        // STT exitoso - proceder con confirmación
        session.setExtractedData(confirmacion.placa);
        this.logger.log(`Placa extraída: ${confirmacion.placa}`);

        const result = await this.ariService.playAudioBuffer(channelId, confirmacion.audio);

      } else {
        // Lógica de reintento similar a processPlacaRecording
        if (!session.retryCount) {
          session.retryCount = 0;
        }
        session.retryCount++;

        if (session.retryCount < 3) {
          this.logger.log(`Intento ${session.retryCount} de 3 para papeleta`);

          // Audio predefinido: "La placa no fue detectada, intente de nuevo"
          const errorResult = await this.ariService.playPredefinedAudio(channelId, 'tts_error_placa.wav');

          await new Promise(resolve => setTimeout(resolve, errorResult.estimatedDurationMs + 500));
          await this.restartRecording(channelId, session);
        } else {
          // Audio predefinido: "Se ha alcanzado el máximo de intentos..."
          const maxAttemptsResult = await this.ariService.playPredefinedAudio(channelId, 'tts_maximo_intentos');

          // Calcular tiempo de espera con validación
          const audioDurationMs = Number(maxAttemptsResult.estimatedDurationMs);
          const safetyMarginMs = Number(this.configService.get<number>('IVR_AUDIO_SAFETY_MARGIN') ?? 3000);
          const totalWaitTime = audioDurationMs + safetyMarginMs;

          this.logger.log(`Esperando ${totalWaitTime}ms antes de devolver a retornoivr`);

          setTimeout(() => {
            this.returnToIVRContext(channelId, 'retornoivr', 's', 1);
          }, totalWaitTime);
        }
      }

    } catch (error) {
      this.logger.error(`Error en processPlacaRecording: ${error.message}`);
      this.logger.error(`Stack trace: ${error.stack}`);
      throw error;
    }
  }

  /**
   * Procesar grabación de PAPELETA
   */
  private async processPapeletaRecording(channelId: string, session: ChannelSession) {
    try {
      this.logger.log(`Procesando audio de papeleta para canal ${channelId}`);

      // 1. Mover archivo desde /var/spool/asterisk/recording/ a /tmp/asterisk/stt/
      await this.ariService.moveRecordingToSTTDirectory(session.recordingName);
      this.logger.log(`Archivo movido a /tmp/asterisk/stt/: ${session.recordingName}`);

      // 2. Descargar desde /tmp/asterisk/stt/
      const audioBuffer = await this.ariService.getRecording(session.recordingName);
      const audioFile = this.createMulterFile(audioBuffer, session.recordingName);

      const confirmacion = await this.ivrService.confirmarPapeleta(audioFile);

      if (confirmacion.success) {
        session.setExtractedData(confirmacion.placa);
        this.logger.log(`Papeleta extraída: ${confirmacion.placa}`);

        const result = await this.ariService.playAudioBuffer(channelId, confirmacion.audio);

      } else {
        // Lógica de reintento similar a processPlacaRecording
        if (!session.retryCount) {
          session.retryCount = 0;
        }
        session.retryCount++;

        if (session.retryCount < 3) {
          this.logger.log(`Intento ${session.retryCount} de 3 para papeleta`);

          const errorResult = await this.ariService.playPredefinedAudio(channelId, 'tts_error_papeleta.wav');

          await new Promise(resolve => setTimeout(resolve, errorResult.estimatedDurationMs + 500));
          await this.restartRecording(channelId, session);
        } else {
          const maxAttemptsResult = await this.ariService.playPredefinedAudio(channelId, 'tts_maximo_intentos');

          // Calcular tiempo de espera con validación
          const audioDurationMs = Number(maxAttemptsResult.estimatedDurationMs);
          const safetyMarginMs = Number(this.configService.get<number>(IVR_AUDIO_SAFETY_MARGIN) ?? 3000);
          const totalWaitTime = audioDurationMs + safetyMarginMs;

          this.logger.log(`Esperando ${totalWaitTime}ms antes de devolver a retornoivr`);

          setTimeout(() => {
            this.returnToIVRContext(channelId, 'retornoivr', 's', 1);
          }, totalWaitTime);
        }
      }

    } catch (error) {
      this.logger.error(`Error procesando papeleta: ${error.message}`);
      await this.returnToAsterisk(channelId);
    }
  }

  /**
   * Usuario presiona 1 o 2 para confirmar
   */
  private async handleDtmfReceived(event: any) {
    const channelId = event.channel.id;
    const digit = event.digit;
    const session = this.activeChannels.get(channelId);

    if (!session) {
      this.logger.warn(`Sesión no encontrada para DTMF en canal: ${channelId}`);
      return;
    }

    this.logger.log(`DTMF recibido: "${digit}" en canal: ${channelId}, estado: ${session.currentState}`);

    if (session.currentState === 'waiting_confirmation') {
      if (digit === '1') {
        // Confirmar - continuar con consulta
        session.confirm();
        await this.processConfirmedQuery(channelId, session);
      } else if (digit === '2') {
        // Rechazar - volver a grabar
        this.logger.log(`Usuario rechazó confirmación para ${session.consultType}, reiniciando grabación`);
        session.reject();
        await this.restartRecording(channelId, session);
      } else {
        // Opción inválida - reproducir instrucción de nuevo
        this.logger.log(`Opción inválida: ${digit}, reproduciendo instrucciones nuevamente`);
        await this.playInvalidOptionMessage(channelId, session);
      }
    }
  }

  /**
   * Reiniciar grabación cuando usuario rechaza confirmación
   */
  private async restartRecording(channelId: string, session: ChannelSession) {
    try {
      this.logger.log(`Reiniciando grabación para ${session.consultType} en canal ${channelId}`);

      const audioName = session.consultType === 'placa'
        ? 'tts_reintento_placa.wav'
        : 'tts_reintento_papeleta.wav';

      const playbackResult = await this.ariService.playPredefinedAudio(channelId, audioName);

      // Esperar que termine de reproducirse + margen pequeño
      await new Promise(resolve => setTimeout(resolve, playbackResult.estimatedDurationMs + 500));

      // Generar nuevo nombre de grabación
      const newRecordingName = `${session.consultType}_${channelId}_${Date.now()}_retry`;

      // Actualizar sesión
      session.startRecording(session.consultType as 'placa' | 'papeleta', newRecordingName);

      // Iniciar nueva grabación
      await this.ariService.recordChannel(channelId, newRecordingName);

      this.logger.log(`Nueva grabación iniciada: ${newRecordingName}`);

    } catch (error) {
      this.logger.error(`Error reiniciando grabación: ${error.message}`);
      await this.returnToAsterisk(channelId);
    }
  }

  /**
   * Reproducir mensaje de opción inválida
   */
  private async playInvalidOptionMessage(channelId: string, session: ChannelSession) {
    try {
      const invalidMessage = `Opción inválida. Confirme que la ${session.consultType} es ${session.extractedData}. Marque 1 para confirmar o 2 para volver a intentar`;

      const invalidAudio = await this.ivrService.ResponseTTS(invalidMessage);

      const result = await this.ariService.playAudioBuffer(channelId, invalidAudio);

      // Mantener el estado para esperar nueva confirmación
      this.logger.log(`Esperando confirmación válida (1 o 2) para canal ${channelId}`);

    } catch (error) {
      this.logger.error(`Error reproduciendo mensaje de opción inválida: ${error.message}`);
      await this.returnToAsterisk(channelId);
    }
  }

  /**
   * Usuario confirmó - hacer consulta SAT y dar resultado + volver al IVR
   */
  private async processConfirmedQuery(channelId: string, session: ChannelSession) {
    try {
      this.logger.log(`Consulta confirmada para ${session.consultType}: ${session.extractedData}`);

      let resultAudio: Buffer;

      if (session.consultType === 'placa') {
        resultAudio = await this.ivrService.placaInfo(session.extractedData);
      } else if (session.consultType === 'papeleta') {
        resultAudio = await this.ivrService.papeletaInfo(session.extractedData);
      } else {
        throw new Error(`Tipo de consulta desconocido: ${session.consultType}`);
      }

      // Reproducir resultado - playAudioBuffer retorna duración calculada
      const playbackResult = await this.ariService.playAudioBuffer(channelId, resultAudio);
      this.logger.log(`Resultado reproducido para canal ${channelId}`);

      // Calcular tiempo de espera basado en duración real del audio + margen de seguridad
      const audioDurationMs = Number(playbackResult.estimatedDurationMs);
      const safetyMarginMs = Number(this.configService.get<number>('IVR_AUDIO_SAFETY_MARGIN') ?? 3000);
      const totalWaitTime = audioDurationMs + safetyMarginMs;

      // Validación de seguridad: máximo 30 segundos
      const maxWaitTime = 30000;
      const finalWaitTime = Math.min(totalWaitTime, maxWaitTime);

      if (totalWaitTime !== finalWaitTime) {
        this.logger.warn(`Tiempo de espera reducido de ${totalWaitTime}ms a ${finalWaitTime}ms por seguridad`);
      }

      this.logger.log(`Esperando ${finalWaitTime}ms (audio: ${audioDurationMs}ms + margen: ${safetyMarginMs}ms)`);

      setTimeout(() => {
        // Devolver al contexto retornoivr para que maneje el menú post-consulta
        this.returnToIVRContext(channelId, 'retornoivr', 's', 1);
      }, finalWaitTime);

    } catch (error) {
      this.logger.error(`Error en consulta confirmada: ${error.message}`);
      await this.returnToAsterisk(channelId);
    }
  }

  /**
   * Llamada terminó - limpiar sesión
   */
  private async handleStasisEnd(event: any) {
    const channelId = event.channel.id;
    this.logger.log(`Llamada finalizada - Canal: ${channelId}`);

    this.activeChannels.delete(channelId);
  }

  /**
   * Devolver llamada a Asterisk y limpiar sesión
   */
  private async returnToAsterisk(channelId: string) {
    try {
      this.logger.log(`Devolviendo canal ${channelId} a Asterisk`);

      await this.ariService.exitStasisApp(channelId);
      this.activeChannels.delete(channelId);

    } catch (error) {
      this.logger.error(`Error devolviendo a Asterisk: ${error.message}`);
      this.activeChannels.delete(channelId);
    }
  }

  /**
   * Devolver llamada a contexto específico del IVR
   */
  private async returnToIVRContext(channelId: string, context: string, extension: string = 's', priority: number = 1) {
    try {
      this.logger.log(`Devolviendo canal ${channelId} a contexto IVR: ${context}`);

      await this.ariService.exitStasisApp(channelId, context, extension, priority);
      this.activeChannels.delete(channelId);

    } catch (error) {
      this.logger.error(`Error devolviendo a contexto IVR: ${error.message}`);
      // Fallback al método original
      await this.returnToAsterisk(channelId);
    }
  }

  /**
   * Crear objeto File compatible con servicios existentes
   */
  private createMulterFile(buffer: Buffer, filename: string): Express.Multer.File {
    const { Readable } = require('stream');
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    return {
      buffer: buffer,
      originalname: filename,
      mimetype: 'audio/wav',
      fieldname: 'audio',
      encoding: '7bit',
      size: buffer.length,
      stream: stream,
      destination: '',
      filename: filename,
      path: ''
    } as Express.Multer.File;
  }

  /**
   * Limpiar sesiones expiradas
   */
  private cleanExpiredSessions() {
    let cleaned = 0;
    for (const [channelId, session] of this.activeChannels.entries()) {
      if (session.isExpired()) {
        this.activeChannels.delete(channelId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.log(`Limpiadas ${cleaned} sesiones expiradas`);
    }
  }
}