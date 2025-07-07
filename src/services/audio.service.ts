import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { AudioProxy } from 'src/proxy/audio.proxy';
import { STTDto } from 'src/proxy/dto/STTDto';
import { ValidateDto } from 'src/proxy/dto/ValidateDto';

@Injectable()
export class AudioService {
  constructor(private readonly audioProxy: AudioProxy) {}
  async Plate(file: Express.Multer.File): Promise<ValidateDto> {
    const checkValidation = await this.audioProxy.procesarAudio(file);
    if (!checkValidation.success)
      throw new InternalServerErrorException(
        `Error con  la consulta de validación genero un ${checkValidation.statusCode}`,
      );
    if (!checkValidation.element) {
      throw new InternalServerErrorException('Audi no retornado');
    }
    return checkValidation.element;
  }
  async stt(file: Express.Multer.File): Promise<STTDto> {
    const response = await this.audioProxy.stt(file);
    if (!response.success)
      throw new InternalServerErrorException(
        `Error con  la consulta genero un ${response.statusCode}`,
      );
    if (!response.element) {
      throw new InternalServerErrorException('Audi no retornado');
    }
    return response.element;
  }
  async tts(text: string): Promise<Buffer> {
    const response = await this.audioProxy.tts(text);
    if (!response.success)
      throw new InternalServerErrorException(
        `Error con  la consulta genero un ${response.statusCode}`,
      );
    if (!response.element) {
      throw new InternalServerErrorException('Audi no retornado');
    }
    return response.element;
  }
}
