import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config/dist';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { SAT_URL } from 'src/shared/Constants';
import { TokenDto } from './dto/TokenDto';
import { ApiResponseProxyDTO } from 'src/shared/ApiResponseProxyDTO';
import { BulletDto } from './dto/BulletDto';
import { TramiteDto } from './dto/TramiteDto';
import { FaltaDto } from './dto/FaltaDto';
import { PlacaDto } from './dto/PlacaDto';

@Injectable()
export class SatProxy {
  private client: AxiosInstance;
  constructor(private readonly configService: ConfigService) {
    this.client = axios.create({
      baseURL: this.configService.get<string>(SAT_URL) ?? '',
      timeout: 10000,
      headers: {
        Accept: 'application/json',
      },
    });
  }
  async getToken(): Promise<ApiResponseProxyDTO<TokenDto>> {
    const body = {
      client_id: 'Omnicanalidad',
      client_secret: 'MKVV93OyQCWLrTy8aAyo41l68qcBvFMQ',
      usuario: 'usromnicanalidad',
      clave: '8*n56yBTM3!j@iXM',
      realm: 'sat-mobiles',
      grant_type: 'password',
    };
    const response: AxiosResponse<TokenDto> = await this.client.post(
      '/auth/v2/login',
      body,
      { validateStatus: () => true },
    );
    const promise = new ApiResponseProxyDTO<TokenDto>();
    if (response.status != 200) {
      promise.success = false;
      promise.statusCode = response.status;
      promise.url = '';
      return promise;
    }
    const content = response.data;
    promise.success = true;
    promise.statusCode = response.status;
    promise.element = content;
    return promise;
  }
  async CaptureOrder(
    plateId: string,
  ): Promise<ApiResponseProxyDTO<BulletDto[]>> {
    const token = await this.getToken();
    if (!token.success) {
      throw new InternalServerErrorException(
        `Error con Token se tiene que la consulta genero un ${token.statusCode}`,
      );
    }
    const config: AxiosRequestConfig = {
      headers: {
        Authorization: `Bearer ${token.element?.access_token}`,
      },
      validateStatus: () => true,
    };
    const response: AxiosResponse<BulletDto[]> = await this.client.get(
      `/saldomatico/papeleta/${plateId}`,
      config,
    );
    const promise = new ApiResponseProxyDTO<BulletDto[]>();
    if (response.status != 200) {
      promise.success = false;
      promise.statusCode = response.status;
      promise.url = '';
      return promise;
    }
    const content = response.data;
    promise.success = true;
    promise.statusCode = response.status;
    promise.element = content;
    return promise;
  }
  async GetExpediente(
    psiCodMun: string,
    pcNumeroGenDoc: string,
  ): Promise<ApiResponseProxyDTO<TramiteDto[]>> {
    const token = await this.getToken();
    const config: AxiosRequestConfig = {
      headers: {
        Authorization: `Bearer ${token.element?.access_token}`,
      },
      validateStatus: () => true,
    };
    const response: AxiosResponse<TramiteDto[]> = await this.client.get(
      `/saldomatico/papeleta/${psiCodMun}/${pcNumeroGenDoc}`,
      config,
    );
    const promise = new ApiResponseProxyDTO<TramiteDto[]>();
    if (response.status != 200) {
      promise.success = false;
      promise.statusCode = response.status;
      promise.url = '';
      return promise;
    }
    const content = response.data;
    promise.success = true;
    promise.statusCode = response.status;
    promise.element = content;
    return promise;
  }
  async GetFalta(pcCodFal: string): Promise<ApiResponseProxyDTO<FaltaDto[]>> {
    const token = await this.getToken();
    const config: AxiosRequestConfig = {
      headers: {
        Authorization: `Bearer ${token.element?.access_token}`,
      },
      validateStatus: () => true,
    };
    const response: AxiosResponse<FaltaDto[]> = await this.client.get(
      `/saldomatico/falta/${pcCodFal}`,
      config,
    );
    const promise = new ApiResponseProxyDTO<FaltaDto[]>();
    if (response.status != 200) {
      promise.success = false;
      promise.statusCode = response.status;
      promise.url = '';
      return promise;
    }
    const content = response.data;
    promise.success = true;
    promise.statusCode = response.status;
    promise.element = content;
    return promise;
  }
  async GetPapeletas(
    placaId: string,
  ): Promise<ApiResponseProxyDTO<PlacaDto[]>> {
    const token = await this.getToken();
    const config: AxiosRequestConfig = {
      headers: {
        Authorization: `Bearer ${token.element?.access_token}`,
        IP: '172.168.1.1',
      },
      validateStatus: () => true,
    };
    const response: AxiosResponse<PlacaDto[]> = await this.client.get(
      `/saldomatico/saldomatico/3/${placaId}/0/10/11`,
      config,
    );
    const promise = new ApiResponseProxyDTO<PlacaDto[]>();
    if (response.status != 200) {
      promise.success = false;
      promise.statusCode = response.status;
      promise.url = '';
      return promise;
    }
    const content = response.data;
    promise.success = true;
    promise.statusCode = response.status;
    promise.element = content;
    return promise;
  }
}
