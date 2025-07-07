import { Module } from '@nestjs/common';
import { AudioController } from 'src/controllers/audio.controller';
import { AudioProxy } from 'src/proxy/audio.proxy';
import { AudioService } from 'src/services/audio.service';

@Module({
  imports: [],
  providers: [AudioProxy, AudioService],
  controllers: [AudioController],
})
export class AudioModule {}
