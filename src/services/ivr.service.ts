import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfirmacionDto, TypeConfirmacionDTO } from 'src/dto/ConfirmacionDto';
import { AudioProxy } from 'src/proxy/audio.proxy';
import { AnswerValidateDto } from 'src/proxy/dto/AnswerValidateDto';
import { SatProxy } from 'src/proxy/sat.proxy';
import { getDateString } from 'src/shared/DateTimeHelper';
import {
  Arbitrios,
  fortmatText,
  groupBy,
  ImpuestoPredial,
  joinText,
  montoRound,
  opcionConfirmar,
} from 'src/shared/IVRHelper';

@Injectable()
export class IVRService {
  private readonly logger = new Logger(IVRService.name);

  constructor(
    private readonly audioProxy: AudioProxy,
    private readonly satProxy: SatProxy,
  ) {}

  /**
   * Limpiar formato de placa o papeleta
   * Remueve guiones, espacios y convierte a mayúsculas
   */
  async confirmarPlaca(file: Express.Multer.File): Promise<ConfirmacionDto> {
    const stt = await this.audioProxy.stt(file);
    if (!stt.success)
      throw new InternalServerErrorException(
        `Error con  la consulta stt genero un ${stt.statusCode}`,
      );
    const promise = new ConfirmacionDto();
    if (!stt.element?.success) {
      this.logger.log(`STT fallo para placa: raw="${stt.element?.raw_text || 'N/A'}", plate="${stt.element?.plate || 'N/A'}"`);
      const invalid = await this.ResponseTTS(
        'La placa no fue detectada intente de nuevo',
      );
      promise.success = false;
      promise.audio = invalid;
      promise.placa = stt.element != null ? stt.element.plate : '';
      return promise;
    }

    this.logger.log(`STT exitoso para placa: raw="${stt.element.raw_text}", plate="${stt.element.plate}"`);

    const plate = fortmatText(stt.element.raw_text);
    this.logger.log(`Placa antes de formatear: "${stt.element.raw_text}"`);
    this.logger.log(`Placa despues de formatear: "${plate}"`);

    const valid = await this.ResponseTTS(
      `Confirmar que La placa es ${joinText(plate)}... ${opcionConfirmar}`,
    );
    promise.success = true;
    promise.audio = valid;
    promise.placa = stt.element?.plate ?? '';
    return promise;
  }

  async placaInfo(placaId: string): Promise<Buffer> {
    const placaFormateada = fortmatText(placaId);
    const bullets = await this.satProxy.GetPapeletas(placaFormateada);
    if (!bullets.success)
      throw new InternalServerErrorException(
        `Error con  la consulta de sat genero un ${bullets.statusCode}`,
      );

    const bulletsArray = bullets.element ?? [];
    let message = `la placa ${joinText(placaFormateada)} cuenta con ${bulletsArray.length} papeletas`;
    if (bulletsArray.length > 0) {
      const sum = bulletsArray.reduce((acc, element) => acc + element.monto, 0);
      const roundedSum = Math.round(sum * 100) / 100;
      message += ` con un monto de ${roundedSum} soles`;
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

    this.logger.log(`STT respuesta para papeleta: success=${stt.element?.success}, raw="${stt.element?.raw || 'N/A'}"`);

    const papeleta = stt.element != null ? fortmatText(stt.element.raw) : '';
    this.logger.log(`Papeleta antes de formatear: "${stt.element?.raw || 'N/A'}"`);
    this.logger.log(`Papeleta despues de formatear: "${papeleta}"`);

    const message = `Confirmar que la papeleta es ${joinText(papeleta)}... ${opcionConfirmar}`;
    console.log('papeleta', papeleta);
    const audio = await this.ResponseTTS(message);
    promise.success = true;
    promise.audio = audio;
    promise.placa = papeleta ?? '';
    return promise;
  }

  async papeletaInfo(papeletaId: string): Promise<Buffer> {
    const papeletaFormateada = fortmatText(papeletaId);
    const bullet = await this.satProxy.GetPapeleta(papeletaFormateada);
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

    const message = `la papeleta  número ${joinText(bullet.element.documento)} tiene un monto de ${bullet.element.monto} soles. 
    La fecha de vencimiento para el pago con el 50% de descuento es ${getDateString(bullet.element.fechavencimiento)}
    La fecha de imposición es ${getDateString(bullet.element.fechainfraccion)}`;

    const response = await this.ResponseTTS(message);
    return response;
  }

  async confirmarConsulta(code: string, type: string) {
    this.logger.log(`Confirmando consulta: code="${code}", type="${type}"`);

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
    this.logger.log(`Iniciando consulta deuda: code="${code}", type="${type}"`);

    const tribute = await this.satProxy.GetDeudaTributaria(code, type);
    this.logger.log(`Respuesta SAT deuda: success=${tribute.success}, statusCode=${tribute.statusCode}`);

    if (!tribute.success) {
      this.logger.error(`Error consultando deuda SAT: code="${code}", type="${type}", statusCode=${tribute.statusCode}`);
      throw new InternalServerErrorException(
        `Error con  la consulta de sat genero un ${tribute.statusCode}`,
      );
    }

    if (tribute.element == undefined) {
      this.logger.log(`Deuda no encontrada: code="${code}", type="${type}"`);
      const invalid = await this.audioProxy.tts(
        'papeleta no fue encontrada, intentar de nuevo',
      );
      if (invalid.element == null || !invalid.success)
        throw new InternalServerErrorException(
          `Error con  la peticion para mandar el texto genero un ${invalid.statusCode}`,
        );
      return invalid.element;
    }

    this.logger.log(`Deudas encontradas: ${tribute.element.length} registros`);

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

    this.logger.log(`Mensaje TTS deuda generado: "${message}"`);
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
    const placaFormateada = fortmatText(placaId);
    const bullet = await this.satProxy.GetPapeletas(placaFormateada);
    if (!bullet.success) {
      throw new InternalServerErrorException(
        `Error con  la consulta de sat genero un ${bullet.statusCode}`,
      );
    }

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