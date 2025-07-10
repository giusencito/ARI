import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config/dist';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import {
  CLAVE,
  CLIENT_ID,
  CLIENT_SECRET,
  GRANT_TYPE,
  REALM,
  SAT_URL,
  USUARIO,
} from 'src/shared/Constants';
import { TokenDto } from './dto/TokenDto';
import { ApiResponseProxyDTO } from 'src/shared/ApiResponseProxyDTO';
import { BulletDto } from './dto/BulletDto';
import { TramiteDto } from './dto/TramiteDto';
import { FaltaDto } from './dto/FaltaDto';
import { PlacaDto } from './dto/PlacaDto';

@Injectable()
export class SatProxy {
  private readonly logger = new Logger(SatProxy.name);
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
      client_id: this.configService.get<string>(CLIENT_ID) ?? '',
      client_secret: this.configService.get<string>(CLIENT_SECRET) ?? '',
      usuario: this.configService.get<string>(USUARIO) ?? '',
      clave: this.configService.get<string>(CLAVE) ?? '',
      realm: this.configService.get<string>(REALM) ?? '',
      grant_type: this.configService.get<string>(GRANT_TYPE) ?? '',
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

    const url = `/saldomatico/papeleta/${plateId}`;
    this.logger.log(`Consultando placa en SAT: "${plateId}"`);

    const response: AxiosResponse<BulletDto[]> = await this.client.get(url, config);

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
    this.logger.log(`Consultando papeletas: placa="${placaId}"`);

    const token = await this.getToken();
    const config: AxiosRequestConfig = {
      headers: {
        Authorization: `Bearer ${token.element?.access_token}`,
        IP: '172.168.1.1',
      },
      validateStatus: () => true,
    };

    const url = `/saldomatico/saldomatico/3/${placaId}/0/10/11`;
    this.logger.log(`Consultando placa en SAT: "${placaId}"`);

    const response: AxiosResponse<PlacaDto[]> = await this.client.get(url, config);

    this.logger.log(`Respuesta SAT papeletas: statusCode=${response.status}, placa="${placaId}"`);

    const promise = new ApiResponseProxyDTO<PlacaDto[]>();
    if (response.status != 200) {
      this.logger.error(`Error consultando papeletas: statusCode=${response.status}, placa="${placaId}"`);
      promise.success = false;
      promise.statusCode = response.status;
      promise.url = '';
      return promise;
    }

    const content = response.data;
    this.logger.log(`Papeletas encontradas: ${content?.length || 0} para placa="${placaId}"`);

    promise.success = true;
    promise.statusCode = response.status;
    promise.element = content;
    return promise;
  }

  async GetPapeleta(
    papeletaId: string,
  ): Promise<ApiResponseProxyDTO<PlacaDto>> {
    this.logger.log(`Consultando papeleta individual: papeleta="${papeletaId}"`);

    const token = await this.getToken();
    const config: AxiosRequestConfig = {
      headers: {
        Authorization: `Bearer ${token.element?.access_token}`,
        IP: '172.168.1.1',
      },
      validateStatus: () => true,
    };

    const url = `/saldomatico/saldomatico/4/${papeletaId}/0/10/11`;
    this.logger.log(`Consultando papeleta en SAT: "${papeletaId}"`);

    const response: AxiosResponse<PlacaDto[]> = await this.client.get(url, config);

    this.logger.log(`Respuesta SAT papeleta individual: statusCode=${response.status}, papeleta="${papeletaId}"`);

    const promise = new ApiResponseProxyDTO<PlacaDto>();
    if (response.status != 200) {
      this.logger.error(`Error consultando papeleta individual: statusCode=${response.status}, papeleta="${papeletaId}"`);
      promise.success = false;
      promise.statusCode = response.status;
      promise.url = '';
      return promise;
    }

    let content = response.data;
    this.logger.log(`Papeletas recibidas antes de filtrar: ${content?.length || 0}`);

    content = content.filter((item) => item.documento.trim() == papeletaId);
    this.logger.log(`Papeletas despues de filtrar por documento="${papeletaId}": ${content?.length || 0}`);

    promise.success = true;
    promise.statusCode = response.status;
    promise.element = content.length == 0 ? undefined : content[0];

    if (content.length > 0) {
      this.logger.log(`Papeleta encontrada: documento="${content[0].documento}", monto=${content[0].monto}`);
    } else {
      this.logger.log(`No se encontro papeleta con documento="${papeletaId}"`);
    }

    return promise;
  }

  async GetDeudaTributaria(code: string, type: string) {
    const token = await this.getToken();
    const config: AxiosRequestConfig = {
      headers: {
        Authorization: `Bearer ${token.element?.access_token}`,
        IP: '172.168.1.1',
      },
      validateStatus: () => true,
    };
    const response: AxiosResponse<PlacaDto[]> = await this.client.get(
      `/saldomatico/saldomatico/${type}/${code}/0/10/10`,
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