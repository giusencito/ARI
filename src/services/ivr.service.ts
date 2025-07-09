import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfirmacionDto, TypeConfirmacionDTO } from 'src/dto/ConfirmacionDto';
import { AudioProxy } from 'src/proxy/audio.proxy';
import { AnswerValidateDto } from 'src/proxy/dto/AnswerValidateDto';
import { SatProxy } from 'src/proxy/sat.proxy';
import { getDateString } from 'src/shared/DateTimeHelper';
import {
  Arbitrios,
  groupBy,
  ImpuestoPredial,
  montoRound,
  opcionConfirmar,
} from 'src/shared/IVRHelper';

@Injectable()
export class IVRService {
  constructor(
    private readonly audioProxy: AudioProxy,
    private readonly satProxy: SatProxy,
  ) {}

  /**
   * Limpiar formato de placa o papeleta
   * Remueve guiones, espacios y convierte a mayúsculas
   */
  private cleanFormat(input: string): string {
    return input.replace(/[-\s]/g, '').toUpperCase();
  }

  async confirmarPlaca(file: Express.Multer.File): Promise<ConfirmacionDto> {
    const stt = await this.audioProxy.stt(file);
    if (!stt.success)
      throw new InternalServerErrorException(
        `Error con  la consulta stt genero un ${stt.statusCode}`,
      );
    const promise = new ConfirmacionDto();
    if (!stt.element?.success) {
      const invalid = await this.ResponseTTS(
        'La placa no fue detectada intente de nuevo',
      );
      promise.success = false;
      promise.audio = invalid;
      promise.placa = stt.element?.plate ?? '';
      return promise;
    }
    const valid = await this.ResponseTTS(
      `Confirmar que La placa es ${stt.element.plate}... ${opcionConfirmar}`,
    );
    promise.success = true;
    promise.audio = valid;
    promise.placa = stt.element?.plate ?? '';
    return promise;
  }

  async placaInfo(placaId: string): Promise<Buffer> {
    // Limpiar formato de placa antes de consultar
    const cleanPlaca = this.cleanFormat(placaId);

    console.log(`Placa original: "${placaId}" -> limpia: "${cleanPlaca}"`);

    const bullets = await this.satProxy.GetPapeletas(cleanPlaca);
    if (!bullets.success)
      throw new InternalServerErrorException(
        `Error con  la consulta de sat genero un ${bullets.statusCode}`,
      );
    const bulletsArray = bullets.element ?? [];
    let message = `la placa ${cleanPlaca} cuenta con ${bulletsArray.length} papeletas`;
    if (bulletsArray.length > 0) {
      const sum = bulletsArray.reduce((acc, element) => acc + element.monto, 0);
      const roundedSum = Math.round(sum * 100) / 100;
      message += `con un monto de ${roundedSum} soles`;
    }
    const response = await this.ResponseTTS(message);
    return response;
  }

  async validate(file: Express.Multer.File): Promise<AnswerValidateDto> {
    const checkValidation = await this.audioProxy.procesarAudio(file);
    if (!checkValidation.success)
      throw new InternalServerErrorException(
        `Error con  la consulta de validación genero un ${checkValidation.statusCode}`,
      );
    const promise = new AnswerValidateDto();
    if (
      !checkValidation.element?.success ||
      checkValidation.element.confirmation == null
    ) {
      const response = await this.audioProxy.tts(
        'no se pudo indetificar la respuesta',
      );
      if (!response.success)
        throw new InternalServerErrorException(
          `Error con  la consulta de tts ${response.statusCode}`,
        );
      promise.success = false;
      promise.audio = response.element;
      return promise;
    }
    promise.success = true;
    promise.confirmation = checkValidation.element.confirmation;
    return promise;
  }

  async confirmarPapeleta(file: Express.Multer.File) {
    const stt = await this.audioProxy.procesarAudio(file);
    if (!stt.success)
      throw new InternalServerErrorException(
        `Error con  la consulta stt genero un ${stt.statusCode}`,
      );
    const promise = new ConfirmacionDto();
    const papeleta = stt.element?.raw ?? '';
    const message = `Confirmar que la papeleta es ${papeleta}... ${opcionConfirmar}`;
    const audio = await this.ResponseTTS(message);
    promise.success = true;
    promise.audio = audio;
    promise.placa = papeleta ?? '';
    return promise;
  }

