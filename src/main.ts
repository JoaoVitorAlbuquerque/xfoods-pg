import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as path from 'node:path';
import * as express from 'express';
import { DecimalSerializerInterceptor } from './shared/interceptors/decimal-serializer.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use('/uploads', express.static(path.resolve(__dirname, '..', 'uploads')));

  app.useGlobalPipes(new ValidationPipe());

  // Mantém colunas Decimal saindo como number no JSON, do jeito que o
  // frontend já consome. Ver DecimalSerializerInterceptor.
  app.useGlobalInterceptors(new DecimalSerializerInterceptor());
  app.enableCors({ origin: '*' });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
