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
  }

  // ─── Розблокування (FR-02e) ───────────────────────────────────────────────
  async unblockUser(targetId: string, admin: User): Promise<void> {
    if (admin.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Лише адміністратор може розблоковувати користувачів');
    }
    const user = await this.userRepo.findOne({ where: { id: targetId } });
    if (!user) throw new NotFoundException('Користувача не знайдено');
    await this.userRepo.update(targetId, { isBlocked: false });
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

    const existing = await this.vouchRepo.findOne({
      where: { voucheeId, voucherId: voucher.id },
    });
    if (existing) {
      throw new ConflictException('Ви вже надали поручительство цьому користувачу');
    }

    const vouch = await this.vouchRepo.save({ voucheeId, voucherId: voucher.id });

    await this.checkAndUpgradeClearance(voucheeId);

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

  // ─── Приватні ─────────────────────────────────────────────────────────────

  private async checkAndUpgradeClearance(userId: string): Promise<void> {
    const count = await this.vouchRepo.count({ where: { voucheeId: userId } });

    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'clearanceLevel', 'trustScore'],
    });

    if (!user) return;

    if (count >= FRONTLINE_VOUCHES_REQUIRED &&
        user.clearanceLevel !== ClearanceLevel.FRONTLINE) {
      await this.userRepo.update(userId, {
        clearanceLevel: ClearanceLevel.FRONTLINE,
        trustScore: Math.min(100, user.trustScore + 20),
      });
    } else if (count >= 1 && user.clearanceLevel === ClearanceLevel.LOCAL) {
      await this.userRepo.update(userId, {
        clearanceLevel: ClearanceLevel.INTERNATIONAL,
        trustScore: Math.min(100, user.trustScore + 5),
      });
    }
  }
}
