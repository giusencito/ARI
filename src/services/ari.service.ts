import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  ARI_APPLICATION_NAME,
  ARI_PASSWORD,
  ARI_URL,
  ARI_USERNAME,
  ASTERISK_RECORDINGS_URL,
  ASTERISK_UPLOAD_URL,
  ASTERISK_API_KEY,
  ASTERISK_RECORDINGS_FORMAT,
  TEMP_AUDIO_DIR,
  TEMP_FILE_CLEANUP_TIMEOUT,
  RECORDING_MAX_DURATION,
  RECORDING_MAX_SILENCE,
  RECORDING_FORMAT,
  RECORDING_BEEP_ENABLED,
  RECORDING_IF_EXISTS,
} from 'src/shared/Constants';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { AesterisitkDTO } from 'src/dto/AesterisitkDTO';

@Injectable()
export class AriService {
  private readonly logger = new Logger(AriService.name);
  private client: AxiosInstance;
  private readonly baseUrl: string;
  private readonly tempDir: string;

  constructor(private readonly configService: ConfigService) {
    const username = this.configService.get<string>(ARI_USERNAME) ?? '';
    const password = this.configService.get<string>(ARI_PASSWORD) ?? '';
    this.baseUrl = this.configService.get<string>(ARI_URL) ?? '';

    // Configurar directorio temporal
    this.tempDir = this.configService.get<string>(TEMP_AUDIO_DIR) ?? './temp/audio';
    this.ensureTempDirectory();

    this.client = axios.create({
      baseURL: this.baseUrl,
      auth: { username, password },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
  }

  private ensureTempDirectory() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
      this.logger.log(`Directorio temporal creado: ${this.tempDir}`);
    }
  }

  async getChannels(): Promise<any[]> {
    try {
      const response = await this.client.get('/channels');
      return response.data;
    } catch (error) {
      throw new InternalServerErrorException(
        `Channels Error ${error.statusCode}`,
      );
    }
  }

  async getBridges(): Promise<any[]> {
    try {
      const response = await this.client.get('/bridges');
      return response.data;
    } catch (error) {
      throw new InternalServerErrorException(
        `Bridges Error ${error.statusCode}`,
      );
    }
  }

  async getEnpoints(): Promise<any[]> {
    try {
      const response = await this.client.get('/endpoints');
      return response.data;
    } catch (error) {
      throw new InternalServerErrorException(
        `Endpoints Error ${error.statusCode}`,
      );
    }
  }

  async getAsteriskInfo(): Promise<AesterisitkDTO> {
    try {
      const response = await this.client.get('/asterisk/info');
      return response.data;
    } catch (error) {
      throw new InternalServerErrorException(
        `AsterikInfo Error ${error.statusCode}`,
      );
    }
  }

  async recordChannel(channelId: string, name: string): Promise<any> {
    const maxDuration = this.configService.get<number>(RECORDING_MAX_DURATION) ?? 10;
    const maxSilence = this.configService.get<number>(RECORDING_MAX_SILENCE) ?? 2;
    const format = this.configService.get<string>(RECORDING_FORMAT) ?? 'wav';
    const beep = this.configService.get<boolean>(RECORDING_BEEP_ENABLED) ?? true;
    const ifExists = this.configService.get<string>(RECORDING_IF_EXISTS) ?? 'overwrite';

    const response = await this.client.post(
      `/channels/${channelId}/record`,
      null,
      {
        params: {
          name,
          format,
          maxDurationSeconds: maxDuration,
          maxSilenceSeconds: maxSilence,
          beep,
          ifExists,
        },
      },
    );

    this.logger.log(`Grabacion iniciada: ${name} (${maxDuration}s max, ${maxSilence}s silence)`);
    return response.data;
  }

  async snoopChannel(channelId: string): Promise<any> {
    const snoopId = `snoop_${channelId}_${Date.now()}`;
    const response = await this.client.post(
      `/channels/${channelId}/snoop`,
      null,
      {
        params: {
          snoopId,
          whisper: 'out',
          app: this.configService.get<string>(ARI_APPLICATION_NAME) ?? '',
        },
      },
    );

    this.logger.log(`Snoop iniciado: ${snoopId}`);
    return response.data;
  }

  async playToChannel(channelId: string, mediaId: string): Promise<any> {
    const response = await this.client.post(
      `/channels/${channelId}/play`,
      null,
      {
        params: {
          media: `sound:${mediaId}`,
        },
      },
    );

    this.logger.log(`Reproduccion iniciada: ${mediaId} en canal ${channelId}`);
    return response.data;
  }

  async exitStasisApp(channelId: string, context?: string, extension?: string, priority?: number): Promise<any> {
    try {
      const response = await this.client.delete(`/channels/${channelId}`);

      this.logger.log(`Canal ${channelId} devuelto a Asterisk (método original)`);
      return response.data;

    } catch (error) {
      this.logger.error(`Error devolviendo canal: ${error.message}`);
      throw error;
    }
  }

  async getRecording(recordingName: string): Promise<Buffer> {
    try {
      const recordingsUrl = this.configService.get<string>(ASTERISK_RECORDINGS_URL) ?? 'http://localhost:8001';
      const format = this.configService.get<string>(ASTERISK_RECORDINGS_FORMAT) ?? 'wav';
      const apiKey = this.configService.get<string>(ASTERISK_API_KEY) ?? 'dev-asterisk-key-12345';

      const url = `${recordingsUrl}/${recordingName}.${format}`;

      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      const audioBuffer = Buffer.from(response.data);
      this.logger.log(`Grabacion descargada desde ${url}: ${audioBuffer.length} bytes`);
      return audioBuffer;

    } catch (error) {
      this.logger.error(`Error descargando grabacion: ${error.message}`);
      throw new InternalServerErrorException(`Get Recording Error: ${error.message}`);
    }
  }

