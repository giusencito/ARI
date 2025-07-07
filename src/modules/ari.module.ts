import { Module } from '@nestjs/common';
import { AriController } from 'src/controllers/AriController';
import { AriEvent } from 'src/event/ari.event';
import { AriService } from 'src/services/ari.service';

@Module({
  imports: [],
  providers: [AriService, AriEvent],
  controllers: [AriController],
})
export class AriModule {}
