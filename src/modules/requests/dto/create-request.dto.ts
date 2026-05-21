import {
  IsString, IsOptional, IsEnum, IsBoolean,
  IsNumber, IsUrl, Min, Max, IsDateString,
  MinLength, MaxLength, IsUUID, IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  RequestCategory, RequestUrgency,
  ClearanceLevel,
} from '@common/enums';

export class CreateRequestDto {
  @ApiProperty({ example: 'Потрібна евакуація родини з Херсонської області' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: RequestCategory })
  @IsOptional()
  @IsEnum(RequestCategory)
  category?: RequestCategory;

  @ApiPropertyOptional({ enum: RequestUrgency })
  @IsOptional()
  @IsEnum(RequestUrgency)
  urgency?: RequestUrgency;

  @ApiPropertyOptional({ enum: ClearanceLevel })
  @IsOptional()
  @IsEnum(ClearanceLevel)
  requiredClearance?: ClearanceLevel;

  @ApiPropertyOptional({ example: 'Хрещатик, 1, Київ, Україна' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ example: 48.4647 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  latitude?: number;

  @ApiPropertyOptional({ example: 35.0462 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  longitude?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isLocationHidden?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fundraisingUrl?: string;

  @ApiPropertyOptional({ description: 'Організація, яка координує заявку' })
  @IsOptional()
  @IsUUID()
  managingOrganizationId?: string;

  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } })
  @IsOptional()
  mediaUrls?: Array<{ url: string; name: string; type: string }>;

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'string' },
    description: 'Теги заявки для категоризації',
    example: ['medical', 'evacuation'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class AddInfoRequestDto {
  @ApiProperty({ example: 'Додаткова інформація: машина зламалась, потрібна допомога з буксируванням.' })
  @IsString()
  @MinLength(3)
  text: string;

  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } })
  @IsOptional()
  attachments?: any[];

  @ApiPropertyOptional({ description: 'URL файлів, які потрібно видалити з існуючих вкладень' })
  @IsOptional()
  removedAttachments?: string[];
}
