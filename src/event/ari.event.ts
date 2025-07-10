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
} from 'src/shared/Constants';
import * as WebSocket from 'ws';

@Injectable()
export class AriEvent implements OnModuleInit {
  private ws: WebSocket;
  private readonly logger = new Logger(AriEvent.name);

  // Map para guardar información de cada llamada activa
  private activeChannels = new Map<string, ChannelSession>();

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

    this.logger.log(`Conectando a ARI WebSocket: ${wsUrl}`);

    this.ws = new WebSocket(wsUrl, {
      rejectUnauthorized: false
    });

    this.ws.on('open', () => {
      this.logger.log('Conectado al WebSocket de ARI - Listo para recibir llamadas');
    });

    this.ws.on('message', async (data) => {
      try {
        const event = JSON.parse(data.toString());
        await this.handleAriEvent(event);
      } catch (err) {
        this.logger.error('Error al parsear evento WebSocket:', err.message);
      }
    });

    this.ws.on('error', (err) => {
      this.logger.error('Error WebSocket ARI:', err.message);
    });

    this.ws.on('close', () => {
      this.logger.warn('Conexión WebSocket ARI cerrada. Reconectando...');
      const reconnectDelay = this.configService.get<number>(IVR_WEBSOCKET_RECONNECT_DELAY) ?? 5000;
      setTimeout(() => this.connectToARI(), reconnectDelay);
    });
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

        await this.ariService.playAudioBuffer(channelId, confirmacion.audio);

      } else {
        // STT falló - ofrecer reintento
        this.logger.log(`No se pudo extraer placa, ofreciendo reintento`);

        // Incrementar contador de reintentos
        if (!session.retryCount) {
          session.retryCount = 0;
        }
        session.retryCount++;

        // Máximo 3 intentos
        if (session.retryCount <= 3) {
          this.logger.log(`Intento ${session.retryCount} de 3`);

          // Reproducir mensaje de error + reintento
          await this.ariService.playAudioBuffer(channelId, confirmacion.audio);

          // Esperar y reiniciar grabación
          await new Promise(resolve => setTimeout(resolve, 2000));
          await this.restartRecording(channelId, session);
        } else {
          // Máximo de intentos alcanzado
          this.logger.log(`Máximo de intentos alcanzado para canal ${channelId}`);

          const maxAttemptsMessage = 'Se ha alcanzado el máximo de intentos. La llamada será transferida a un operador';
          const maxAttemptsAudio = await this.ivrService.ResponseTTS(maxAttemptsMessage);
          await this.ariService.playAudioBuffer(channelId, maxAttemptsAudio);

          // Esperar y finalizar
          const playbackTimeout = this.configService.get<number>(IVR_PLAYBACK_TIMEOUT) ?? 5000;
          setTimeout(() => this.returnToAsterisk(channelId), playbackTimeout);
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

        await this.ariService.playAudioBuffer(channelId, confirmacion.audio);

      } else {
        // Lógica de reintento similar a processPlacaRecording
        if (!session.retryCount) {
          session.retryCount = 0;
        }
        session.retryCount++;

        if (session.retryCount <= 3) {
          this.logger.log(`Intento ${session.retryCount} de 3 para papeleta`);

          await this.ariService.playAudioBuffer(channelId, confirmacion.audio);

          await new Promise(resolve => setTimeout(resolve, 2000));
          await this.restartRecording(channelId, session);
        } else {
          const maxAttemptsMessage = 'Se ha alcanzado el máximo de intentos. La llamada será transferida a un operador';
          const maxAttemptsAudio = await this.ivrService.ResponseTTS(maxAttemptsMessage);
          await this.ariService.playAudioBuffer(channelId, maxAttemptsAudio);

          const playbackTimeout = this.configService.get<number>(IVR_PLAYBACK_TIMEOUT) ?? 5000;
          setTimeout(() => this.returnToAsterisk(channelId), playbackTimeout);
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

      // Reproducir mensaje de reintento
      const retryMessage = session.consultType === 'placa'
        ? 'Por favor, diga nuevamente su placa vehicular'
        : 'Por favor, diga nuevamente su número de papeleta';

      const retryAudio = await this.ivrService.ResponseTTS(retryMessage);
      await this.ariService.playAudioBuffer(channelId, retryAudio);

      // Esperar un momento para que se reproduzca
      await new Promise(resolve => setTimeout(resolve, 2000));

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
      await this.ariService.playAudioBuffer(channelId, invalidAudio);

      // Mantener el estado para esperar nueva confirmación
      this.logger.log(`Esperando confirmación válida (1 o 2) para canal ${channelId}`);

    } catch (error) {
      this.logger.error(`Error reproduciendo mensaje de opción inválida: ${error.message}`);
      await this.returnToAsterisk(channelId);
    }
  }

  /**
   * Usuario confirmó - hacer consulta SAT y dar resultado
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

      await this.ariService.playAudioBuffer(channelId, resultAudio);
      this.logger.log(`Resultado reproducido para canal ${channelId}`);

      // Nota: Los archivos en /tmp/asterisk/ se limpian automáticamente por el OS

      // Timeout configurable para que se reproduzca completamente
      const playbackTimeout = this.configService.get<number>(IVR_PLAYBACK_TIMEOUT) ?? 10000;
      setTimeout(() => {
        this.returnToIVRContext(channelId, 'retornoivr3');
      }, playbackTimeout);

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