  async papeletaInfo(papeletaId: string): Promise<Buffer> {
    // Limpiar formato de papeleta antes de consultar
    const cleanPapeleta = this.cleanFormat(papeletaId);

    console.log(
      `Papeleta original: "${papeletaId}" -> limpia: "${cleanPapeleta}"`,
    );

    const bullet = await this.satProxy.GetPapeleta(cleanPapeleta);
    if (!bullet.success)
      throw new InternalServerErrorException(
        `Error con  la consulta de sat genero un ${bullet.statusCode}`,
      );
    if (bullet.element == undefined) {
      const invalid = await this.ResponseTTS(
        'papeleta no fue encontrada, intentar de nuevo',
      );
      return invalid;
    }
    const message = `la papeleta  número ${bullet.element.documento} tiene un monto de ${bullet.element.monto} soles. 
    La fecha de vencimiento para el pago con el 50% de descuento es ${getDateString(bullet.element.fechavencimiento)}
    La fecha de imposición es ${getDateString(bullet.element.fechainfraccion)}`;
    const response = await this.ResponseTTS(message);
    return response;
  }

  async confirmarConsulta(code: string, type: string) {
    const promise = new TypeConfirmacionDTO();
    const message = `Usted digito ${code}... ${opcionConfirmar}`;
    const audio = await this.ResponseTTS(message);
    promise.success = true;
    promise.audio = audio;
    promise.placa = code;
    promise.type = type;
    return promise;
  }

  async GetDeudaInfo(code: string, type: string): Promise<Buffer> {
    // Limpiar formato antes de consultar deudas tributarias
    const cleanCode = this.cleanFormat(code);

    console.log(`Código original: "${code}" -> limpio: "${cleanCode}"`);

    const tribute = await this.satProxy.GetDeudaTributaria(cleanCode, type);
    if (!tribute.success)
      throw new InternalServerErrorException(
        `Error con  la consulta de sat genero un ${tribute.statusCode}`,
      );
    if (tribute.element == undefined) {
      const invalid = await this.audioProxy.tts(
        'papeleta no fue encontrada, intentar de nuevo',
      );
      if (invalid.element == null || !invalid.success)
        throw new InternalServerErrorException(
          `Error con  la peticion para mandar el texto genero un ${invalid.statusCode}`,
        );
      return invalid.element;
    }
    const groups = groupBy(tribute.element, (item) => item.concepto);
    const ImpuestoPredialMonto = (groups[ImpuestoPredial] ?? []).reduce(
      (acc, element) => acc + element.monto,
      0,
    );
    const messagePredial = `Por Impuesto Predial es ${montoRound(ImpuestoPredialMonto)} soles`;
    const ArbitriosMonto = (groups[Arbitrios] ?? []).reduce(
      (acc, element) => acc + element.monto,
      0,
    );
    const messageArbitrio = `Por Arbitrios es ${montoRound(ArbitriosMonto)} soles`;
    const message = messagePredial + ' ' + messageArbitrio;
    const response = await this.ResponseTTS(message);
    return response;
  }

  async ResponseTTS(message: string) {
    const audio = await this.audioProxy.tts(message);
    if (audio.element == null || !audio.success)
      throw new InternalServerErrorException(
        `Error con  la peticion para mandar el texto genero un ${audio.statusCode}`,
      );
    return audio.element;
  }
  async GetPapeletaPendiente(placaId: string) {
    const bullet = await this.satProxy.GetPapeletas(placaId);
    if (!bullet.success)
      throw new InternalServerErrorException(
        `Error con  la consulta de sat genero un ${bullet.statusCode}`,
      );
    const pendientes = bullet.element?.filter(
      (item) => item.estado === 'Pendiente',
    );
    const pendiente = pendientes?.[0] ?? null;
    if (pendiente == null) {
      const audioSin = await this.ResponseTTS(
        'no se encontraron papeletas pendientes',
      );
      return audioSin;
    }
    const message = `la papeleta  número ${pendiente.documento} tiene un monto de ${pendiente.monto} soles. 
    La fecha de vencimiento para el pago con el 50% de descuento es ${getDateString(pendiente.fechavencimiento)}
    La fecha de imposición es ${getDateString(pendiente.fechainfraccion)}`;
    const response = await this.ResponseTTS(message);
    return response;
  }
}
