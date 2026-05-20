import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RequestsService } from '../modules/requests/requests.service';
import { User } from '../modules/users/entities/user.entity';
import { UsersService } from '../modules/users/users.service';
import { RequestCategory, RequestUrgency, ClearanceLevel } from '../common/enums';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

const CATEGORIES = [
  RequestCategory.MEDICAL, RequestCategory.EVACUATION, RequestCategory.LOGISTICS,
  RequestCategory.MILITARY, RequestCategory.HUMANITARIAN, RequestCategory.SHELTER, RequestCategory.PSYCHOLOGICAL,
];
const URGENCIES = [RequestUrgency.LOW, RequestUrgency.MEDIUM, RequestUrgency.HIGH, RequestUrgency.CRITICAL];
const TITLES = [
  'Потрібна медична допомога', 'Термінова евакуація', 'Доставка продуктів',
  'Потрібен транспорт', 'Ремонт авто', 'Потрібні ліки', 'Притулок для сім\'ї',
  'Психологічна підтримка', 'Потрібна вода', 'Пальне для генератора',
  'Дитяче харчування', 'Засоби гігієни', 'Опалення дровами',
  'Потрібен зв\'язок', 'Будівельні матеріали', 'Теплий одяг',
  'Військова амуніція', 'Аптечка першої допомоги', 'Корм для тварин',
  'Ремонт даху', 'Вікна/скло', 'Генератор', 'Павербанки', 'Ліхтарі/батарейки',
  'Ковдри/спальники', 'Потрібен ноутбук', 'Зарядна станція',
  'Посуд/кухонне приладдя', 'Дитячі речі', 'Підгузки',
  'Потрібне авто з повним приводом', 'Вантажне перевезення', 'Координація евакуації',
  'Потрібна юридична допомога', 'Оформлення документів', 'Потрібен перекладач',
  'Потрібні насоси/помпи', 'Пісок/мішки', 'Будівельний інвентар',
];

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const requestsService = app.get(RequestsService);
  const userRepo = app.get<Repository<User>>(getRepositoryToken(User));
  const usersService = app.get(UsersService);

  let creator = await userRepo.findOne({ where: { email: 'requester1@volunteer.ua' } });
  if (!creator) {
    const admin = await userRepo.findOneOrFail({ where: { email: 'admin@volunteer.ua' } });
    creator = await usersService.createUser({
      email: 'requester1@volunteer.ua',
      password: 'password123',
      fullName: 'Потребуючий Тестовий',
      systemRole: 'requester' as any,
    }, admin);
  }

  console.log(`Creating 50 requests as ${creator.fullName}...`);

  for (let i = 0; i < 50; i++) {
    const title = TITLES[i % TITLES.length];
    const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    const urgency = URGENCIES[Math.floor(Math.random() * URGENCIES.length)];

    await requestsService.create({
      title: `${title} #${i + 1}`,
      description: `Тестова заявка #${i + 1}. Створено для перевірки пагінації.`,
      category,
      urgency,
      requiredClearance: ClearanceLevel.LOCAL,
      address: 'м. Київ, тестова адреса',
      latitude: 50.45 + (Math.random() - 0.5) * 0.5,
      longitude: 30.52 + (Math.random() - 0.5) * 0.5,
      isLocationHidden: Math.random() < 0.3,
    }, creator);

    console.log(`  [${i + 1}/50] ${title} #${i + 1} — ${category} — ${urgency}`);
  }

  console.log('Done! 50 requests created.');
  await app.close();
}

seed().catch((err) => { console.error('Seed failed:', err); process.exit(1); });