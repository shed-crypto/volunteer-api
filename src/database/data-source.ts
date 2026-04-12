import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { join } from 'path';

config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  username: process.env.DB_USER || 'volunteer',
  password: process.env.DB_PASSWORD || 'volunteer_pass',
  database: process.env.DB_NAME || 'volunteer_help',
  synchronize: false,
  logging: true,
  entities: [join(__dirname, '../modules/**/*.entity{.ts,.js}')],
  migrations: [join(__dirname, './migrations/**/*{.ts,.js}')],
});
