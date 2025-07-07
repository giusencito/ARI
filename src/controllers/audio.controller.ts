import {
  Body,
  Controller,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { Response } from 'express';
import { STTDto } from 'src/proxy/dto/STTDto';
import { AudioService } from 'src/services/audio.service';
class TextToSpeechDto {
  text: string;
}
@Controller('AUDIO')
export class AudioController {
  constructor(private readonly audioProxy: AudioService) {}
  @Post('process-plate')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        audio: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('audio'))
  async procesarAudio(
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
  ): Promise<void> {
    const response = await this.audioProxy.Plate(file);
    res.set({
      'Content-Type': 'audio/ogg',
      'Content-Disposition': 'attachment; filename="resultado.opus"',
    });
    res.send(response);
  }
  @Post('stt')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        audio: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('audio'))
  async transcribirAudio(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<STTDto> {
    return this.audioProxy.stt(file);
  }
  @Post('tts')
  @ApiConsumes('application/json')
  @ApiBody({ type: TextToSpeechDto })
  async textoAVoz(
    @Body('text') text: string,
    @Res() res: Response,
  ): Promise<void> {
    const response = await this.audioProxy.tts(text);
    res.set({
      'Content-Type': 'audio/ogg',
      'Content-Disposition': 'attachment; filename="resultado.opus"',
    });
    res.send(response);
  }
}
