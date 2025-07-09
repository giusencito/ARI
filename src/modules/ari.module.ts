import { Module } from '@nestjs/common';
import { AriController } from 'src/controllers/AriController';
import { AriEvent } from 'src/event/ari.event';
import { AriService } from 'src/services/ari.service';
import { IVRService } from 'src/services/ivr.service';
import { AudioProxy } from 'src/proxy/audio.proxy';
import { SatProxy } from 'src/proxy/sat.proxy';

@Module({
  imports: [],
  providers: [
    AriService,    // Para comandos de Asterisk
    AriEvent,      // Para WebSocket y eventos
    IVRService,    // Para lógica de placa/papeleta
    AudioProxy,    // Para STT/TTS
    SatProxy,      // Para consultas SAT
  ],
  controllers: [AriController], // Para pruebas REST
})
export class AriModule {}
