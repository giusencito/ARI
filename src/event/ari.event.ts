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

      const audioBuffer = await this.ariService.getRecording(session.recordingName);
      this.logger.log(`Audio obtenido: ${audioBuffer.length} bytes`);

      const audioFile = this.createMulterFile(audioBuffer, session.recordingName);
      this.logger.log(`Archivo Multer creado: ${audioFile.originalname}`);

      this.logger.log(`Enviando audio al servicio confirmarPlaca...`);
      const confirmacion = await this.ivrService.confirmarPlaca(audioFile);
      this.logger.log(`Respuesta de confirmarPlaca: success=${confirmacion.success}, placa="${confirmacion.placa}"`);

      if (confirmacion.success) {
        session.setExtractedData(confirmacion.placa);
        this.logger.log(`Placa extraída: ${confirmacion.placa}`);

        await this.ariService.playAudioBuffer(channelId, confirmacion.audio);
      } else {
        this.logger.log(`No se pudo extraer placa`);
        await this.ariService.playAudioBuffer(channelId, confirmacion.audio);

        // Timeout configurable antes de volver a Asterisk
        const playbackTimeout = this.configService.get<number>(IVR_PLAYBACK_TIMEOUT) ?? 3000;
        setTimeout(() => this.returnToAsterisk(channelId), playbackTimeout);
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

      const audioBuffer = await this.ariService.getRecording(session.recordingName);
      const audioFile = this.createMulterFile(audioBuffer, session.recordingName);

      const confirmacion = await this.ivrService.confirmarPapeleta(audioFile);

      session.setExtractedData(confirmacion.placa);
      this.logger.log(`Papeleta extraída: ${confirmacion.placa}`);

      await this.ariService.playAudioBuffer(channelId, confirmacion.audio);

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
        session.confirm();
        await this.processConfirmedQuery(channelId, session);
      } else if (digit === '2') {
        session.reject();
        await this.returnToAsterisk(channelId);
      } else {
        this.logger.log(`Opción inválida: ${digit}, esperando 1 o 2`);
      }
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

      // Timeout configurable para que se reproduzca completamente
      const playbackTimeout = this.configService.get<number>(IVR_PLAYBACK_TIMEOUT) ?? 10000;
      setTimeout(() => this.returnToAsterisk(channelId), playbackTimeout);

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