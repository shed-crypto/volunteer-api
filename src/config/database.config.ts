import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => {
    const isProduction = process.env.NODE_ENV === 'production';

    // ─── БЕЗПЕКА: DB_SYNCHRONIZE = true на production заборонено ────────────
    // synchronize: true автоматично змінює схему БД, що може знищити дані.
    // На production завжди використовувати міграції.
    const synchronize =
      !isProduction && process.env.DB_SYNCHRONIZE === 'true';

    if (isProduction && process.env.DB_SYNCHRONIZE === 'true') {
      console.warn(
        '⚠️  УВАГА: DB_SYNCHRONIZE=true ігнорується на production. ' +
        'Використовуйте міграції: npm run migration:run',
      );
    }

    return {
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      username: process.env.DB_USER || 'volunteer',
      password: process.env.DB_PASSWORD || 'volunteer_pass',
      database: process.env.DB_NAME || 'volunteer_help',

      entities: [join(__dirname, '../modules/**/*.entity{.ts,.js}')],

      migrations: [join(__dirname, './migrations/**/*{.ts,.js}')],
      migrationsRun: false,

      synchronize,

      logging: process.env.DB_LOGGING === 'true',

      extra: {
        max: 20,
        min: 2,
        connectionTimeoutMillis: 5000,
      },
    };
  },
);
