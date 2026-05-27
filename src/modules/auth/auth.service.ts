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
import {
  RegisterDto,
  LoginDto,
  AuthResponseDto,
  ChangePasswordDto,
} from './dto/auth.dto';
import { JwtPayload } from './strategies/jwt.strategy';

/**
 * Конфігурація argon2id згідно з OWASP рекомендаціями.
 * Argon2id — переможець PHC 2015, гібрид argon2i (side-channel resistance)
 * та argon2d (GPU resistance).
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,   // 19 MB
  timeCost: 2,         // 2 ітерації
  parallelism: 1,      // 1 потік
};

/** Термін дії email verification token — 48 годин */
const EMAIL_VERIFICATION_TTL_HOURS = 48;

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

    // Генеруємо токен підтвердження пошти з терміном дії 48 годин
    const emailVerificationToken = uuidv4();
    const emailVerificationExpires = new Date();
    emailVerificationExpires.setHours(
      emailVerificationExpires.getHours() + EMAIL_VERIFICATION_TTL_HOURS,
    );

    const user = this.userRepository.create({
      email: dto.email.toLowerCase(),
      passwordHash: dto.password, // хешується у @BeforeInsert() хуку
      fullName: dto.fullName,
      phoneNumber: dto.phoneNumber,
      systemRole: dto.systemRole,   // RegisterDto обмежує лише VOLUNTEER/REQUESTER
      isEmailVerified: false,
      emailVerificationToken,
      emailVerificationExpires,
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

    // Перевіряємо термін дії токена
    if (user.emailVerificationExpires && user.emailVerificationExpires < new Date()) {
      throw new BadRequestException(
        'Термін дії токена верифікації минув. Запитайте новий лист.',
      );
    }

    await this.userRepository.update(user.id, {
      isEmailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
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

    // Генеруємо новий токен з новим терміном дії (старий може бути протермінований)
    const newToken = uuidv4();
    const emailVerificationExpires = new Date();
    emailVerificationExpires.setHours(
      emailVerificationExpires.getHours() + EMAIL_VERIFICATION_TTL_HOURS,
    );

    await this.userRepository.update(user.id, {
      emailVerificationToken: newToken,
      emailVerificationExpires,
    });

    setImmediate(() => {
      this.emailService.sendVerificationEmail(user.email, newToken).catch(() => {});
    });

    return { message: 'Лист верифікації надіслано повторно' };
  }

  // ─── Скидання пароля (6-значний код) ────────────────────────────────────────

  async requestPasswordReset(email: string): Promise<{ message: string; exists: boolean }> {
    const user = await this.userRepository.findOne({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      return { message: 'Користувача з таким email не знайдено', exists: false };
    }

    // Генеруємо 6-значний код
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const resetExpires = new Date();
    resetExpires.setMinutes(resetExpires.getMinutes() + 10); // Код діє 10 хвилин

    await this.userRepository.update(user.id, {
      passwordResetCode: code,
      passwordResetExpires: resetExpires,
    });

    setImmediate(() => {
      this.emailService.sendPasswordResetCode(user.email, code).catch(() => {});
    });

    return { message: 'Код для скидання пароля надіслано на ваш email', exists: true };
  }

  async verifyResetCode(email: string, code: string): Promise<{ token: string; message: string }> {
    const user = await this.userRepository.findOne({
      where: { email: email.toLowerCase() },
    });

    if (!user || !user.passwordResetCode || !user.passwordResetExpires) {
      throw new BadRequestException('Скидання пароля не запитувалось');
    }

    if (user.passwordResetExpires < new Date()) {
      throw new BadRequestException('Код протермінований. Запитайте новий код.');
    }

    if (user.passwordResetCode !== code) {
      throw new BadRequestException('Невірний код підтвердження');
    }

    // Код вірний — генеруємо одноразовий токен для скидання пароля
    const resetToken = uuidv4();
    const tokenExpires = new Date();
    tokenExpires.setMinutes(tokenExpires.getMinutes() + 5); // Токен діє 5 хвилин

    await this.userRepository.update(user.id, {
      passwordResetToken: resetToken,
      passwordResetExpires: tokenExpires,
      passwordResetCode: null, // Видаляємо код, він більше не потрібен
    });

    return {
      token: resetToken,
      message: 'Код підтверджено. Тепер ви можете встановити новий пароль.',
    };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { passwordResetToken: token },
    });

    if (!user || !user.passwordResetExpires || user.passwordResetExpires < new Date()) {
      throw new BadRequestException('Токен недійсний або протермінований');
    }

    const hashedPassword = await argon2.hash(newPassword, ARGON2_OPTIONS);

    await this.userRepository.update(user.id, {
      passwordHash: hashedPassword,
      passwordResetToken: null,
      passwordResetExpires: null,
    });

    return { message: 'Пароль успішно змінено' };
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

    const isRefreshValid = await argon2.verify(
      user.refreshTokenHash,
      refreshToken,
    );

    if (!isRefreshValid) {
      // 🚨 TOKEN FAMILY DETECTION:
      // Якщо хтось намагається використати старий (вже замінений) refresh token,
      // це означає що токен скомпрометований. Інвалідуємо всі сесії користувача.
      await this.userRepository.update(user.id, { refreshTokenHash: null });
      throw new UnauthorizedException(
        'Недійсний refresh token. Всі активні сесії було завершено з міркувань безпеки.',
      );
    }

    return this.generateTokens(user);
  }

  // ─── Вихід ──────────────────────────────────────────────────────────────────

  async logout(userId: string): Promise<void> {
    await this.userRepository.update(userId, { refreshTokenHash: null });
  }

  // ─── Зміна пароля ──────────────────────────────────────────────────────────

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'passwordHash'],
    });

    if (!user) throw new NotFoundException('Користувача не знайдено');

    const isOldPasswordValid = await user.verifyPassword(dto.oldPassword);
    if (!isOldPasswordValid) {
      throw new UnauthorizedException('Невірний старий пароль');
    }

    const hashedPassword = await argon2.hash(dto.newPassword, ARGON2_OPTIONS);
    await this.userRepository.update(user.id, {
      passwordHash: hashedPassword,
    });

    return { message: 'Пароль успішно змінено' };
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
        expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as any,
      }),
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '30d') as any,
      }),
    ]);

    await this.userRepository.update(user.id, {
      refreshTokenHash: await argon2.hash(refreshToken, ARGON2_OPTIONS),
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
        avatarUrl: user.avatarUrl,
      },
    };
  }
}