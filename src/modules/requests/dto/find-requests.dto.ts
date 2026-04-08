import { IsOptional, IsEnum, IsString, IsNumber, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { RequestCategory, RequestUrgency, RequestStatus } from '@common/enums';

export class FindRequestsDto {
  @ApiPropertyOptional({ enum: RequestStatus })
  @IsOptional()
  @IsEnum(RequestStatus)
  status?: RequestStatus;

  @ApiPropertyOptional({ enum: RequestCategory })
  @IsOptional()
  @IsEnum(RequestCategory)
  category?: RequestCategory;

  @ApiPropertyOptional({ enum: RequestUrgency })
  @IsOptional()
  @IsEnum(RequestUrgency)
  urgency?: RequestUrgency;

  @ApiPropertyOptional({ description: 'Повнотекстовий пошук' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Широта центру пошуку' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  latitude?: number;

  @ApiPropertyOptional({ description: 'Довгота центру пошуку' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  longitude?: number;

  @ApiPropertyOptional({ description: 'Радіус пошуку в кілометрах' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  radiusKm?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  offset?: number;
}