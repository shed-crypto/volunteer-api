import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UsersService } from '../modules/users/users.service';
import { SystemRole, ClearanceLevel } from '../common/enums';
import { User } from '../modules/users/entities/user.entity';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const userRepo = app.get<Repository<User>>(getRepositoryToken(User));

  const adminEmail = process.argv[2] || 'admin@volunteer.ua';
  const adminPass = process.argv[3] || 'admin12345';
  const adminName = process.argv[4] || 'Головний Адмін';

  console.log(`--- Створення адміна: ${adminEmail} ---`);

  const existing = await userRepo.findOne({ where: { email: adminEmail.toLowerCase() } });
  if (existing) {
    console.log('Помилка: Користувач з таким email вже існує.');
    await app.close();
    return;
  }

  const admin = userRepo.create({
    email: adminEmail.toLowerCase(),
    passwordHash: adminPass, // Буде захешовано у @BeforeInsert
    fullName: adminName,
    systemRole: SystemRole.ADMIN,
    clearanceLevel: ClearanceLevel.FRONTLINE,
    isEmailVerified: true,
  });

  await userRepo.save(admin);
  console.log('✅ Адміна успішно створено!');
  console.log(`Email: ${adminEmail}`);
  console.log(`Пароль: ${adminPass}`);
  
  await app.close();
}

bootstrap().catch(err => {
  console.error('❌ Помилка при виконанні скрипта:', err);
  process.exit(1);
});