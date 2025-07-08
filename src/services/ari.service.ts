import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  ARI_APPLICATION_NAME,
  ARI_PASSWORD,
  ARI_URL,
  ARI_USERNAME,
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
  constructor(private readonly configService: ConfigService) {
    const username = this.configService.get<string>(ARI_USERNAME) ?? '';
    const password = this.configService.get<string>(ARI_PASSWORD) ?? '';
    this.baseUrl = this.configService.get<string>(ARI_URL) ?? '';
    this.client = axios.create({
      baseURL: this.baseUrl,
      auth: { username, password },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
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
    const response = await this.client.post(
      `/channels/${channelId}/record`,
      null,
      {
        params: {
          name,
          format: 'wav',
          maxDurationSeconds: 60,
          beep: true,
          ifExists: 'overwrite',
        },
      },
    );
    console.log('response', response);
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
    console.log('response', response);
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
    console.log('response', response);
    return response.data;
  }


  /**
   * Sale de la aplicación Stasis y devuelve el control a Asterisk
   */
  async exitStasisApp(channelId: string): Promise<any> {
    try {
      this.logger.log(`Devolviendo canal ${channelId} a Asterisk dialplan`);

      const response = await this.client.delete(`/channels/${channelId}/stasis`);

      this.logger.log(`Canal ${channelId} devuelto exitosamente`);
      return response.data;
    } catch (error) {
      this.logger.error(`Error saliendo de Stasis: ${error.message}`);
      throw new InternalServerErrorException(
        `Exit Stasis Error: ${error.message}`
      );
    }
  }

  /**
   * Obtiene el archivo de audio grabado desde el disco
   * Busca las grabaciones en /var/spool/asterisk/recording/
   */
  async getRecording(recordingName: string): Promise<Buffer> {
    try {
      this.logger.log(`📁 Obteniendo grabación: ${recordingName}`);

      // Asterisk guarda las grabaciones aquí por defecto
      const recordingPath = path.join('/var/spool/asterisk/recording', `${recordingName}.wav`);

      // Verificar si el archivo existe
      if (!fs.existsSync(recordingPath)) {
        this.logger.error(`Archivo no encontrado: ${recordingPath}`);
        throw new InternalServerErrorException(`Recording file not found: ${recordingName}`);
      }

      // Leer el archivo como Buffer
      const audioBuffer = fs.readFileSync(recordingPath);

      this.logger.log(`Grabación obtenida: ${audioBuffer.length} bytes`);
      return audioBuffer;

    } catch (error) {
      this.logger.error(`Error obteniendo grabación: ${error.message}`);
      throw new InternalServerErrorException(
        `Get Recording Error: ${error.message}`
      );
    }
  }

  /**
   * Detiene una grabación en curso (opcional)
   */
  async stopRecording(recordingName: string): Promise<any> {
    try {
      this.logger.log(`Deteniendo grabación: ${recordingName}`);

      const response = await this.client.delete(`/recordings/live/${recordingName}`);

      this.logger.log(` ${recordingName} detenida`);
      return response.data;
    } catch (error) {
      this.logger.error(`Error deteniendo grabación: ${error.message}`);
      throw new InternalServerErrorException(
        `Stop Recording Error: ${error.message}`
      );
    }
  }

  /**
   * Reproduce un archivo de audio desde un Buffer
   * Útil para reproducir audio generado por TTS
   */
  async playAudioBuffer(channelId: string, audioBuffer: Buffer, playbackId?: string): Promise<any> {
    try {
      // Crear archivo temporal
      const tempFile = `/tmp/tts_${channelId}_${Date.now()}.wav`;
      fs.writeFileSync(tempFile, audioBuffer);

      this.logger.log(`Reproduciendo audio en canal ${channelId}: ${tempFile}`);

      const response = await this.client.post(
        `/channels/${channelId}/play/${playbackId || 'tts-' + Date.now()}`,
        null,
        {
          params: {
            media: `sound:${tempFile.replace('.wav', '')}` // Asterisk no necesita la extensión
          }
        }
      );

      this.logger.log(`Audio iniciado en canal ${channelId}`);
      return response.data;

    } catch (error) {
      this.logger.error(`Error reproduciendo audio: ${error.message}`);
      throw new InternalServerErrorException(
        `Play Audio Error: ${error.message}`
      );
    }
  }

}
