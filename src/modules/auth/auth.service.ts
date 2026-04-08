import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { User } from '@modules/users/entities/user.entity';
import { EmailService } from '@modules/email/email.service';
import { RegisterDto, LoginDto, AuthResponseDto } from './dto/auth.dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) {}

  // ─── Реєстрація ─────────────────────────────────────────────────────────────

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existing = await this.userRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('Користувач з таким email вже існує');
    }

    // Генеруємо токен підтвердження пошти
    const emailVerificationToken = uuidv4();

    const user = this.userRepository.create({
      email: dto.email.toLowerCase(),
      passwordHash: dto.password, // хешується у @BeforeInsert() хуку
      fullName: dto.fullName,
      phoneNumber: dto.phoneNumber,
      systemRole: dto.systemRole,   // RegisterDto обмежує лише VOLUNTEER/REQUESTER
      isEmailVerified: false,
      emailVerificationToken,
    });

    await this.userRepository.save(user);

    // Асинхронно надсилаємо лист (не блокуємо відповідь)
    setImmediate(() => {
      this.emailService
        .sendVerificationEmail(user.email, emailVerificationToken)
        .catch(() => {});
    });

    return this.generateTokens(user);
  }

  // ─── Вхід ────────────────────────────────────────────────────────────────────

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.userRepository.findOne({
      where: { email: dto.email.toLowerCase() },
      select: [
        'id', 'email', 'passwordHash', 'fullName',
        'systemRole', 'clearanceLevel', 'isBlocked', 'isEmailVerified',
      ],
    });

    if (!user) {
      throw new UnauthorizedException('Невірний email або пароль');
    }

    if (user.isBlocked) {
      throw new ForbiddenException('Обліковий запис заблоковано адміністратором');
    }

    const isPasswordValid = await user.verifyPassword(dto.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Невірний email або пароль');
    }

    // Попередження (не блокування) — якщо пошта не підтверджена,
    // додаємо прапор у відповідь щоб фронтенд показав банер
    const tokens = await this.generateTokens(user);
    return {
      ...tokens,
      emailVerified: user.isEmailVerified,
    };
  }

  // ─── Підтвердження email ─────────────────────────────────────────────────────

  async verifyEmail(token: string): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      throw new BadRequestException(
        'Токен верифікації недійсний або вже використаний',
      );
    }

    await this.userRepository.update(user.id, {
      isEmailVerified: true,
      emailVerificationToken: null,
    });

    return { message: 'Email успішно підтверджено! Тепер ви можете використовувати всі функції.' };
  }

  // ─── Повторно надіслати лист верифікації ─────────────────────────────────────

  async resendVerificationEmail(userId: string): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'email', 'isEmailVerified', 'emailVerificationToken'],
    });

    if (!user) throw new NotFoundException('Користувача не знайдено');

    if (user.isEmailVerified) {
      throw new BadRequestException('Пошта вже підтверджена');
    }

    // Генеруємо новий токен (старий може бути протермінований)
    const newToken = uuidv4();
    await this.userRepository.update(user.id, {
      emailVerificationToken: newToken,
    });

    setImmediate(() => {
      this.emailService.sendVerificationEmail(user.email, newToken).catch(() => {});
    });

    return { message: 'Лист верифікації надіслано повторно' };
  }

  // ─── Оновлення токенів ───────────────────────────────────────────────────────

  async refreshTokens(userId: string, refreshToken: string): Promise<AuthResponseDto> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'email', 'fullName', 'systemRole', 'clearanceLevel',
               'refreshTokenHash', 'isBlocked', 'isEmailVerified'],
    });

    if (!user || !user.refreshTokenHash) {
      throw new UnauthorizedException('Доступ заборонено');
    }

    const isRefreshValid = await argon2.verify(user.refreshTokenHash, refreshToken);
    if (!isRefreshValid) {
      throw new UnauthorizedException('Недійсний refresh token');
    }

    return this.generateTokens(user);
  }

  // ─── Вихід ──────────────────────────────────────────────────────────────────

  async logout(userId: string): Promise<void> {
    await this.userRepository.update(userId, { refreshTokenHash: null });
  }

  // ─── Приватні методи ────────────────────────────────────────────────────────

  private async generateTokens(user: User): Promise<AuthResponseDto> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.systemRole,
      clearance: user.clearanceLevel,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_SECRET,
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      }),
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
      }),
    ]);

    await this.userRepository.update(user.id, {
      refreshTokenHash: await argon2.hash(refreshToken),
    });

    return {
      accessToken,
      refreshToken,
      emailVerified: user.isEmailVerified ?? false,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        systemRole: user.systemRole,
        clearanceLevel: user.clearanceLevel,
      },
    };
  }
}
