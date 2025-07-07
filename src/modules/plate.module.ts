import { Module } from '@nestjs/common';
import { PlateController } from 'src/controllers/plate.controller';
import { SatProxy } from 'src/proxy/sat.proxy';
import { PlateService } from 'src/services/plate.service';
@Module({
  imports: [],
  providers: [PlateService, SatProxy],
  controllers: [PlateController],
})
export class PlateModule {}
