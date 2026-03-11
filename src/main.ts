import { NestFactory } from '@nestjs/core';
import { AppModule } from '@src/app.module';
import { resolve } from 'path';

async function bootstrap() {
  // Load .env from project root (works when running from any cwd or from dist/)
  require('dotenv').config({
    path: resolve(__dirname, '..', '.env'),
  });
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  const corsOrigin = process.env.CORS_ORIGIN;
  const allowedOrigins = corsOrigin
    ? corsOrigin.split(',').map((s) => s.trim()).filter(Boolean)
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

  app.enableCors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-account-id'],
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`NestJS API: http://localhost:${port}/api`);
}
bootstrap();
