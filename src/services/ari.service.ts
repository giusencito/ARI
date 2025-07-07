import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  ARI_APPLICATION_NAME,
  ARI_PASSWORD,
  ARI_URL,
  ARI_USERNAME,
} from 'src/shared/Constants';
import * as https from 'https';
import { AesterisitkDTO } from 'src/dto/AesterisitkDTO';

@Injectable()
export class AriService {
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
}
