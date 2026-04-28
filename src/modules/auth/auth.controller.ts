import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Get,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  VerifyEmailDto,
  AuthResponseDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { User } from '@modules/users/entities/user.entity';

@ApiTags('Авторизація')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ─── Реєстрація ──────────────────────────────────────────────────────────────

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 реєстрацій/хв з одного IP
  @ApiOperation({ summary: 'Реєстрація нового користувача' })
  @ApiResponse({ status: 201, type: AuthResponseDto })
  @ApiResponse({ status: 409, description: 'Email вже зайнятий' })
  register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto);
  }

  // ─── Вхід ────────────────────────────────────────────────────────────────────

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 спроб/хв
  @ApiOperation({ summary: 'Вхід в систему' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Невірні облікові дані' })
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  // ─── Оновлення токенів ───────────────────────────────────────────────────────

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Оновити access token через refresh token' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  async refresh(@Body() dto: RefreshTokenDto): Promise<AuthResponseDto> {
    const payload = this.decodeToken(dto.refreshToken);
    return this.authService.refreshTokens(payload.sub, dto.refreshToken);
  }

  // ─── Вихід ──────────────────────────────────────────────────────────────────

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Вихід із системи (інвалідація refresh token)' })
  logout(@CurrentUser() user: User): Promise<void> {
    return this.authService.logout(user.id);
  }

  // ─── Поточний користувач ─────────────────────────────────────────────────────

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Отримати дані поточного авторизованого користувача' })
  getMe(@CurrentUser() user: User): User {
    return user;
  }

  // ─── Підтвердження email ─────────────────────────────────────────────────────

  /**
   * GET /api/auth/verify-email?token=<uuid>
   *
   * Користувач переходить за посиланням із листа.
   * Повертає JSON — фронтенд може показати сторінку успіху.
   */
  @Get('verify-email')
  @ApiOperation({ summary: 'Підтвердити email за токеном із листа' })
  @ApiQuery({ name: 'token', description: 'UUID-токен із листа верифікації' })
  @ApiResponse({ status: 200, description: 'Email успішно підтверджено' })
  @ApiResponse({ status: 400, description: 'Токен недійсний або вже використаний' })
  verifyEmail(@Query('token') token: string): Promise<{ message: string }> {
    return this.authService.verifyEmail(token);
  }

  // ─── Повторне надсилання листа ───────────────────────────────────────────────

  @Post('resend-verification')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 300000 } }) // 3 рази на 5 хвилин
  @ApiOperation({ summary: 'Повторно надіслати лист підтвердження email' })
  @ApiResponse({ status: 200, description: 'Лист надіслано' })
  @ApiResponse({ status: 400, description: 'Пошта вже підтверджена' })
  resendVerification(@CurrentUser() user: User): Promise<{ message: string }> {
    return this.authService.resendVerificationEmail(user.id);
  }

  // ─── Скидання пароля ────────────────────────────────────────────────────────

  @Post('forgot-password')
  @ApiOperation({ summary: 'Запит на скидання пароля' })
  @ApiResponse({ status: 200, description: 'Лист надіслано (якщо email існує)' })
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Встановити новий пароль за токеном' })
  @ApiResponse({ status: 200, description: 'Пароль успішно змінено' })
  @ApiResponse({ status: 400, description: 'Невірний або протермінований токен' })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Змінити поточний пароль' })
  @ApiResponse({ status: 200, description: 'Пароль успішно змінено' })
  changePassword(
    @CurrentUser() user: User,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    return this.authService.changePassword(user.id, dto);
  }

  // ─── Утилітний метод ─────────────────────────────────────────────────────────

  private decodeToken(token: string): any {
    const base64Payload = token.split('.')[1];
    const payload = Buffer.from(base64Payload, 'base64').toString('utf8');
    return JSON.parse(payload);
  }
}
