import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsEnum,
  Matches,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SystemRole } from '@common/enums';

export class RegisterDto {
  @ApiProperty({ example: 'example@example.com' })
  @IsEmail({}, { message: 'Невірний формат email' })
  email: string;

  @ApiProperty({ example: 'StrongPass123!' })
  @IsString()
  @MinLength(8, { message: 'Пароль повинен містити щонайменше 8 символів' })
  @MaxLength(72, { message: 'Пароль не може перевищувати 72 символи' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Пароль повинен містити великі та малі літери та цифри',
  })
  password: string;

  @ApiProperty({ example: 'Іван Петренко' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  fullName: string;

  @ApiPropertyOptional({ example: '+380501234567' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  /**
   * При реєстрації можна обрати лише VOLUNTEER або REQUESTER.
   * COORDINATOR та ADMIN призначаються адміністратором вручну.
   */
  @ApiPropertyOptional({
    enum: [SystemRole.VOLUNTEER, SystemRole.REQUESTER],
    default: SystemRole.VOLUNTEER,
    description: 'Роль при реєстрації. COORDINATOR/ADMIN призначаються адміністратором.',
  })
  @IsOptional()
  @IsEnum([SystemRole.VOLUNTEER, SystemRole.REQUESTER], {
    message: 'При реєстрації можна обрати лише VOLUNTEER або REQUESTER',
  })
  systemRole?: SystemRole.VOLUNTEER | SystemRole.REQUESTER;
}

export class LoginDto {
  @ApiProperty({ example: 'example@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'StrongPass123!' })
  @IsString()
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'UUID-токен з листа верифікації' })
  @IsString()
  token: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'example@example.com' })
  @IsEmail()
  email: string;
}

export class VerifyResetCodeDto {
  @ApiProperty({ example: 'example@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '482916', description: '6-значний код з листа' })
  @IsString()
  @Length(6, 6, { message: 'Код повинен містити рівно 6 символів' })
  code: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'UUID-токен із листа скидання пароля' })
  @IsString()
  token: string;

  @ApiProperty({ example: 'NewStrongPass123!' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Пароль повинен містити великі та малі літери та цифри',
  })
  newPassword: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldPass123!' })
  @IsString()
  oldPassword: string;

  @ApiProperty({ example: 'NewStrongPass123!' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Пароль повинен містити великі та малі літери та цифри',
  })
  newPassword: string;
}

export class AuthResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  /**
   * Чи підтверджений email.
   * Фронтенд показує банер "підтвердіть пошту" якщо false.
   */
  @ApiProperty({ description: 'Чи підтверджений email користувача' })
  emailVerified: boolean;

  @ApiProperty()
  user: {
    id: string;
    email: string;
    fullName: string;
    systemRole: SystemRole;
    clearanceLevel: string;
    avatarUrl?: string;
  };
}