import {
  Injectable, NotFoundException, ForbiddenException,
  ConflictException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { TrustVouch } from './entities/trust-vouch.entity';
import { Vehicle } from './entities/vehicle.entity';
import { SystemRole, ClearanceLevel } from '@common/enums';
import { AdminCreateUserDto } from './dto/create-user.dto';

const FRONTLINE_VOUCHES_REQUIRED = parseInt(
  process.env.FRONTLINE_VOUCHES_REQUIRED || '3', 10,
);

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(TrustVouch) private readonly vouchRepo: Repository<TrustVouch>,
    @InjectRepository(Vehicle) private readonly vehicleRepo: Repository<Vehicle>,
  ) {}

  async findById(id: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id },
      relations: ['vehicles', 'receivedVouches'],
    });
    if (!user) throw new NotFoundException('Користувача не знайдено');
    return user;
  }

  async findAll(): Promise<User[]> {
    return this.userRepo.find({
      select: ['id', 'fullName', 'email', 'systemRole', 'clearanceLevel', 'trustScore'],
    });
  }

  // ─── Повний список для адмін-панелі (з vouchCount, isBlocked, isEmailVerified) ──
  async findAllForAdmin(): Promise<any[]> {
    const users = await this.userRepo.find({
      select: [
        'id', 'fullName', 'email', 'systemRole',
        'clearanceLevel', 'isBlocked', 'isEmailVerified', 'trustScore',
      ],
    });

    // Додаємо кількість поручителів для кожного юзера
    const result = await Promise.all(
      users.map(async (u) => {
        const vouchCount = await this.vouchRepo.count({ where: { voucheeId: u.id } });
        return { ...u, vouchCount };
      }),
    );

    return result;
  }

  async updateProfile(
    targetId: string,
    dto: { fullName?: string; phoneNumber?: string; telegramChatId?: string },
    currentUser: User,
  ): Promise<User> {
    if (currentUser.id !== targetId && currentUser.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Можна редагувати лише власний профіль');
    }
    const allowed: Partial<User> = {};
    if (dto.fullName?.trim())    allowed.fullName = dto.fullName.trim();
    if (dto.phoneNumber !== undefined) allowed.phoneNumber = dto.phoneNumber;
    if (dto.telegramChatId !== undefined) allowed.telegramChatId = dto.telegramChatId;
    await this.userRepo.update(targetId, allowed);
    return this.findById(targetId);
  }

  async blockUser(targetId: string, admin: User): Promise<void> {
    if (admin.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Лише адміністратор може блокувати користувачів');
    }
    await this.userRepo.update(targetId, { isBlocked: true });

    // Призупинити всі TrustVouch де цей користувач був поручителем
    await this.vouchRepo.update(
      { voucherId: targetId, isSuspended: false },
      {
        isSuspended: true,
        suspendedAt: new Date(),
        suspensionReason: 'voucher banned by admin',
      },
    );

    // Перерахувати clearance для всіх уражених користувачів
    const affected = await this.vouchRepo.find({
      where: { voucherId: targetId },
      select: ['voucheeId'],
    });
    for (const v of affected) {
      await this.recalculateClearance(v.voucheeId);
    }
  }

  // ─── Розблокування (FR-02e) ───────────────────────────────────────────────
  async unblockUser(targetId: string, admin: User): Promise<void> {
    if (admin.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Лише адміністратор може розблоковувати користувачів');
    }
    const user = await this.userRepo.findOne({ where: { id: targetId } });
    if (!user) throw new NotFoundException('Користувача не знайдено');
    await this.userRepo.update(targetId, { isBlocked: false });
    // НЕ відновлюємо TrustVouch автоматично — адмін має вручну відновити через restoreVouch()
  }

  // ─── Зміна системної ролі (Admin → Coordinator/Volunteer тощо) ───────────
  // Вирішує питання підвищення Volunteer → Coordinator через адмін-панель.
  async changeRole(targetId: string, newRole: SystemRole, admin: User): Promise<User> {
    if (admin.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Лише адміністратор може змінювати ролі');
    }
    if (!Object.values(SystemRole).includes(newRole)) {
      throw new BadRequestException(`Невідома роль: ${newRole}`);
    }
    const target = await this.userRepo.findOne({ where: { id: targetId } });
    if (!target) throw new NotFoundException('Користувача не знайдено');
    if (target.id === admin.id) {
      throw new BadRequestException('Не можна змінити власну роль');
    }

    await this.userRepo.update(targetId, { systemRole: newRole });
    return this.findById(targetId);
  }

  // ─── Зміна рівня допуску (Admin) ──────────────────────────────────────────
  async updateClearance(targetId: string, newLevel: ClearanceLevel, admin: User): Promise<User> {
    if (admin.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Лише адміністратор може змінювати рівень допуску');
    }
    const target = await this.userRepo.findOne({ where: { id: targetId } });
    if (!target) throw new NotFoundException('Користувача не знайдено');

    await this.userRepo.update(targetId, { clearanceLevel: newLevel });
    return this.findById(targetId);
  }

  // ─── Створення користувача адміном ─────────────────────────────────────────
  async createUser(dto: AdminCreateUserDto, admin: User): Promise<User> {
    if (admin.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Лише адміністратор може створювати користувачів');
    }

    const existing = await this.userRepo.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('Користувач з таким email вже існує');
    }

    const user = this.userRepo.create({
      email: dto.email.toLowerCase(),
      passwordHash: dto.password, // Буде захешовано у @BeforeInsert
      fullName: dto.fullName,
      phoneNumber: dto.phoneNumber,
      systemRole: dto.systemRole,
      clearanceLevel: dto.clearanceLevel || ClearanceLevel.LOCAL,
      isEmailVerified: true, // Примусово підтверджуємо при створенні адміном
    });

    await this.userRepo.save(user);
    return this.findById(user.id);
  }

  // ─── Система Поручителів (FR-02) ──────────────────────────────────────────

  async vouchForUser(voucheeId: string, voucher: User): Promise<TrustVouch> {
    if (voucheeId === voucher.id) {
      throw new BadRequestException('Не можна поручитися за самого себе');
    }

    const vouchee = await this.userRepo.findOne({ where: { id: voucheeId } });
    if (!vouchee) throw new NotFoundException('Користувача не знайдено');

    // Поручителем може бути волонтер з FRONTLINE або адмін
    if (
      voucher.clearanceLevel !== ClearanceLevel.FRONTLINE &&
      voucher.systemRole !== SystemRole.ADMIN
    ) {
      throw new ForbiddenException(
        'Поручителем може бути лише верифікований волонтер (рівень FRONTLINE) або адміністратор',
      );
    }

    // Перевірка: поручитель повинен бути верифікованим
    if (!voucher.isEmailVerified) {
      throw new ForbiddenException('Поручитель повинен мати підтверджений email');
    }
    // NOTE(alex): phoneNumber тимчасово не перевіряється — немає SMS-сервісу.
    // Коли SMS буде готовий — розкоментувати нижче.
    // if (!voucher.isPhoneVerified) {
    //   throw new ForbiddenException('Поручитель повинен мати підтверджений номер телефону');
    // }
    if (!voucher.avatarUrl) {
      throw new ForbiddenException('Поручитель повинен мати завантажену аватарку (фото обличчя)');
    }
    if (!voucher.isIdentityVerified) {
      throw new ForbiddenException('Поручитель повинен пройти верифікацію особи адміністратором');
    }

    // Перевірка що поручитель НЕ в бані
    if (voucher.isBlocked) {
      throw new ForbiddenException('Забанений користувач не може поручатися');
    }

    const existing = await this.vouchRepo.findOne({
      where: { voucheeId, voucherId: voucher.id },
    });
    if (existing) {
      throw new ConflictException('Ви вже надали поручительство цьому користувачу');
    }

    const vouch = await this.vouchRepo.save({ voucheeId, voucherId: voucher.id });

    await this.recalculateClearance(voucheeId);

    return vouch;
  }

  async getVouchesForUser(userId: string): Promise<TrustVouch[]> {
    return this.vouchRepo.find({
      where: { voucheeId: userId },
      relations: ['voucher'],
    });
  }

  // ─── Транспорт ────────────────────────────────────────────────────────────

  async addVehicle(userId: string, dto: Partial<Vehicle>): Promise<Vehicle> {
    const vehicle = this.vehicleRepo.create({ ...dto, userId });
    return this.vehicleRepo.save(vehicle);
  }

  async getUserVehicles(userId: string): Promise<Vehicle[]> {
    return this.vehicleRepo.find({ where: { userId } });
  }

  async searchUsers(query: string): Promise<Partial<User>[]> {
    return this.userRepo
      .createQueryBuilder('user')
      .select(['user.id', 'user.fullName', 'user.avatarUrl'])
      .where('user.fullName ILIKE :q OR user.email ILIKE :q', { q: `%${query}%` })
      .limit(10)
      .getMany();
  }

  // ─── Приватні ─────────────────────────────────────────────────────────────

  async recalculateClearance(userId: string): Promise<void> {
    const activeCount = await this.vouchRepo.count({
      where: { voucheeId: userId, isSuspended: false },
    });

    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'clearanceLevel', 'trustScore'],
    });
    if (!user) return;

    let newClearance: ClearanceLevel;

    // FRONTLINE — тільки ручне підтвердження адміном
    // Автоматично максимум до INTERNATIONAL
    if (activeCount >= FRONTLINE_VOUCHES_REQUIRED) {
      newClearance = ClearanceLevel.INTERNATIONAL;
    } else if (activeCount >= 1) {
      newClearance = ClearanceLevel.INTERNATIONAL;
    } else {
      newClearance = ClearanceLevel.LOCAL;
    }

    if (user.clearanceLevel !== newClearance) {
      await this.userRepo.update(userId, {
        clearanceLevel: newClearance,
        trustScore: Math.min(
          100,
          user.trustScore + (newClearance === ClearanceLevel.INTERNATIONAL ? 5 : 0),
        ),
      });
    }
  }

  // DEPRECATED: використовуйте recalculateClearance()
  private async checkAndUpgradeClearance(userId: string): Promise<void> {
    return this.recalculateClearance(userId);
  }

  async restoreVouch(vouchId: string, admin: User): Promise<TrustVouch> {
    if (admin.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Лише адміністратор може відновлювати поручительства');
    }

    const vouch = await this.vouchRepo.findOne({
      where: { id: vouchId },
      relations: ['voucher'],
    });
    if (!vouch) throw new NotFoundException('Поручительство не знайдено');
    if (!vouch.isSuspended) {
      throw new BadRequestException('Поручительство вже активне');
    }

    if (vouch.voucher?.isBlocked) {
      throw new ForbiddenException('Неможливо відновити: поручитель забанений');
    }

    await this.vouchRepo.update(vouchId, {
      isSuspended: false,
      suspendedAt: null,
      suspensionReason: null,
    });

    await this.recalculateClearance(vouch.voucheeId);

    return this.vouchRepo.findOne({
      where: { id: vouchId },
      relations: ['voucher', 'vouchee'],
    }) as Promise<TrustVouch>;
  }

  async revokeVouchPermanently(vouchId: string, admin: User): Promise<void> {
    if (admin.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Лише адміністратор може відкликати поручительство');
    }

    const vouch = await this.vouchRepo.findOne({ where: { id: vouchId } });
    if (!vouch) throw new NotFoundException('Поручительство не знайдено');

    const voucheeId = vouch.voucheeId;

    await this.vouchRepo.delete(vouchId);
    await this.recalculateClearance(voucheeId);
  }

  /**
   * Інфраструктура для верифікації телефону.
   * Зараз — заглушки (stub), реальний SMS-сервіс буде додано пізніше.
   * Потрібно для майбутньої обов'язкової перевірки в vouchForUser.
   */
  // TODO(alex): Implement real SMS-sending service when Twilio/AmazonSNS/etc. is available - TICKET-???
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async sendPhoneVerificationCode(userId: string): Promise<{ message: string }> {
    console.log(`[SMS STUB] Generating verification code for user ${userId}`);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    // В реальності — зберігаємо код + expires, відправляємо SMS
    await this.userRepo.update(userId, {
      phoneVerificationCode: code,
      phoneVerificationExpires: new Date(Date.now() + 10 * 60 * 1000), // 10 хв
    });
    console.log(`[SMS STUB] Code for user ${userId}: ${code}`);
    return { message: 'SMS verification not yet enabled. Code logged for dev.' };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async verifyPhone(userId: string, codeInput: string): Promise<boolean> {
    console.log(`[SMS STUB] Verifying phone for user ${userId} with code ${codeInput}`);
    // TODO(alex): Real verification when SMS is ready - compare code & expires
    // For now — mark as verified (dev mode)
    await this.userRepo.update(userId, {
      isPhoneVerified: true,
      phoneVerificationCode: null,
      phoneVerificationExpires: null,
    });
    console.log(`[SMS STUB] Phone for user ${userId} marked as verified`);
    return true;
  }
}
