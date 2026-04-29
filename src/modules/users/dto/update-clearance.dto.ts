import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ClearanceLevel } from '@common/enums';

export class UpdateClearanceDto {
  @ApiProperty({ enum: ClearanceLevel, description: 'Новий рівень допуску' })
  @IsEnum(ClearanceLevel)
  clearanceLevel: ClearanceLevel;
}