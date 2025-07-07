import { Controller, Get, Param } from '@nestjs/common';
import { SatProxy } from 'src/proxy/sat.proxy';

@Controller('PLATE')
export class PlateController {
  constructor(private readonly satProxy: SatProxy) {}
  @Get('bulletsByPlate/:plateId')
  getChannels(@Param('plateId') plateId: string) {
    return this.satProxy.CaptureOrder(plateId);
  }
}
