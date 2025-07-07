import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerConfig } from './config/swagger.config';
import { SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = 8080;
  const document = SwaggerConfig(app);
  SwaggerModule.setup('api', app, document);
  await app.listen(port);
}
bootstrap();
