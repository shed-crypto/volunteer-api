import { Module, MiddlewareConsumer, RequestMethod, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

// ─── Конфігурація ─────────────────────────────────────────────────────────────
import databaseConfig from '@config/database.config';

// ─── Фільтри / Guards ─────────────────────────────────────────────────────────
import { GlobalExceptionFilter } from '@common/filters/global-exception.filter';

// ─── Модулі функціоналу ───────────────────────────────────────────────────────
import { AuthModule } from '@modules/auth/auth.module';
import { UsersModule } from '@modules/users/users.module';
import { OrganizationsModule } from '@modules/organizations/organizations.module';
import { RequestsModule } from '@modules/requests/requests.module';
import { TasksModule } from '@modules/tasks/tasks.module';
import { ChatModule } from '@modules/chat/chat.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { EmailModule } from '@modules/email/email.module';
import { TaskReportsModule } from '@modules/task-reports/task-reports.module';

// ─── Middleware ────────────────────────────────────────────────────────────────
import { RemoveExifMiddleware } from '@common/middleware/remove-exif.middleware';

@Module({
  imports: [
    // ─── Глобальна конфігурація (читає .env) ──────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig],
      envFilePath: ['.env', '.env.local'],
    }),

    // ─── Статичне обслуговування завантажених файлів ───────────────────────
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),

    // ─── Rate Limiting (захист від DDoS та брутфорсу) ─────────────────────
    // Глобальне обмеження: 60 запитів / хвилину з одного IP.
    // Окремі маршрути (login, register) мають власні жорсткіші ліміти
    // через декоратор @Throttle() у контролерах.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('THROTTLE_TTL') || 60000,     // 1 хвилина (мс)
          limit: config.get<number>('THROTTLE_LIMIT') || 60,    // 60 запитів
        },
      ],
      inject: [ConfigService],
    }),

    // ─── TypeORM + PostgreSQL/PostGIS ─────────────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        ...config.get('database'),
      }),
      inject: [ConfigService],
    }),

    // ─── Функціональні модулі ─────────────────────────────────────────────
    AuthModule,
    UsersModule,
    OrganizationsModule,
    RequestsModule,
    TasksModule,
    ChatModule,
    NotificationsModule,
    EmailModule,
    TaskReportsModule,
  ],
  providers: [
    // Глобальний обробник помилок
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    // Глобальний rate-limit guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RemoveExifMiddleware)
      .forRoutes(
        { path: 'requests', method: RequestMethod.POST },
        { path: 'requests/:id', method: RequestMethod.PATCH },
        { path: 'requests/:id/add-info', method: RequestMethod.PATCH },
        { path: 'tasks/:taskId/reports', method: RequestMethod.POST },
        { path: 'chats/:id/messages', method: RequestMethod.POST },
        { path: 'messages/:id/attachments', method: RequestMethod.PATCH },
        { path: 'users/me/avatar', method: RequestMethod.POST },
      );
  }
}
