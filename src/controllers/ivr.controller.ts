import {
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { IVRService } from 'src/services/ivr.service';

@Controller('IVR')
export class IVRController {
  constructor(private readonly ivrService: IVRService) {}
  @Post('process-audio')
  @UseInterceptors(FileInterceptor('audio'))
  async confirmarPlaca(
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
  ): Promise<void> {
    const response = await this.ivrService.confirmarPlaca(file);
    res.set({
      'Content-Type': 'audio/wav',
      'Content-Disposition': 'attachment; filename="resultado.wav"',
    });
    res.send(response.audio);
  }
  @Get('bulletsByPlate/:plateId')
  async placaInfo(
    @Param('plateId') plateId: string,
    @Res() res: Response,
  ): Promise<void> {
    const response = await this.ivrService.placaInfo(plateId);
    res.set({
      'Content-Type': 'audio/wav',
      'Content-Disposition': 'attachment; filename="resultado.wav"',
    });
    res.send(response);
  }
  @Post('process-validate')
  @UseInterceptors(FileInterceptor('audio'))
  async validate(@UploadedFile() file: Express.Multer.File) {
    const response = await this.ivrService.validate(file);
    return response;
  }
  @Post('process-papeleta')
  @UseInterceptors(FileInterceptor('audio'))
  async confirmarPapelta(
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
  ): Promise<void> {
    const response = await this.ivrService.confirmarPapeleta(file);
    res.set({
      'Content-Type': 'audio/wav',
      'Content-Disposition': 'attachment; filename="resultadoPapeleta.wav"',
    });
    res.send(response.audio);
  }
}
