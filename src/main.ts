import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerConfig } from './config/swagger.config';
import { SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Puerto configurable por variable de entorno
  const port = process.env.PORT || 8080;

  const document = SwaggerConfig(app);
  SwaggerModule.setup('api', app, document);

  await app.listen(port);
  console.log(`🚀 ARI Server running on port ${port}`);
  console.log(`📡 Swagger docs: http://localhost:${port}/api`);
}
bootstrap();