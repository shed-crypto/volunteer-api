import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SystemRole, ClearanceLevel } from '@common/enums';

export class AdminCreateUserDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'Іван Іванов' })
  @IsString()
  fullName: string;

  @ApiProperty({ enum: SystemRole })
  @IsEnum(SystemRole)
  systemRole: SystemRole;

  @ApiPropertyOptional({ enum: ClearanceLevel, default: ClearanceLevel.LOCAL })
  @IsOptional()
  @IsEnum(ClearanceLevel)
  clearanceLevel?: ClearanceLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}