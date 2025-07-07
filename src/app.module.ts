import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { AriModule } from './modules/ari.module';
import { PlateModule } from './modules/plate.module';
import { AudioModule } from './modules/audio.module';
import { IVRModule } from './modules/ivr.module';

@Module({
  imports: [
    ConfigModule.forRoot({ envFilePath: '.env', isGlobal: true }),
    AriModule,
    PlateModule,
    AudioModule,
    IVRModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