  async stopRecording(recordingName: string): Promise<any> {
    try {
      this.logger.log(`Deteniendo grabacion: ${recordingName}`);

      const response = await this.client.delete(`/recordings/live/${recordingName}`);

      this.logger.log(`Grabacion ${recordingName} detenida`);
      return response.data;
    } catch (error) {
      this.logger.error(`Error deteniendo grabacion: ${error.message}`);
      throw new InternalServerErrorException(
        `Stop Recording Error: ${error.message}`
      );
    }
  }

  async playAudioBuffer(channelId: string, audioBuffer: Buffer, playbackId?: string): Promise<any> {
    try {
      // 1. Generar nombre único para el archivo
      const filename = `tts_${channelId}_${Date.now()}.wav`;

      // 2. Subir archivo al servidor Asterisk (se convierte automáticamente a 8000Hz)
      await this.uploadAudioToAsterisk(audioBuffer, filename);

      // 3. Reproducir desde el servidor Asterisk usando ruta absoluta
      const finalPlaybackId = playbackId || `tts-${Date.now()}`;

      const response = await this.client.post(
        `/channels/${channelId}/play/${finalPlaybackId}`,
        null,
        {
          params: {
            // Usar ruta absoluta sin extensión (Asterisk la agrega automáticamente)
            media: `sound:/var/spool/asterisk/recording/${filename.replace('.wav', '')}`
          }
        }
      );

      this.logger.log(`Audio iniciado en canal ${channelId} con ID: ${finalPlaybackId}`);
      this.logger.log(`Reproduciendo archivo: ${filename} (convertido a 8000Hz)`);

      // 4. Programar limpieza del archivo en el servidor Asterisk (opcional)
      const cleanupTimeout = this.configService.get<number>(TEMP_FILE_CLEANUP_TIMEOUT) ?? 30000;
      setTimeout(() => {
        this.cleanupAsteriskFile(filename).catch(err =>
          this.logger.warn(`No se pudo limpiar archivo ${filename}: ${err.message}`)
        );
      }, cleanupTimeout);

      return response.data;

    } catch (error) {
      this.logger.error(`Error reproduciendo audio: ${error.message}`);
      throw new InternalServerErrorException(
        `Play Audio Error: ${error.message}`
      );
    }
  }

  /**
   * Subir archivo de audio al servidor Asterisk
   * El servidor automáticamente convierte el audio a formato compatible (8000Hz)
   */
  private async uploadAudioToAsterisk(audioBuffer: Buffer, filename: string): Promise<void> {
    try {
      const uploadUrl = this.configService.get<string>(ASTERISK_UPLOAD_URL) ?? 'http://localhost:8001/upload';
      const apiKey = this.configService.get<string>(ASTERISK_API_KEY) ?? 'dev-asterisk-key-12345';

      this.logger.log(`Subiendo archivo TTS: ${filename} (${audioBuffer.length} bytes)`);

      const response = await axios.post(uploadUrl, audioBuffer, {
        headers: {
          'Content-Type': 'audio/wav',
          'Filename': filename,
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 15000
      });

      if (response.data && response.data.status === 'success') {
        this.logger.log(`Archivo subido y convertido exitosamente: ${filename}`);
        this.logger.log(`Tamaño original: ${response.data.original_size}, convertido: ${response.data.converted_size}`);
      } else {
        this.logger.log(`Archivo subido: ${filename}`);
      }

    } catch (error) {
      this.logger.error(`Error subiendo archivo a Asterisk: ${error.message}`);
      if (error.response?.status === 401) {
        this.logger.error(`Error de autenticación: Verificar ASTERISK_API_KEY`);
      }
      if (error.response?.data) {
        this.logger.error(`Respuesta del servidor: ${JSON.stringify(error.response.data)}`);
      }
      throw new InternalServerErrorException(`Upload to Asterisk failed: ${error.message}`);
    }
  }

  /**
   * Limpiar archivo temporal del servidor Asterisk
   * Nota: El servidor HTTP actual no soporta DELETE, así que esto es opcional
   */
  private async cleanupAsteriskFile(filename: string): Promise<void> {
    try {
      const baseUrl = this.configService.get<string>(ASTERISK_RECORDINGS_URL) ?? 'http://localhost:8001';

      // Intentar eliminar archivo via DELETE (si el servidor lo soporta en el futuro)
      await axios.delete(`${baseUrl}/${filename}`, {
        timeout: 5000
      });

      this.logger.log(`Archivo temporal eliminado del servidor Asterisk: ${filename}`);

    } catch (error) {
      // No es crítico si falla la limpieza
      this.logger.debug(`No se pudo eliminar archivo temporal (esto es normal): ${error.message}`);
    }
  }

  /**
   * Verificar estado del servidor Asterisk
   */
  async checkAsteriskServerStatus(): Promise<any> {
    try {
      const baseUrl = this.configService.get<string>(ASTERISK_RECORDINGS_URL) ?? 'http://localhost:8001';
      const apiKey = this.configService.get<string>(ASTERISK_API_KEY) ?? 'dev-asterisk-key-12345';

      const response = await axios.get(`${baseUrl}/status`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 5000
      });

      this.logger.log(`Estado del servidor Asterisk: ${response.data.status}`);
      this.logger.log(`Versión: ${response.data.version}`);
      this.logger.log(`Seguridad habilitada: ${response.data.security?.authentication}`);

      return response.data;

    } catch (error) {
      this.logger.warn(`No se pudo verificar estado del servidor Asterisk: ${error.message}`);
      return null;
    }
  }
}