import { IsOptional, IsEnum } from 'class-validator';
import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { RequestStatus } from '@common/enums';
import { CreateRequestDto } from './create-request.dto';

export class UpdateRequestDto extends PartialType(CreateRequestDto) {
  @ApiPropertyOptional({ enum: RequestStatus })
  @IsOptional()
  @IsEnum(RequestStatus)
  status?: RequestStatus;
}
