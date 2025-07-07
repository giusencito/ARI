import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { BulletDto } from 'src/proxy/dto/BulletDto';
import { FaltaDto } from 'src/proxy/dto/FaltaDto';
import { TramiteDto } from 'src/proxy/dto/TramiteDto';
import { SatProxy } from 'src/proxy/sat.proxy';

@Injectable()
export class PlateService {
  constructor(private readonly satProxy: SatProxy) {}
  async getPlate(plateId: string): Promise<BulletDto[]> {
    const event = await this.satProxy.CaptureOrder(plateId);
    if (!event.success)
      throw new InternalServerErrorException(
        `Error con  la consulta genero un ${event.statusCode}`,
      );
    return event.element ?? [];
  }
  async GetExpediente(
    psiCodMun: string,
    pcNumeroGenDoc: string,
  ): Promise<TramiteDto[]> {
    const event = await this.satProxy.GetExpediente(psiCodMun, pcNumeroGenDoc);
    if (!event.success)
      throw new InternalServerErrorException(
        `Error con Token la consulta genero un ${event.statusCode}`,
      );
    return event.element ?? [];
  }
  async GetFalta(pcCodFal: string): Promise<FaltaDto[]> {
    const event = await this.satProxy.GetFalta(pcCodFal);
    if (!event.success)
      throw new InternalServerErrorException(
        `Error con  la consulta genero un ${event.statusCode}`,
      );
    return event.element ?? [];
  }
}
