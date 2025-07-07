import { Module } from '@nestjs/common';
import { IVRController } from 'src/controllers/ivr.controller';
import { AudioProxy } from 'src/proxy/audio.proxy';
import { SatProxy } from 'src/proxy/sat.proxy';
import { IVRService } from 'src/services/ivr.service';

@Module({
  imports: [],
  providers: [IVRService, SatProxy, AudioProxy],
  controllers: [IVRController],
})
export class IVRModule {}
