import {
  IsString, IsOptional, IsInt, IsArray,
  Min, Max, MaxLength, MinLength, IsDateString, IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateTaskDto {
  @ApiProperty({ example: 'Знайти вантажний автомобіль' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 3,
    description: 'Скільки волонтерів потрібно (FR-06)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  neededPeopleCount?: number;

  @ApiPropertyOptional({
    example: ['Водій', 'Вантажний автомобіль'],
    description: 'Специфічні вимоги до виконавця (FR-07)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredRoles?: string[];

  @ApiPropertyOptional({ default: 0, description: 'Пріоритет (вищий = першочерговий)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  @Type(() => Number)
  priority?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deadline?: string;
}

export class AssignTaskDto {
  @ApiPropertyOptional({
    example: 'Водій',
    description: 'Роль, яку виконуватиме волонтер у цьому завданні (FR-07)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fulfilledRole?: string;
}

export class DelegateTaskDto {
  @ApiProperty({ description: 'UUID організації-отримувача' })
  @IsUUID()
  organizationId: string;

  @ApiPropertyOptional({ description: 'Супровідне повідомлення координатора' })
  @IsOptional()
  @IsString()
  message?: string;
}
