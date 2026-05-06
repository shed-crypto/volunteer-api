import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // ─── Глобальні налаштування ────────────────────────────────────────────────

  // Всі роути з префіксом /api
  app.setGlobalPrefix('api');

  // CORS (для мобільного клієнта та браузера)
  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Автоматична валідація DTO через class-validator
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,          // Видаляє невідомі поля
      forbidNonWhitelisted: true, // Повертає помилку при зайвих полях
      transform: true,          // Автоматично перетворює типи (string→number тощо)
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Автоматично виключає @Exclude() поля (наприклад, passwordHash)
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector)),
  );

  // ─── Swagger / OpenAPI документація ───────────────────────────────────────

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Волонтерська допомога API')
      .setDescription(
        `
        REST API та WebSocket шлюз для системи координації волонтерської допомоги.

        **Авторизація:** Bearer JWT токен. Отримати через POST /api/auth/login
        
        **WebSocket:** ws://localhost:3000/chat (namespace: /chat)
        Передати токен у: { auth: { token: "..." } }
        `,
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('Авторизація')
      .addTag('Користувачі')
      .addTag('Організації')
      .addTag('Заявки (Requests / Epics)')
      .addTag('Підзадачі (Tasks / Kanban)')
      .addTag('Чати')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true, // Зберігати токен між перезавантаженнями
      },
    });

    console.log(
      `\n📖 Swagger UI: http://localhost:${process.env.PORT || 3000}/api/docs\n`,
    );
  }

  // ─── Статичне обслуговування завантажених файлів ──────────────────────────
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
  });

  // ─── Health check endpoint (без /api префіксу) ─────────────────────────────
  app.getHttpAdapter().get('/health/ping', (req: any, res: any) => {
    res.status(200).json({ status: 'ok', timestamp: Date.now() });
  });

  // ─── Запуск ────────────────────────────────────────────────────────────────

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port);

  console.log(`🚀 Сервер запущено: http://localhost:${port}/api`);
  console.log(`🌍 Середовище: ${process.env.NODE_ENV || 'development'}`);
}

bootstrap();
