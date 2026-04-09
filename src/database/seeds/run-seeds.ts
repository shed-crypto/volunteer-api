/**
 * Seed-скрипт: заповнює БД тестовими даними для розробки.
 * Запуск: npm run seed
 *
 * Створює:
 * - 1 адміністратора
 * - 3 волонтери (один з FRONTLINE clearance)
 * - 1 потребуючого
 * - 1 організацію з підгрупою
 * - 2 заявки з підзадачами
 * - Призначення волонтерів на підзадачі
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import * as path from 'path';

// Підключення до БД безпосередньо (без NestJS bootstrap)
const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER || 'volunteer',
  password: process.env.DB_PASSWORD || 'volunteer_pass',
  database: process.env.DB_NAME || 'volunteer_help',
  entities: [path.join(__dirname, '../../modules/**/*.entity{.ts,.js}')],
  synchronize: true,
});

async function seed() {
  await AppDataSource.initialize();
  console.log('✅ З\'єднання з БД встановлено');

  //await AppDataSource.query('TRUNCATE TABLE "users", "organizations", "requests", "tasks", "task_assignments" RESTART IDENTITY CASCADE');
  //console.log('🧹 База даних очищена');

  const userRepo = AppDataSource.getRepository('users');
  const orgRepo = AppDataSource.getRepository('organizations');
  const memberRepo = AppDataSource.getRepository('organization_members');
  const requestRepo = AppDataSource.getRepository('requests');
  const taskRepo = AppDataSource.getRepository('tasks');
  const assignmentRepo = AppDataSource.getRepository('task_assignments');

  // ─── Користувачі ──────────────────────────────────────────────────────────

  const passwordHash = await argon2.hash('Password123!');

  const admin = await userRepo.save({
    email: 'admin@volunteer.ua',
    passwordHash,
    fullName: 'Адміністратор Системи',
    systemRole: 'admin',
    clearanceLevel: 'frontline',
    trustScore: 100,
  });

  const coord = await userRepo.save({
    email: 'coordinator@volunteer.ua',
    passwordHash,
    fullName: 'Тетяна Координатор',
    systemRole: 'coordinator',
    clearanceLevel: 'frontline',
    trustScore: 85,
  });

  const volunteer1 = await userRepo.save({
    email: 'volunteer1@volunteer.ua',
    passwordHash,
    fullName: 'Олексій Волонтер',
    systemRole: 'volunteer',
    clearanceLevel: 'local',
    trustScore: 40,
  });

  const requester = await userRepo.save({
    email: 'requester@volunteer.ua',
    passwordHash,
    fullName: 'Марія Потребуюча',
    systemRole: 'requester',
    clearanceLevel: 'local',
    trustScore: 10,
  });

  console.log('✅ Користувачів створено');

  // ─── Організація ──────────────────────────────────────────────────────────

  const org = await orgRepo.save({
    name: 'Волонтерський Центр "Правий Берег"',
    description: 'Координація допомоги Київській та Херсонській областям',
    isPublic: true,
  });

  const subOrg = await orgRepo.save({
    name: 'Медична бригада',
    description: 'Підрозділ медичної допомоги',
    parentOrgId: org.id,
    isPublic: true,
  });

  await memberRepo.save([
    { organizationId: org.id, userId: coord.id, orgRole: 'leader' },
    { organizationId: org.id, userId: volunteer1.id, orgRole: 'member' },
    { organizationId: subOrg.id, userId: coord.id, orgRole: 'coordinator' },
  ]);

  console.log('✅ Організацію та підгрупу створено');

  // ─── Заявки, підзадачі та призначення ─────────────────────────────────────

  const request1 = await requestRepo.save({
    creatorId: requester.id,
    title: 'Евакуація родини з Херсонської області',
    description: 'Потрібно вивезти 4 особи (2 дорослих, 2 дітей) із зони підтоплення',
    category: 'evacuation',
    urgency: 'critical',
    requiredClearance: 'local',
    latitude: 46.6354,
    longitude: 32.6169,
    isLocationHidden: false,
    status: 'open',
    tags: ['#Евакуація', '#Термінова'],
  });

  // Зберігаємо задачі у змінні, щоб отримати їхні ID
  const [req1_task1, req1_task2] = await taskRepo.save([
    {
      requestId: request1.id,
      title: 'Знайти транспорт (мінімум мікроавтобус)',
      description: 'Потрібен транспорт на 4+ пасажирів',
      neededPeopleCount: 1,
      requiredRoles: ['Водій', 'Мікроавтобус або більше'],
      priority: 2,
      status: 'todo',
    },
    {
      requestId: request1.id,
      title: 'Зустріти родину та супроводжувати',
      neededPeopleCount: 2,
      requiredRoles: ['Волонтер'],
      priority: 1,
      status: 'todo',
    },
  ]);

  // Створюємо призначення для першої заявки.
  // ВАЖЛИВО: Використовуємо taskId та userId, а не task_id/user_id!
  await assignmentRepo.save([
    {
      taskId: req1_task1.id,
      userId: volunteer1.id,
      fulfilledRole: 'Водій',
      status: 'assigned',
    }
  ]);

  const request2 = await requestRepo.save({
    creatorId: requester.id,
    title: 'Медикаменти для підрозділу ЗСУ',
    description: 'Потрібні перев\'язувальні матеріали та знеболювальне',
    category: 'medical',
    urgency: 'high',
    requiredClearance: 'frontline',
    latitude: 47.8388,
    longitude: 35.1396,
    isLocationHidden: true,
    status: 'open',
    tags: ['#Медицина', '#Військо'],
  });

  const req2_task1 = await taskRepo.save({
    requestId: request2.id,
    title: 'Закупити та доставити медикаменти',
    neededPeopleCount: 2,
    requiredRoles: ['Водій', 'Медичний допуск'],
    priority: 3,
    status: 'todo',
  });

  // Створюємо призначення для другої заявки
  await assignmentRepo.save({
    taskId: req2_task1.id,
    userId: coord.id,
    fulfilledRole: 'Медичний допуск',
    status: 'assigned',
  });

  console.log('✅ Заявки, підзадачі та призначення створено');

  // ─── Підсумок ─────────────────────────────────────────────────────────────

  console.log('\n🎉 Seed завершено успішно!\n');
  console.log('Тестові облікові дані (пароль для всіх: Password123!):');
  console.log(`  admin@volunteer.ua     → Admin`);
  console.log(`  coordinator@volunteer.ua → Coordinator (Frontline)`);
  console.log(`  volunteer1@volunteer.ua  → Volunteer (Local)`);
  console.log(`  requester@volunteer.ua   → Requester`);

  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error('❌ Помилка seed:', err);
  process.exit(1);
});