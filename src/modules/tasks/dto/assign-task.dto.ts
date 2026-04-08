import { IsString, IsOptional, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
