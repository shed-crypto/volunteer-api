/**
 * Seed-скрипт: повне наповнення БД тестовими даними для розробки.
 * Запуск: npm run seed
 *
 * Демонструє ВСІ можливості системи:
 * - 10 користувачів (admin, coordinator (2), volunteer (4), requester (2), blocked (1))
 * - Поручительства (TrustVouch) — з автоматичним підвищенням рівня
 * - Заблокований користувач
 * - Транспортні засоби
 * - Ієрархія організацій (3 + 1 незалежна)
 * - Hubs (склади)
 * - 7 заявок різних статусів
 * - 12+ підзадач з призначеннями
 * - Делегування задач (FR-04)
 * - Task Reports (звіти)
 * - Access logs
 * - Saved requests
 * - Чати всіх типів (TASK_CHAT, ORG_CHAT, DIRECT) з повідомленнями
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import * as path from 'path';
import { config } from 'dotenv';

import { User } from '../../modules/users/entities/user.entity';
import { Vehicle } from '../../modules/users/entities/vehicle.entity';
import { TrustVouch } from '../../modules/users/entities/trust-vouch.entity';
import { Organization } from '../../modules/organizations/entities/organization.entity';
import { OrganizationMember } from '../../modules/organizations/entities/organization-member.entity';
import { Hub } from '../../modules/organizations/entities/hub.entity';
import { OrganizationSettings } from '../../modules/organizations/entities/organization-settings.entity';
import { OrganizationJoinRequest } from '../../modules/organizations/entities/organization-join-request.entity';
import { Request } from '../../modules/requests/entities/request.entity';
import { Task } from '../../modules/tasks/entities/task.entity';
import { TaskAssignment } from '../../modules/tasks/entities/task-assignment.entity';
import { TaskDelegation } from '../../modules/tasks/entities/task-delegation.entity';
import { Message } from '../../modules/chat/entities/message.entity';
import { Chat } from '../../modules/chat/entities/chat.entity';
import { TaskReport } from '../../modules/task-reports/entities/task-report.entity';
import { SavedRequest } from '../../modules/requests/entities/saved-request.entity';
import { AccessLog } from '../../modules/requests/entities/access-log.entity';

config();

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER || 'volunteer',
  password: process.env.DB_PASSWORD || 'volunteer_pass',
  database: process.env.DB_NAME || 'volunteer_help',
  entities: [
    User, Vehicle, TrustVouch,
    Organization, OrganizationMember, Hub, OrganizationSettings, OrganizationJoinRequest,
    Request, Task, TaskAssignment, TaskDelegation,
    Message, Chat,
    TaskReport,
    SavedRequest, AccessLog,
  ],
  synchronize: true,
});

async function seed() {
  await AppDataSource.initialize();
  console.log('✅ З\'єднання з БД встановлено');

  // ─── 1. ОЧИЩЕННЯ ВСІХ ТАБЛИЦЬ (каскадно) ──────────────────────────────────
  await AppDataSource.query('TRUNCATE TABLE '
    + '"task_reports", "trust_vouches", "vehicles", "chat_participants", "messages", "chats", '
    + '"task_assignments", "task_delegations", "tasks", "access_logs", "saved_requests", '
    + '"organization_members", "organization_settings", "hubs", "organization_join_requests", '
    + '"organizations", "requests", "users" '
    + 'RESTART IDENTITY CASCADE');
  console.log('🧹 База даних очищена');

  const userRepo = AppDataSource.getRepository('users');
  const vouchRepo = AppDataSource.getRepository('trust_vouches');
  const vehicleRepo = AppDataSource.getRepository('vehicles');
  const orgRepo = AppDataSource.getRepository('organizations');
  const memberRepo = AppDataSource.getRepository('organization_members');
  const requestRepo = AppDataSource.getRepository('requests');
  const taskRepo = AppDataSource.getRepository('tasks');
  const assignmentRepo = AppDataSource.getRepository('task_assignments');
  const chatRepo = AppDataSource.getRepository('chats');
  const messageRepo = AppDataSource.getRepository('messages');
  const delegationRepo = AppDataSource.getRepository('task_delegations');
  const accessLogRepo = AppDataSource.getRepository('access_logs');
  const savedReqRepo = AppDataSource.getRepository('saved_requests');
  const taskReportRepo = AppDataSource.getRepository('task_reports');
  const hubRepo = AppDataSource.getRepository('hubs');

  const passwordHash = await argon2.hash('Password123!');

  // ─── 2. КОРИСТУВАЧІ (10) ─────────────────────────────────────────────────
  const admin = await userRepo.save({
    email: 'admin@volunteer.ua',
    passwordHash,
    fullName: 'Адміністратор Системи',
    systemRole: 'admin',
    clearanceLevel: 'frontline',
    trustScore: 100,
    isIdentityVerified: true,
  });

  const coord1 = await userRepo.save({
    email: 'coordinator1@volunteer.ua',
    passwordHash,
    fullName: 'Тетяна Мельник',
    systemRole: 'coordinator',
    clearanceLevel: 'frontline',
    trustScore: 90,
    isIdentityVerified: true,
  });

  const coord2 = await userRepo.save({
    email: 'coordinator2@volunteer.ua',
    passwordHash,
    fullName: 'Дмитро Коваленко',
    systemRole: 'coordinator',
    clearanceLevel: 'frontline',
    trustScore: 80,
    isIdentityVerified: true,
  });

  const vol1 = await userRepo.save({
    email: 'volunteer1@volunteer.ua',
    passwordHash,
    fullName: 'Олексій Водій',
    systemRole: 'volunteer',
    clearanceLevel: 'local',
    trustScore: 65,
    isIdentityVerified: true,
  });

  const vol2 = await userRepo.save({
    email: 'volunteer2@volunteer.ua',
    passwordHash,
    fullName: 'Катерина Медик',
    systemRole: 'volunteer',
    clearanceLevel: 'local',
    trustScore: 35,
    isIdentityVerified: true,
  });

  const vol3 = await userRepo.save({
    email: 'volunteer3@volunteer.ua',
    passwordHash,
    fullName: 'Іван Новачок',
    systemRole: 'volunteer',
    clearanceLevel: 'local',
    trustScore: 20,
  });

  const vol4front = await userRepo.save({
    email: 'volunteer4@volunteer.ua',
    passwordHash,
    fullName: 'Сергій Фронтовик',
    systemRole: 'volunteer',
    clearanceLevel: 'local',
    trustScore: 55,
    isIdentityVerified: true,
  });

  const req1 = await userRepo.save({
    email: 'requester1@volunteer.ua',
    passwordHash,
    fullName: 'Марія Потребуюча',
    systemRole: 'requester',
    clearanceLevel: 'local',
    trustScore: 15,
  });

  const req2 = await userRepo.save({
    email: 'requester2@volunteer.ua',
    passwordHash,
    fullName: 'Петро Голобородько',
    systemRole: 'requester',
    clearanceLevel: 'local',
    trustScore: 5,
  });

  const blockedUser = await userRepo.save({
    email: 'blocked@volunteer.ua',
    passwordHash,
    fullName: 'Заблокований Тестовий',
    systemRole: 'volunteer',
    clearanceLevel: 'local',
    trustScore: 10,
    isBlocked: true,
  });

  console.log('✅ 10 користувачів створено (включно з заблокованим)');

  // ─── 3. ПОРУЧИТЕЛЬСТВА (7) — FR-02 ──────────────────────────────────────
  // coordinator1 → volunteer1, coordinator2 → volunteer1
  // volunteer1 → volunteer2, volunteer3 (1 кожному)
  // volunteer1 → vol4front (3 поручителя → FRONTLINE!)
  await vouchRepo.save([
    { voucheeId: vol1.id, voucherId: coord1.id, comment: 'Олексій перевірений, має досвід роботи в зоні ООС' },
    { voucheeId: vol1.id, voucherId: coord2.id, comment: 'Знаю Олексія особисто, надійний водій' },
    { voucheeId: vol2.id, voucherId: vol1.id, comment: 'Катерина працювала в нашій медичній бригаді' },
    { voucheeId: vol3.id, voucherId: vol1.id, comment: 'Іван пройшов навчання, готовий до роботи' },
    // vol4front отримує 3 поручителя → автоматично FRONTLINE
    { voucheeId: vol4front.id, voucherId: vol1.id, comment: 'Сергій дуже надійний, багато разів їхав на фронт' },
    { voucheeId: vol4front.id, voucherId: coord1.id, comment: 'Підтверджую, Сергій має FRONTLINE досвід' },
    { voucheeId: vol4front.id, voucherId: coord2.id, comment: 'Поручаюсь за Сергія, знаю особисто' },
  ]);
  console.log('✅ 7 поручительств створено');

  // Автоматично оновлюємо clearance на основі поручительств
  await userRepo.update(vol1.id, { clearanceLevel: 'international', trustScore: 65 });
  await userRepo.update(vol2.id, { clearanceLevel: 'international', trustScore: 35 });
  await userRepo.update(vol4front.id, { clearanceLevel: 'frontline', trustScore: 85 });
  // vol3 залишається local (1 поручитель)

  // ─── 4. ТРАНСПОРТНІ ЗАСОБИ ──────────────────────────────────────────────
  await vehicleRepo.save([
    { userId: vol1.id, type: 'van', brand: 'Mercedes-Benz', model: 'Sprinter 316', year: 2019, color: 'Білий', plateNumber: 'AA1234BC', status: 'active', capacity: 8, has4x4: true },
    { userId: vol1.id, type: 'pickup', brand: 'Mitsubishi', model: 'L200', year: 2021, color: 'Сірий', plateNumber: 'AA5678BC', status: 'active', capacity: 4, has4x4: true },
    { userId: coord1.id, type: 'passenger', brand: 'Toyota', model: 'Land Cruiser Prado', year: 2022, color: 'Зелений', plateNumber: 'AA9012BC', status: 'active', capacity: 5, has4x4: true },
    { userId: vol4front.id, type: 'pickup', brand: 'Ford', model: 'Ranger', year: 2020, color: 'Чорний', plateNumber: 'AA4567DE', status: 'active', capacity: 4, has4x4: true },
  ]);
  console.log('✅ 4 транспортних засоби створено');

  // ─── 5. ОРГАНІЗАЦІЇ (4: 1 сімейство + 1 незалежна) ──────────────────────
  const orgRoot = await orgRepo.save({
    name: 'Волонтерський Центр "Правий Берег"',
    description: 'Координація допомоги Київській, Херсонській та Запорізькій областям.',
    isPublic: true,
    tags: ['#Евакуація', '#Гуманітарна', '#Медицина', '#Логістика'],
  });

  const orgMed = await orgRepo.save({
    name: 'Медична бригада Правого Берега',
    description: 'Підрозділ медичної допомоги — закупівля, такмед, евакуація поранених.',
    parentOrgId: orgRoot.id,
    isPublic: true,
    tags: ['#Медицина', '#Такмед'],
  });

  const orgLog = await orgRepo.save({
    name: 'Логістичний Хаб "Схід"',
    description: 'Складська логістика та відправка гуманітарних вантажів на схід.',
    parentOrgId: orgRoot.id,
    isPublic: true,
    tags: ['#Логістика', '#Склад'],
  });

  const orgIndep = await orgRepo.save({
    name: 'Гуманітарний Рух "Добро"', // Незалежна організація
    description: 'Самостійна волонтерська спільнота, що діє в Харківській та Сумській областях.',
    isPublic: true,
    tags: ['#Гуманітарна', '#Евакуація', '#Психологічна'],
  });

  await memberRepo.save([
    { organizationId: orgRoot.id, userId: coord1.id, orgRole: 'leader' },
    { organizationId: orgRoot.id, userId: coord2.id, orgRole: 'coordinator', isDeputy: true },
    { organizationId: orgRoot.id, userId: vol1.id, orgRole: 'member' },
    { organizationId: orgRoot.id, userId: vol4front.id, orgRole: 'member' },
    { organizationId: orgMed.id, userId: coord1.id, orgRole: 'coordinator' },
    { organizationId: orgMed.id, userId: vol2.id, orgRole: 'member' },
    { organizationId: orgLog.id, userId: coord2.id, orgRole: 'leader' },
    { organizationId: orgLog.id, userId: vol1.id, orgRole: 'member' },
    { organizationId: orgLog.id, userId: vol3.id, orgRole: 'member' },
    { organizationId: orgIndep.id, userId: req2.id, orgRole: 'leader' }, // requester2 — лідер незалежної
    { organizationId: orgIndep.id, userId: vol4front.id, orgRole: 'member' }, // Фронтовик в двох місцях
  ]);
  console.log('✅ 4 організації та 11 членів створено');

  // ─── 6. HUBS (СКЛАДИ) ────────────────────────────────────────────────────
  await hubRepo.save([
    {
      name: 'Склад Центральний "Правий Берег"',
      address: 'м. Київ, вул. Волонтерська, 12',
      latitude: 50.4501,
      longitude: 30.5234,
      description: 'Центральний склад для сортування та зберігання гуманітарної допомоги.',
      isPublic: true,
      organizationId: orgLog.id,
    },
    {
      name: 'Польова точка "Запоріжжя"',
      address: 'м. Запоріжжя, вул. Логістична, 7',
      latitude: 47.8388,
      longitude: 35.1396,
      description: 'Транзитна точка для швидкої видачі на східному напрямку.',
      isPublic: true,
      organizationId: orgLog.id,
    },
  ]);
  console.log('✅ 2 Hub (склади) створено');

  // ─── 7. ЗАЯВКИ (7) + ПІДЗАДАЧІ ──────────────────────────────────────────
  // ─── 7.1 Заявка #1: Евакуація (IN_PROGRESS) ───────────────────────────
  const req1entity = await requestRepo.save({
    creatorId: req1.id,
    title: 'Евакуація родини з Херсонської області',
    description: 'Потрібно вивезти 4 особи (2 дорослих, 2 дітей) із с. Тягинка Херсонської області. Родина в підвалі.',
    category: 'evacuation',
    urgency: 'critical',
    requiredClearance: 'local',
    address: 'с. Тягинка, Херсонська обл.',
    latitude: 46.6354,
    longitude: 32.6169,
    isLocationHidden: false,
    status: 'in_progress',
    deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    tags: ['#Евакуація', '#Термінова', '#Діти'],
  });

  const task1_1 = await taskRepo.save({
    requestId: req1entity.id,
    title: 'Знайти транспорт (мікроавтобус)',
    description: 'Потрібен транспорт на 4+ пасажирів з повним приводом.',
    neededPeopleCount: 1,
    requiredRoles: ['Водій', 'Мікроавтобус', 'Повний привід'],
    priority: 2,
    status: 'todo',
    createdByUserId: req1.id,
    origin: 'requester',
  });

  const task1_2 = await taskRepo.save({
    requestId: req1entity.id,
    title: 'Зустріти родину та супроводжувати до Києва',
    description: 'Зустріти на блокпості, перевірити документи, супроводити до тимчасового житла.',
    neededPeopleCount: 2,
    requiredRoles: ['Волонтер'],
    priority: 1,
    status: 'in_progress',
    createdByUserId: req1.id,
    origin: 'requester',
  });

  await assignmentRepo.save({
    taskId: task1_2.id,
    userId: vol1.id,
    fulfilledRole: 'Водій',
    status: 'assigned',
  });

  const chat1 = await chatRepo.save({ type: 'task_chat', relatedRequestId: req1entity.id });
  for (const uid of [req1.id, vol1.id]) {
    await AppDataSource.query('INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [chat1.id, uid]);
  }
  await messageRepo.save([
    { chatId: chat1.id, senderId: null, content: '🚀 Задачу взято в роботу волонтером Олексій Водій.', messageType: 'system', messageStatus: 'sent', sentAt: new Date(Date.now() - 3600000) },
    { chatId: chat1.id, senderId: vol1.id, content: 'Вітаю, Маріє! Я Олексій, готовий виїжджати завтра.', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 3300000) },
    { chatId: chat1.id, senderId: req1.id, content: 'Дякую! Скинула координати. Діти вже не можуть у підвалі.', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 3000000) },
  ]);
  await taskRepo.update(task1_2.id, { chatId: chat1.id });

  // ─── 7.2 Заявка #2: Медикаменти (COMPLETED) ────────────────────────────
  const req2entity = await requestRepo.save({
    creatorId: coord1.id,
    title: 'Медикаменти для підрозділу ЗСУ',
    description: 'Потрібні перев\'язувальні матеріали, турнікети, знеболювальне.',
    category: 'military',
    urgency: 'high',
    requiredClearance: 'frontline',
    address: 'м. Запоріжжя, точка видачі',
    latitude: 47.8388,
    longitude: 35.1396,
    isLocationHidden: true,
    status: 'completed',
    tags: ['#Медицина', '#Військо', '#Фронт'],
  });

  const task2_1 = await taskRepo.save({
    requestId: req2entity.id,
    title: 'Закупити та доставити медикаменти',
    description: 'Потрібен водій з frontline-доступом.',
    neededPeopleCount: 2,
    requiredRoles: ['Водій', 'Медик'],
    priority: 3,
    status: 'done',
    createdByUserId: coord1.id,
    origin: 'coordinator',
  });

  await assignmentRepo.save([
    { taskId: task2_1.id, userId: vol1.id, fulfilledRole: 'Водій', status: 'completed', completedAt: new Date(Date.now() - 172800000) },
    { taskId: task2_1.id, userId: vol2.id, fulfilledRole: 'Медик', status: 'completed', completedAt: new Date(Date.now() - 172800000) },
  ]);

  // Чат для 2.1
  const chat2 = await chatRepo.save({ type: 'task_chat', relatedRequestId: req2entity.id });
  for (const uid of [coord1.id, vol1.id, vol2.id]) {
    await AppDataSource.query('INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [chat2.id, uid]);
  }
  await messageRepo.save([
    { chatId: chat2.id, senderId: null, content: '🚀 Задачу взято в роботу.', messageType: 'system', messageStatus: 'sent', sentAt: new Date(Date.now() - 259200000) },
    { chatId: chat2.id, senderId: vol2.id, content: 'Все є в наявності, можемо виїжджати.', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 258900000) },
    { chatId: chat2.id, senderId: vol1.id, content: 'Забрав о 14:30, доставив о 18:00. Все прийнято військовими.', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 172800000) },
  ]);
  await taskRepo.update(task2_1.id, { chatId: chat2.id });

  // ─── 7.3 Заявка #3: Гуманітарка (OPEN) ─────────────────────────────────
  const req3entity = await requestRepo.save({
    creatorId: req1.id,
    title: 'Доставка гуманітарної допомоги до Миколаєва',
    description: 'Зібрано 500 кг гуманітарного вантажу.',
    category: 'humanitarian',
    urgency: 'medium',
    requiredClearance: 'local',
    address: 'м. Миколаїв, Центр видачі',
    latitude: 46.9750,
    longitude: 31.9946,
    isLocationHidden: false,
    status: 'open',
    deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    tags: ['#Гуманітарна', '#Продовольство', '#Логістика'],
  });

  await taskRepo.save({
    requestId: req3entity.id,
    title: 'Знайти водія з вантажівкою',
    description: '500 кг вантажу. Потрібна вантажівка.', neededPeopleCount: 1,
    requiredRoles: ['Водій', 'Вантажівка'], priority: 1, status: 'todo',
    createdByUserId: req1.id, origin: 'requester', isAutoGenerated: true,
  });
  await taskRepo.save({
    requestId: req3entity.id,
    title: 'Завантажити гуманітарний вантаж',
    description: 'Допомога із завантаженням.', neededPeopleCount: 2,
    requiredRoles: ['Вантажник'], priority: 0, status: 'todo',
    createdByUserId: req1.id, origin: 'requester',
  });

  // ─── 7.4 Заявка #4: Психологічна підтримка (OPEN) ──────────────────────
  await requestRepo.save({
    creatorId: req2.id,
    title: 'Психологічна підтримка для ВПО з Маріуполя',
    description: 'Група з 8 жінок та дітей. Потрібен психолог.',
    category: 'psychological',
    urgency: 'low',
    requiredClearance: 'local',
    address: 'м. Дніпро, центр адаптації ВПО',
    latitude: 48.4647,
    longitude: 35.0462,
    isLocationHidden: false,
    status: 'open',
    tags: ['#Психологічна', '#ВПО', '#Діти'],
  });

  // ─── 7.5 Заявка #5: Ремонт даху (PARTIALLY_DONE) ────────────────────────
  const req5entity = await requestRepo.save({
    creatorId: req2.id,
    title: 'Терміновий ремонт даху після обстрілу',
    description: 'Пошкоджено дах будинку. 12 квартир потребують тимчасового укриття.',
    category: 'shelter',
    urgency: 'high',
    requiredClearance: 'local',
    address: 'м. Одеса, вул. Чорноморська, 42',
    latitude: 46.4843,
    longitude: 30.7326,
    isLocationHidden: false,
    status: 'partially_done',
    tags: ['#Житло', '#Будівництво'],
  });

  const task5_1 = await taskRepo.save({
    requestId: req5entity.id, title: 'Закупівля будматеріалів', description: 'Шифер, руберойд, дошки.',
    neededPeopleCount: 1, requiredRoles: ['Водій', 'Вантажівка'], priority: 2, status: 'done',
    createdByUserId: coord1.id, origin: 'coordinator',
  });
  const task5_2 = await taskRepo.save({
    requestId: req5entity.id, title: 'Ремонтні роботи на даху', description: 'Демонтаж, покриття шифером.',
    neededPeopleCount: 3, requiredRoles: ['Будівельник', 'Висотні роботи'], priority: 1, status: 'in_progress',
    createdByUserId: coord1.id, origin: 'coordinator',
  });

  await assignmentRepo.save([
    { taskId: task5_1.id, userId: vol1.id, fulfilledRole: 'Водій', status: 'completed', completedAt: new Date(Date.now() - 86400000) },
    { taskId: task5_2.id, userId: vol3.id, fulfilledRole: 'Будівельник', status: 'assigned' },
  ]);

  const chat5 = await chatRepo.save({ type: 'task_chat', relatedRequestId: req5entity.id });
  for (const uid of [req2.id, coord1.id, vol3.id, vol1.id]) {
    await AppDataSource.query('INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [chat5.id, uid]);
  }
  await messageRepo.save([
    { chatId: chat5.id, senderId: null, content: '🚀 Задачу взято в роботу.', messageType: 'system', messageStatus: 'sent', sentAt: new Date(Date.now() - 7200000) },
    { chatId: chat5.id, senderId: vol3.id, content: 'Вітаю, я Іван! Маю досвід покрівельних робіт, можу почати завтра.', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 7000000) },
    { chatId: chat5.id, senderId: req2.id, content: 'Дякую, Іване! Я знайшов ще одного волонтера.', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 6500000) },
  ]);
  await taskRepo.update(task5_2.id, { chatId: chat5.id });

  // ─── 7.6 Заявка #6: Генератор для лікарні (IN_PROGRESS) ─────────────────
  const req6entity = await requestRepo.save({
    creatorId: coord2.id,
    title: 'Генератор для районної лікарні',
    description: 'Потужний генератор 20+ кВт для районної лікарні в м. Мар\'їнка.',
    category: 'logistics',
    urgency: 'critical',
    requiredClearance: 'frontline',
    address: 'м. Мар\'їнка, Донецька обл.',
    latitude: 47.9419,
    longitude: 37.5111,
    isLocationHidden: true,
    status: 'in_progress',
    deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    tags: ['#Логістика', '#Термінова', '#Фронт'],
  });

  const task6_1 = await taskRepo.save({
    requestId: req6entity.id, title: 'Пошук та придбання генератора 20+ кВт',
    description: 'Бюджет — 150 000 грн.', neededPeopleCount: 1,
    requiredRoles: ['Координатор', 'Закупівля'], priority: 3, status: 'in_progress',
    createdByUserId: coord2.id, origin: 'coordinator',
  });
  const task6_2 = await taskRepo.save({
    requestId: req6entity.id, title: 'Доставка генератора до лікарні',
    description: 'Доставка Київ → Мар\'їнка.', neededPeopleCount: 2,
    requiredRoles: ['Водій', 'Вантажник', 'Доступ frontline'], priority: 2, status: 'todo',
    createdByUserId: coord2.id, origin: 'coordinator',
  });

  await assignmentRepo.save({
    taskId: task6_1.id, userId: coord2.id, fulfilledRole: 'Координатор', status: 'assigned',
  });

  const chat6 = await chatRepo.save({ type: 'task_chat', relatedRequestId: req6entity.id });
  for (const uid of [coord2.id, coord1.id]) {
    await AppDataSource.query('INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [chat6.id, uid]);
  }
  await messageRepo.save([
    { chatId: chat6.id, senderId: coord2.id, content: 'Знайшов генератор в Києві за 145 000 грн. Потрібна твоя віза.', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 10800000) },
    { chatId: chat6.id, senderId: coord1.id, content: 'Добре, давай дзвінок о 16:00.', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 9000000) },
  ]);
  await taskRepo.update(task6_1.id, { chatId: chat6.id });

  // ─── 7.7 Заявка #7: Дитяче харчування (CANCELLED) ──────────────────────
  const req7entity = await requestRepo.save({
    creatorId: req1.id,
    title: 'Дитяче харчування та підгузки для центру ВПО',
    description: '15 дітей, потрібні суміші та підгузки.',
    category: 'humanitarian',
    urgency: 'medium',
    requiredClearance: 'local',
    address: 'м. Житомир, центр ВПО',
    latitude: 50.2547,
    longitude: 28.6587,
    isLocationHidden: false,
    status: 'cancelled',
    cancelledByUserId: req1.id,
    cancelledAt: new Date(Date.now() - 604800000),
    cancelReason: 'Допомогу надано іншою організацією',
    tags: ['#Гуманітарна', '#Діти'],
  });

  await taskRepo.save({
    requestId: req7entity.id, title: 'Збір та доставка',
    neededPeopleCount: 1, requiredRoles: ['Волонтер', 'Авто'], priority: 0, status: 'cancelled',
    createdByUserId: req1.id, origin: 'requester', isAutoGenerated: true,
  });

  console.log('✅ 7 заявок, 12+ підзадач, призначення та чати створено');

  // ─── 8. ДЕЛЕГУВАННЯ ЗАДАЧ (FR-04) ────────────────────────────────────────
  // task6_2 делегована в "Гуманітарний Рух" (orgIndep), але ще не прийнята
  await delegationRepo.save({
    taskId: task6_2.id,
    organizationId: orgIndep.id,
    delegatedByUserId: coord2.id,
    isAccepted: null,
    message: 'Шановні колеги, ми перевантажені. Чи можете взяти доставку генератора на себе? Дякуємо!',
  });

  // task1_1 делегована в "Логістичний Хаб" і ПРИЙНЯТА
  await delegationRepo.save({
    taskId: task1_1.id,
    organizationId: orgLog.id,
    delegatedByUserId: coord1.id,
    isAccepted: true,
    message: 'Наш водій готовий. Скиньте, будь ласка, точні координати.',
  });

  console.log('✅ 2 делегування створено (1 прийнято, 1 — очікує)');

  // ─── 9. TASK REPORTS (ЗВІТИ) ──────────────────────────────────────────────
  await taskReportRepo.save({
    taskId: task2_1.id,
    userId: vol1.id,
    comment: 'Доставку завершено. Вантаж прийнято військовими о 18:00.',
    isVerified: true,
    verifiedById: coord1.id,
    verifiedAt: new Date(Date.now() - 172700000),
  });
  console.log('✅ Task report створено');

  // ─── 10. ACCESS LOGS ─────────────────────────────────────────────────────
  await accessLogRepo.save([
    { userId: vol4front.id, requestId: req2entity.id, action: 'view_detail', ip: '185.15.38.21', userAgent: 'Mozilla/5.0 (Linux; Android 10)', clearanceAtAccess: 'frontline' },
    { userId: vol1.id, requestId: req2entity.id, action: 'view_detail', ip: '185.15.38.22', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16)', clearanceAtAccess: 'international' },
    { userId: coord2.id, requestId: req6entity.id, action: 'view_detail', ip: '185.15.38.23', userAgent: 'Mozilla/5.0 (Windows NT 10.0)', clearanceAtAccess: 'frontline' },
    { userId: vol1.id, requestId: req3entity.id, action: 'view_list', ip: '185.15.38.22', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16)', clearanceAtAccess: 'international' },
  ]);
  console.log('✅ 4 access log записи створено');

  // ─── 11. SAVED REQUESTS (BOOKMARKS) ─────────────────────────────────────
  await savedReqRepo.save([
    { userId: vol1.id, requestId: req3entity.id },
    { userId: vol1.id, requestId: req5entity.id },
    { userId: vol2.id, requestId: req1entity.id },
  ]);
  console.log('✅ 3 saved requests (bookmarks) створено');

  // ─── 12. ДОДАТКОВІ ЧАТИ ─────────────────────────────────────────────────
  // ─── 12.1 DIRECT чат (vol1 ↔ vol2) ──────────────────────────────────────
  const chatDirect = await chatRepo.save({ type: 'direct' });
  for (const uid of [vol1.id, vol2.id]) {
    await AppDataSource.query('INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [chatDirect.id, uid]);
  }
  await messageRepo.save([
    { chatId: chatDirect.id, senderId: vol1.id, content: 'Катерино, привіт! Чи не знаєш дати контакт медика з твоєї бригади?', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 86400000) },
    { chatId: chatDirect.id, senderId: vol2.id, content: 'Привіт, Олексій! Так, зараз пишу в групу — там є один досвідчений хірург.', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 86000000) },
    { chatId: chatDirect.id, senderId: vol1.id, content: 'Дякую! Скинь, будь ласка.', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 85000000) },
  ]);

  // ─── 12.2 ORG_CHAT (організація "Правий Берег") ─────────────────────────
  const chatOrg = await chatRepo.save({ type: 'org_chat', relatedOrgId: orgRoot.id, name: 'Правий Берег — Загальний' });
  for (const uid of [coord1.id, coord2.id, vol1.id, vol4front.id, vol2.id]) {
    await AppDataSource.query('INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [chatOrg.id, uid]);
  }
  await messageRepo.save([
    { chatId: chatOrg.id, senderId: coord1.id, content: 'Колеги, на наступному тижні плануємо конвой до Херсону. Хто готовий?', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 43200000) },
    { chatId: chatOrg.id, senderId: vol4front.id, content: 'Я готовий! Мав успішні рейси цього місяця, генератор вже доставив.', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 43000000) },
    { chatId: chatOrg.id, senderId: coord2.id, content: 'Чудово, Сергію! Я додам це до розкладу. Олексій, ти зможеш супроводжувати?', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 42500000) },
    { chatId: chatOrg.id, senderId: vol1.id, content: 'Так, буду в Києві, можу виїжджати разом з Сергієм.', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 42000000) },
  ]);

  // ─── 12.3 DIRECT: admin ↔ requester1 (підтримка) ────────────────────────
  const chatSupport = await chatRepo.save({ type: 'direct' });
  for (const uid of [admin.id, req1.id]) {
    await AppDataSource.query('INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [chatSupport.id, uid]);
  }
  await messageRepo.save([
    { chatId: chatSupport.id, senderId: req1.id, content: 'Добрий день! Потрібна допомога з моїм акаунтом, не можу змінити телефон.', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 172800000) },
    { chatId: chatSupport.id, senderId: admin.id, content: 'Вітаю, Маріє! Допоможемо. Перевірте, будь ласка, вкладку Профіль → Редагувати.', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 172600000) },
    { chatId: chatSupport.id, senderId: req1.id, content: 'Знайшла, дякую! Помилка зникла.', messageType: 'text', messageStatus: 'sent', sentAt: new Date(Date.now() - 172400000) },
  ]);

  // Додаємо унікальний індекс
  try {
    await AppDataSource.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_participants_unique ON chat_participants (chat_id, user_id)');
  } catch { /* ігноруємо */ }

  console.log('✅ Чати всіх типів створено: TASK_CHAT (4), DIRECT (2), ORG_CHAT (1)');

  // ─── 13. ОНОВЛЮЄМО updated_at для всіх чатів ─────────────────────────────
  await AppDataSource.query('UPDATE "chats" SET "updated_at" = NOW() WHERE "updated_at" IS NULL');

  // ─── ПІДСУМОК ─────────────────────────────────────────────────────────────
  console.log('\n🎉 MEGA SEED завершено успішно!\n');
  console.log('Тестові облікові дані (пароль: Password123!):');
  console.log('  ─── Адміністратор ───');
  console.log('  admin@volunteer.ua          → Admin (Frontline)');
  console.log('  ─── Координатори ───');
  console.log('  coordinator1@volunteer.ua   → Coordinator (Frontline) — Тетяна');
  console.log('  coordinator2@volunteer.ua   → Coordinator (Frontline) — Дмитро');
  console.log('  ─── Волонтери ───');
  console.log('  volunteer1@volunteer.ua     → Volunteer (International) — Олексій');
  console.log('  volunteer2@volunteer.ua     → Volunteer (International) — Катерина');
  console.log('  volunteer3@volunteer.ua     → Volunteer (Local) — Іван');
  console.log('  volunteer4@volunteer.ua     → Volunteer (FRONTLINE!) — Сергій (3+ поручителі)');
  console.log('  ─── Потребуючі ───');
  console.log('  requester1@volunteer.ua     → Mariya');
  console.log('  requester2@volunteer.ua     → Petro');
  console.log('  ─── Заблокований ───');
  console.log('  blocked@volunteer.ua      → Blocked (isBlocked: true)');
  console.log('\nСтатистика:');
  console.log('  • Користувачів: 10 (1 заблокований)');
  console.log('  • Поручительств: 7 (volunteer4 має FRONTLINE через 3 поручителі)');
  console.log('  • Транспорт: 4 од.');
  console.log('  • Організацій: 4 (3 в ієрархії + 1 незалежна)');
  console.log('  • Hubs (склади): 2');
  console.log('  • Заявок: 7 (різних статусів)');
  console.log('  • Підзадач: 12+');
  console.log('  • Делегування: 2 (1 прийнято, 1 — очікує)');
  console.log('  • Task Reports: 1');
  console.log('  • Access logs: 4');
  console.log('  • Saved requests: 3');
  console.log('  • Чатів з повідомленнями: 7');
  console.log('  • Всього повідомлень: 20+');

  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error('❌ Помилка seed:', err);
  process.exit(1);
});