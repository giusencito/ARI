import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  ARI_APPLICATION_NAME,
  ARI_PASSWORD,
  ARI_URL,
  ARI_USERNAME,
  ASTERISK_BASE_URL,
  ASTERISK_API_KEY,
  ASTERISK_RECORDINGS_FORMAT,
  ASTERISK_TTS_UPLOAD_URL,
  ASTERISK_STT_DOWNLOAD_URL,
  TEMP_AUDIO_DIR,
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
  private readonly asteriskBaseUrl: string;
  private readonly asteriskApiKey: string;

  constructor(private readonly configService: ConfigService) {
    const username = this.configService.get<string>(ARI_USERNAME) ?? '';
    const password = this.configService.get<string>(ARI_PASSWORD) ?? '';
    this.baseUrl = this.configService.get<string>(ARI_URL) ?? '';

    // Configuración Asterisk HTTP Server
    this.asteriskBaseUrl = this.configService.get<string>(ASTERISK_BASE_URL) ?? 'http://localhost:8001';
    this.asteriskApiKey = this.configService.get<string>(ASTERISK_API_KEY) ?? 'dev-asterisk-key-12345';

    // Configurar directorio temporal local (solo para desarrollo/debug)
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
      this.logger.log(`Directorio temporal local creado: ${this.tempDir}`);
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

  /**
   * Salir de Stasis app y devolver al dialplan de Asterisk
   */
  async exitStasisApp(channelId: string, context?: string, extension?: string, priority?: number): Promise<any> {
    try {
      if (context && extension && priority) {
        // Devolver a contexto específico
        this.logger.log(`Devolviendo canal ${channelId} a contexto: ${context},${extension},${priority}`);

        const response = await this.client.post(`/channels/${channelId}/continue`, null, {
          params: {
            context: context,
            extension: extension,
            priority: priority
          }
        });

        this.logger.log(`Canal ${channelId} devuelto exitosamente a ${context},${extension},${priority}`);
        return response.data;
      } else {
        // Continuar en el dialplan desde donde se quedó
        this.logger.log(`Continuando canal ${channelId} en el dialplan`);

        const response = await this.client.post(`/channels/${channelId}/continue`);

        this.logger.log(`Canal ${channelId} continuando en dialplan`);
        return response.data;
      }
    } catch (error) {
      this.logger.error(`Error devolviendo canal ${channelId}: ${error.message}`);
      if (error.response) {
        this.logger.error(`Respuesta del error: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }


  /**
   * Mover archivo desde /var/spool/asterisk/recording/ a /tmp/asterisk/stt/
   * Y limpiar el archivo original de recordings
   */
  async moveRecordingToSTTDirectory(recordingName: string): Promise<void> {
    try {
      const format = this.configService.get<string>(ASTERISK_RECORDINGS_FORMAT) ?? 'wav';
      const sourceFile = `${recordingName}.${format}`;

      // URLs del servidor Python
      const downloadUrl = `${this.asteriskBaseUrl}/${sourceFile}`;
      const uploadUrl = this.configService.get<string>(ASTERISK_STT_DOWNLOAD_URL) ?? `${this.asteriskBaseUrl}/stt`;

      this.logger.log(`Moviendo archivo STT: ${sourceFile} desde recordings a /tmp/asterisk/stt/`);

      // 1. Descargar desde /var/spool/asterisk/recording/
      const response = await axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        headers: {
          'Authorization': `Bearer ${this.asteriskApiKey}`
        }
      });

      const audioBuffer = Buffer.from(response.data);
      this.logger.log(`Archivo descargado desde recordings: ${audioBuffer.length} bytes`);

      // 2. Subir a /tmp/asterisk/stt/
      await axios.post(uploadUrl, audioBuffer, {
        headers: {
          'Content-Type': 'audio/wav',
          'Filename': sourceFile,
          'Authorization': `Bearer ${this.asteriskApiKey}`
        },
        timeout: 15000
      });

      this.logger.log(`Archivo movido exitosamente a /tmp/asterisk/stt/: ${sourceFile}`);

      // 3. Limpiar archivo original de /var/spool/asterisk/recording/
      await this.cleanupRecordingsFile(sourceFile);

    } catch (error) {
      this.logger.error(`Error moviendo archivo a directorio STT: ${error.message}`);
      throw new InternalServerErrorException(`Move recording to STT failed: ${error.message}`);
    }
  }

  /**
   * Descargar grabación STT desde /tmp/asterisk/stt/
   * (Los archivos en /tmp se limpian automáticamente por el OS)
   */
  async getRecording(recordingName: string): Promise<Buffer> {
    try {
      const sttDownloadUrl = this.configService.get<string>(ASTERISK_STT_DOWNLOAD_URL) ?? `${this.asteriskBaseUrl}/stt`;
      const format = this.configService.get<string>(ASTERISK_RECORDINGS_FORMAT) ?? 'wav';

      const url = `${sttDownloadUrl}/${recordingName}.${format}`;

      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
          'Authorization': `Bearer ${this.asteriskApiKey}`
        }
      });

      const audioBuffer = Buffer.from(response.data);
      this.logger.log(`Grabacion STT descargada desde ${url}: ${audioBuffer.length} bytes`);
      return audioBuffer;

    } catch (error) {
      this.logger.error(`Error descargando grabacion STT: ${error.message}`);
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

  /**
   * Calcular duración estimada considerando conversión de Piper (22.050 KHz) a 8 KHz
   */
  private calculateAudioDurationFromPiper(originalAudioBuffer: Buffer): number {
    try {
      // Valores por defecto para Piper TTS
      let originalSampleRate = 22050; // Piper (Claude) genera a 22.050 KHz
      let originalChannels = 1;
      let originalBitsPerSample = 16;

      // Intentar detectar formato del audio original si tiene header WAV
      if (originalAudioBuffer.length >= 44 && originalAudioBuffer.toString('ascii', 0, 4) === 'RIFF') {
        try {
          originalSampleRate = originalAudioBuffer.readUInt32LE(24);
          originalChannels = originalAudioBuffer.readUInt16LE(22);
          originalBitsPerSample = originalAudioBuffer.readUInt16LE(34);
          this.logger.log(`Formato original detectado: ${originalSampleRate}Hz, ${originalChannels}ch, ${originalBitsPerSample}bit`);
        } catch (e) {
          this.logger.warn('No se pudo leer header WAV, usando valores Piper por defecto');
        }
      } else {
        this.logger.log(`Sin header WAV detectado, usando formato Piper: ${originalSampleRate}Hz`);
      }

      // Calcular duración del audio original
      const originalBytesPerSample = originalBitsPerSample / 8;
      const headerSize = originalAudioBuffer.toString('ascii', 0, 4) === 'RIFF' ? 44 : 0;
      const originalDataSize = originalAudioBuffer.length - headerSize;
      const originalTotalSamples = originalDataSize / (originalBytesPerSample * originalChannels);
      const durationSeconds = originalTotalSamples / originalSampleRate;

      // La duración NO cambia al convertir frecuencia
      const durationMs = Math.ceil(durationSeconds * 1000);

      this.logger.log(`Duración calculada: ${durationMs}ms (${durationSeconds.toFixed(2)}s)`);
      this.logger.log(`Original: ${originalSampleRate}Hz → Convertido: 8000Hz (misma duración)`);

      return durationMs;

    } catch (error) {
      this.logger.error(`Error calculando duración: ${error.message}`);

      // Fallback: estimar basado en tamaño típico de Piper
      const estimatedSeconds = originalAudioBuffer.length / 44100; // ~44KB por segundo
      const estimatedMs = Math.ceil(estimatedSeconds * 1000);
      this.logger.warn(`Usando estimación fallback Piper: ${estimatedMs}ms`);
      return estimatedMs;
    }
  }

  /**
   * Reproducir audio TTS subiendo a /tmp/asterisk/tts/ y retornar duración estimada
   */
  async playAudioBuffer(channelId: string, audioBuffer: Buffer, playbackId?: string): Promise<{ playbackData: any, estimatedDurationMs: number }> {
    try {
      // 1. Calcular duración estimada del audio original (antes de conversión)
      const estimatedDurationMs = this.calculateAudioDurationFromPiper(audioBuffer);

      // 2. Generar nombre único para el archivo TTS
      const filename = `tts_${channelId}_${Date.now()}.wav`;

      // 3. Subir archivo TTS al servidor Asterisk en /tmp/asterisk/tts/
      await this.uploadTTSToAsterisk(audioBuffer, filename);

      // 4. Reproducir desde /tmp/asterisk/tts/ usando ruta absoluta
      const finalPlaybackId = playbackId || `tts-${Date.now()}`;

      const response = await this.client.post(
        `/channels/${channelId}/play/${finalPlaybackId}`,
        null,
        {
          params: {
            // Usar ruta absoluta a /tmp/asterisk/tts/ sin extensión
            media: `sound:/tmp/asterisk/tts/${filename.replace('.wav', '')}`
          }
        }
      );

      this.logger.log(`Audio TTS iniciado en canal ${channelId} con ID: ${finalPlaybackId}`);
      this.logger.log(`Reproduciendo archivo: /tmp/asterisk/tts/${filename}`);
      this.logger.log(`Duración estimada: ${estimatedDurationMs}ms`);
      this.logger.log(`Nota: Archivo TTS se limpiará automáticamente del sistema en /tmp`);

      return {
        playbackData: response.data,
        estimatedDurationMs: estimatedDurationMs
      };

    } catch (error) {
      this.logger.error(`Error reproduciendo audio TTS: ${error.message}`);
      throw new InternalServerErrorException(
        `Play Audio Error: ${error.message}`
      );
    }
  }

  /**
   * Subir archivo TTS al servidor Asterisk en /tmp/asterisk/tts/
   */
  private async uploadTTSToAsterisk(audioBuffer: Buffer, filename: string): Promise<void> {
    try {
      const ttsUploadUrl = this.configService.get<string>(ASTERISK_TTS_UPLOAD_URL) ?? `${this.asteriskBaseUrl}/tts`;

      this.logger.log(`Subiendo archivo TTS: ${filename} (${audioBuffer.length} bytes) a /tmp/asterisk/tts/`);

      const response = await axios.post(ttsUploadUrl, audioBuffer, {
        headers: {
          'Content-Type': 'audio/wav',
          'Filename': filename,
          'Authorization': `Bearer ${this.asteriskApiKey}`
        },
        timeout: 15000
      });

      if (response.data && response.data.status === 'success') {
        this.logger.log(`Archivo TTS subido y convertido exitosamente: ${filename}`);
        this.logger.log(`Directorio: ${response.data.directory}`);
      } else {
        this.logger.log(`Archivo TTS subido: ${filename}`);
      }

    } catch (error) {
      this.logger.error(`Error subiendo archivo TTS: ${error.message}`);
      if (error.response?.status === 401) {
        this.logger.error(`Error de autenticación: Verificar ASTERISK_API_KEY`);
      }
      if (error.response?.data) {
        this.logger.error(`Respuesta del servidor: ${JSON.stringify(error.response.data)}`);
      }
      throw new InternalServerErrorException(`Upload TTS failed: ${error.message}`);
    }
  }

  /**
   * Limpiar archivo de /var/spool/asterisk/recording/ solamente
   * (Los archivos en /tmp no necesitan limpieza manual)
   */
  private async cleanupRecordingsFile(filename: string): Promise<void> {
    try {
      const deleteUrl = `${this.asteriskBaseUrl}/${filename}`;

      await axios.delete(deleteUrl, {
        headers: {
          'Authorization': `Bearer ${this.asteriskApiKey}`
        },
        timeout: 5000
      });

      this.logger.log(`Archivo eliminado de /var/spool/asterisk/recording/: ${filename}`);

    } catch (error) {
      this.logger.warn(`No se pudo eliminar archivo de recordings: ${error.message}`);
    }
  }

  /**
   * Verificar estado del servidor Asterisk
   */
  async checkAsteriskServerStatus(): Promise<any> {
    try {
      const response = await axios.get(`${this.asteriskBaseUrl}/status`, {
        headers: {
          'Authorization': `Bearer ${this.asteriskApiKey}`
        },
        timeout: 5000
      });

      this.logger.log(`Estado del servidor Asterisk: ${response.data.status}`);
      this.logger.log(`Versión: ${response.data.version}`);

      if (response.data.directories) {
        this.logger.log(`Directorios configurados:`);
        Object.entries(response.data.directories).forEach(([key, dir]: [string, any]) => {
          this.logger.log(`  ${key}: ${dir.path} (${dir.files_count} archivos)`);
        });
      }

      return response.data;

    } catch (error) {
      this.logger.warn(`No se pudo verificar estado del servidor Asterisk: ${error.message}`);
      return null;
    }
  }

  /**
   * Reproducir audio predefinido desde /opt/voces-sat/cc/
   */
  sync playPredefinedAudio(channelId: string, audioName: string, playbackId?: string): Promise<{ playbackData: any, estimatedDurationMs: number }> {
    try {
      const finalPlaybackId = playbackId || `predefined-${Date.now()}`;

      const response = await this.client.post(
        `/channels/${channelId}/play/${finalPlaybackId}`,
        null,
        {
          params: {
            media: `sound:/opt/voces-sat/cc/${audioName}`
          }
        }
      );

      this.logger.log(`Audio predefinido iniciado: ${audioName} en canal ${channelId}`);

      // Duración estimada para cada audio predefinido
      const audioDurations = {
        'tts_reintento_placa': 4000,        // ~4 segundos
        'tts_reintento_papeleta': 4500,     // ~4.5 segundos
        'tts_error_placa': 3500,            // ~3.5 segundos - NUEVO
        'tts_error_papeleta': 3500,         // ~3.5 segundos - NUEVO
        'tts_maximo_intentos': 6000,        // ~6 segundos
      };
      const estimatedDurationMs = audioDurations[audioName] || 4000;

      this.logger.log(`Duración estimada para ${audioName}: ${estimatedDurationMs}ms`);

      return {
        playbackData: response.data,
        estimatedDurationMs: estimatedDurationMs
      };

    } catch (error) {
      this.logger.error(`Error reproduciendo audio predefinido: ${error.message}`);
      throw new InternalServerErrorException(`Play Predefined Audio Error: ${error.message}`);
    }
  }


}