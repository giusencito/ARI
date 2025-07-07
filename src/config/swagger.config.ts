import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function SwaggerConfig(app) {
  const config = new DocumentBuilder()
    .setTitle('ARI')
    .setDescription('ARI Endpoints')
    .setVersion('2.0')
    .build();
  return SwaggerModule.createDocument(app, config);
}
