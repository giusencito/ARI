import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfirmacionDto } from 'src/dto/ConfirmacionDto';
import { AudioProxy } from 'src/proxy/audio.proxy';
import { AnswerValidateDto } from 'src/proxy/dto/AnswerValidateDto';
import { SatProxy } from 'src/proxy/sat.proxy';
import { getDateString } from 'src/shared/DateTimeHelper';

@Injectable()
export class IVRService {
  constructor(
    private readonly audioProxy: AudioProxy,
    private readonly satProxy: SatProxy,
  ) {}
  async confirmarPlaca(file: Express.Multer.File): Promise<ConfirmacionDto> {
    const stt = await this.audioProxy.stt(file);
    if (!stt.success)
      throw new InternalServerErrorException(
        `Error con  la consulta stt genero un ${stt.statusCode}`,
      );
    const promise = new ConfirmacionDto();
    if (!stt.element?.success) {
      const invalid = await this.audioProxy.tts(
        'La placa no fue detectada intente de nuevo',
      );
      if (invalid.element == null || !invalid.success)
        throw new InternalServerErrorException(
          `Error con  la consulta de placa invalida genero un ${stt.statusCode}`,
        );
      promise.success = false;
      promise.audio = invalid.element;
      promise.placa = stt.element?.plate ?? '';
      return promise;
    }
    const valid = await this.audioProxy.tts(
      `Confirmar que La placa es ${stt.element.plate}... Si es correcto marque 1 - sino marque 2`,
    );
    if (valid.element == null || !valid.success)
      throw new InternalServerErrorException(
        `Error con  la consulta confirmación de placa genero un ${stt.statusCode}`,
      );
    promise.success = true;
    promise.audio = valid.element;
    promise.placa = stt.element?.plate ?? '';
    return promise;
  }
  async placaInfo(placaId: string): Promise<Buffer> {
    const bullets = await this.satProxy.GetPapeletas(placaId);
    if (!bullets.success)
      throw new InternalServerErrorException(
        `Error con  la consulta de sat genero un ${bullets.statusCode}`,
      );
    const bulletsArray = bullets.element ?? [];
    let message = `la placa ${placaId} cuenta con ${bulletsArray.length} papeletas`;
    if (bulletsArray.length > 0) {
      const sum = bulletsArray.reduce((acc, element) => acc + element.monto, 0);
      const roundedSum = Math.round(sum * 100) / 100;
      message += `con un monto de ${roundedSum} soles`;
    }
    const response = await this.audioProxy.tts(message);
    if (response.element == null || !response.success)
      throw new InternalServerErrorException(
        `Error con  la peticion para mandar el texto genero un ${response.statusCode}`,
      );
    return response.element;
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
    const message = `Confirmar que la papeleta es ${papeleta}... Si es correcto marque 1 - sino marque 2`;
    const audio = await this.audioProxy.tts(message);
    if (!audio.success || audio.element == null) {
      throw new InternalServerErrorException(
        `Error con  la consulta de tts genero un ${stt.statusCode}`,
      );
    }
    promise.success = true;
    promise.audio = audio.element;
    promise.placa = papeleta ?? '';
    return promise;
  }
  async papeletaInfo(placaId: string): Promise<Buffer> {
    const bullet = await this.satProxy.GetPapeleta(placaId);
    if (!bullet.success)
      throw new InternalServerErrorException(
        `Error con  la consulta de sat genero un ${bullet.statusCode}`,
      );
    if (bullet.element == undefined) {
      const invalid = await this.audioProxy.tts(
        'papeleta no fue encontrada, intentar de nuevo',
      );
      if (invalid.element == null || !invalid.success)
        throw new InternalServerErrorException(
          `Error con  la peticion para mandar el texto genero un ${invalid.statusCode}`,
        );
      return invalid.element;
    }
    const message = `la papeleta  número ${bullet.element.documento} tiene un monto de ${bullet.element.monto} soles. 
    La fecha de vencimiento para el pago con el 50% de descuento es ${getDateString(bullet.element.fechavencimiento)}
    La fecha de imposición es ${getDateString(bullet.element.fechainfraccion)}`;
    const response = await this.audioProxy.tts(message);
    if (response.element == null || !response.success)
      throw new InternalServerErrorException(
        `Error con  la peticion para mandar el texto genero un ${response.statusCode}`,
      );
    return response.element;
  }
}
