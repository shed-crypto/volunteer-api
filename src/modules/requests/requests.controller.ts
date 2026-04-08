import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards,
  ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiResponse,
} from '@nestjs/swagger';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { UpdateRequestDto } from './dto/update-request.dto';
import { FindRequestsDto } from './dto/find-requests.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { User } from '@modules/users/entities/user.entity';
import { Request } from './entities/request.entity';

@ApiTags('Заявки (Requests / Epics)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  @ApiOperation({ summary: 'Створити нову заявку на допомогу' })
  @ApiResponse({ status: 201, type: Request })
  create(
    @Body() dto: CreateRequestDto,
    @CurrentUser() user: User,
  ): Promise<Request> {
    return this.requestsService.create(dto, user);
  }

  @Get()
  @ApiOperation({
    summary: 'Список заявок (з фільтрами, пошуком та георадіусом)',
  })
  findAll(
    @Query() dto: FindRequestsDto,
    @CurrentUser() user: User,
  ): Promise<Request[]> {
    return this.requestsService.findAll(dto, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Деталі заявки з усіма підзадачами' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<Request> {
    return this.requestsService.findOne(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Оновити заявку (статус, опис, терміновість)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRequestDto,
    @CurrentUser() user: User,
  ): Promise<Request> {
    return this.requestsService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Видалити заявку (soft delete)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.requestsService.remove(id, user);
  }
}
