import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../src/modules/users/entities/user.entity';
import { SystemRole, ClearanceLevel } from '../src/common/enums';

describe('Integration Tests (Supertest)', () => {
  let app: INestApplication;
  let userRepo: any;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    userRepo = moduleFixture.get(getRepositoryToken(User));
    await userRepo.delete({ email: 'ittest@example.com' });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ------------------------------------------------------
  // IT-1 — POST /auth/register — реєстрація
  // ------------------------------------------------------
  it('IT-1 — POST /auth/register — реєструє нового волонтера', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'ittest@example.com',
        password: 'TestPass123!',
        fullName: 'Integration Tester',
      })
      .expect(201);

    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
  });

  // ------------------------------------------------------
  // IT-2 — POST /auth/register — дубль email
  // ------------------------------------------------------
  it('IT-2 — POST /auth/register — відхиляє дубль email (409)', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'ittest@example.com',
        password: 'TestPass123!',
        fullName: 'Integration Tester',
      })
      .expect(409);
  });

  // ------------------------------------------------------
  // IT-3 — POST /auth/login — вхід
  // ------------------------------------------------------
  it('IT-3 — POST /auth/login — логіниться з правильними кредами', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'ittest@example.com',
        password: 'TestPass123!',
      })
      .expect(200);

    expect(res.body).toHaveProperty('accessToken');
  });

  // ------------------------------------------------------
  // IT-4 — POST /auth/login — невірний пароль
  // ------------------------------------------------------
  it('IT-4 — POST /auth/login — відхиляє невірний пароль (401)', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'ittest@example.com',
        password: 'WrongPass',
      })
      .expect(401);
  });

  // ------------------------------------------------------
  // IT-5 — GET /requests (без авторизації) — 401
  // ------------------------------------------------------
  it('IT-5 — GET /requests — без токена повертає 401', async () => {
    await request(app.getHttpServer())
      .get('/requests')
      .expect(401);
  });

  // ------------------------------------------------------
  // IT-6 — GET /requests (з авторизацією) — 200
  // ------------------------------------------------------
  it('IT-6 — GET /requests — з токеном повертає список заявок', async () => {
    // Логінимось
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'ittest@example.com',
        password: 'TestPass123!',
      });

    const token = loginRes.body.accessToken;

    const res = await request(app.getHttpServer())
      .get('/requests')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });
});