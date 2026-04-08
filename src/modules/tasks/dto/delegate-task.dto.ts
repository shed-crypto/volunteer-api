import { IsString, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DelegateTaskDto {
  @ApiProperty({ description: 'UUID організації-отримувача' })
  @IsUUID()
  organizationId: string;

  @ApiPropertyOptional({ description: 'Супровідне повідомлення координатора' })
  @IsOptional()
  @IsString()
  message?: string;
}
