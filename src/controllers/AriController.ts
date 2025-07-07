import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AriService } from 'src/services/ari.service';

@Controller('ARI')
export class AriController {
  constructor(private readonly ariService: AriService) {}
  @Get('channels')
  getChannels() {
    return this.ariService.getChannels();
  }
  @Get('endpoints')
  getEndpointss() {
    return this.ariService.getEnpoints();
  }
  @Get('endpoints')
  getAsteriskInfo() {
    return this.ariService.getAsteriskInfo();
  }
  @Get('bridges')
  getBridges() {
    return this.ariService.getBridges();
  }
  @Get('aesteristikInfo')
  getInfos() {
    return this.ariService.getAsteriskInfo();
  }
  @Post('channels/:channelId/record')
  recordChannel(
    @Param('channelId') channelId: string,
    @Query('name') name: string,
  ) {
    return this.ariService.recordChannel(channelId, name);
  }
  @Post('channels/:channelId/snoop')
  snoopChannel(@Param('channelId') channelId: string) {
    return this.ariService.snoopChannel(channelId);
  }
  @Post('channels/:channelId/play')
  playToChannel(
    @Param('channelId') channelId: string,
    @Query('mediaId') mediaId: string,
  ) {
    return this.ariService.playToChannel(channelId, mediaId);
  }
}
