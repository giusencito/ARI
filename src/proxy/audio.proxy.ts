import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { ApiResponseProxyDTO } from 'src/shared/ApiResponseProxyDTO';
import { AUDIO_URL } from 'src/shared/Constants';
import { STTDto } from './dto/STTDto';
import * as FormData from 'form-data';
import { ValidateDto } from './dto/ValidateDto';

@Injectable()
export class AudioProxy {
  private client: AxiosInstance;
  constructor(private readonly configService: ConfigService) {
    this.client = axios.create({
      baseURL: this.configService.get<string>(AUDIO_URL) ?? '',
      timeout: 20000,
      headers: {
        Accept: 'application/json',
      },
    });
  }
  async procesarAudio(
    file: Express.Multer.File,
  ): Promise<ApiResponseProxyDTO<ValidateDto>> {
    const form = new FormData();
    form.append('audio', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });
    const headers = form.getHeaders();
    const response: AxiosResponse<ValidateDto> = await this.client.post(
      'speech_to_text/transcribe',
      form,
      {
        headers: {
          ...headers,
          //Accept: 'application/octet-stream',
          Accept: 'application/json',
        },
        //responseType: 'arraybuffer',
        validateStatus: () => true,
      },
    );
    const promise = new ApiResponseProxyDTO<ValidateDto>();
    if (response.status < 200 || response.status >= 300) {
      promise.success = false;
      promise.statusCode = response.status;
      promise.url = '';
      return promise;
    }
    promise.success = true;
    promise.statusCode = response.status;
    promise.element = response.data;
    return promise;
  }
  async stt(file: Express.Multer.File): Promise<ApiResponseProxyDTO<STTDto>> {
    const form = new FormData();
    form.append('audio', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });
    const headers = form.getHeaders();
    const response: AxiosResponse<STTDto> = await this.client.post(
      'stt',
      form,
      {
        headers: {
          ...headers,
          Accept: 'application/json',
        },
        validateStatus: () => true,
      },
    );
    const promise = new ApiResponseProxyDTO<STTDto>();
    if (response.status < 200 || response.status >= 300) {
      promise.success = false;
      promise.statusCode = response.status;
      promise.url = '';
      return promise;
    }
    promise.success = true;
    promise.statusCode = response.status;
    promise.element = response.data;
    return promise;
  }
  async tts(text: string): Promise<ApiResponseProxyDTO<Buffer>> {
    const form = new FormData();
    form.append('text', text);
    const response: AxiosResponse<Buffer> = await this.client.post(
      'tts',
      form,
      {
        headers: {
          ...form.getHeaders(),
          Accept: 'application/json',
        },
        responseType: 'arraybuffer',
        validateStatus: () => true,
      },
    );
    const promise = new ApiResponseProxyDTO<Buffer>();
    if (response.status < 200 || response.status >= 300) {
      promise.success = false;
      promise.statusCode = response.status;
      promise.url = '';
      return promise;
    }
    const buffer = Buffer.from(response.data);
    promise.success = true;
    promise.statusCode = response.status;
    promise.element = buffer;
    return promise;
  }
}
