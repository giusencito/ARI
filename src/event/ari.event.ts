import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AriService } from 'src/services/ari.service';

import * as WebSocket from 'ws';
@Injectable()
export class AriEvent implements OnModuleInit {
  private ws: WebSocket;
  constructor(
    private readonly configService: ConfigService,
    private readonly ariService: AriService,
  ) {}
  onModuleInit() {
    /*const ariApp = this.configService.get<string>(ARI_APPLICATION_NAME);
    const ariUrl = this.configService.get<string>(ARI_URL);
    const ariUser = this.configService.get<string>(ARI_USERNAME);
    const ariPass = this.configService.get<string>(ARI_PASSWORD);
    const wsUrl = `${ariUrl}/events?api_key=${ariUser}:${ariPass}&app=${ariApp}`;
    this.ws = new WebSocket(wsUrl);
    this.ws.on('open', () => {
      console.log('✅ Conectado al WebSocket de ARI');
    });
    this.ws.on('message', async (data) => {
      try {
        const event = JSON.parse(data.toString());
        console.log('event', event);
        if (event.type === 'StasisStart') {
          console.log(`🎧 Canal conectado: ${event.channel.name}`);
          const response = await this.ariService.playToChannel(
            event.channel.id,
            'hello-world',
          );
        } else if (event.type === 'StasisEnd') {
          console.log(`📴 Canal desconectado: ${event.channel.name}`);
        } else if (event.type === 'ChannelStateChange') {
          console.log(`🔄 Cambio de estado: ${event.channel.state}`);
        } else {
          console.log(`🎧 EVENTO SIN IDENTIFICAR: ${event.type}`);
        }
      } catch (err) {
        console.error('❌ Error al parsear mensaje WebSocket:', err.message);
      }
    });
    this.ws.on('error', (err) => {
      console.error('❌ Error WebSocket ARI:', err.message);
    });
    this.ws.on('close', () => {
      console.warn('⚠️ Conexión WebSocket ARI cerrada');
    });*/
  }
}
