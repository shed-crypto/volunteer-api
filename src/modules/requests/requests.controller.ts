import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards,
  ParseUUIDPipe, HttpCode, HttpStatus, UseInterceptors, UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { RequestsService } from './requests.service';
import { CreateRequestDto, AddInfoRequestDto } from './dto/create-request.dto';
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

  @Get('saved')
  @ApiOperation({ summary: 'Отримати список збережених заявок' })
  getSavedRequests(
    @Query('limit') limit: number,
    @Query('offset') offset: number,
    @CurrentUser() user: User,
  ): Promise<Request[]> {
    return this.requestsService.getSavedRequests(user.id, limit, offset);
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
  @ApiOperation({ summary: 'Редагувати заявку (тільки якщо немає активних волонтерів)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRequestDto,
    @CurrentUser() user: User,
  ): Promise<Request> {
    return this.requestsService.update(id, dto, user);
  }

  @Patch(':id/add-info')
  @ApiOperation({ summary: 'Додати доповнення до заявки (тільки власник)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('attachments', 10, {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const dir = 'uploads/requests';
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${unique}${extname(file.originalname)}`);
      },
    }),
  }))
  addInfo(
    @Param('id') id: string,
    @Body() dto: AddInfoRequestDto,
    @UploadedFiles() files: Array<Express.Multer.File>,
    @CurrentUser() user: User,
  ) {
    const attachments = files?.map(f => ({ url: `/uploads/requests/${f.filename}`, name: f.originalname, type: f.mimetype })) || [];
    return this.requestsService.addInfo(id, { ...dto, attachments }, user);
  }

  @Patch(':id/additional-info/:infoId')
  @ApiOperation({ summary: 'Редагувати доповнення (протягом 30 хв)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('attachments', 10, {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const dir = 'uploads/requests';
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${unique}${extname(file.originalname)}`);
      },
    }),
  }))
  updateAdditionalInfo(
    @Param('id') id: string,
    @Param('infoId') infoId: string,
    @Body() dto: AddInfoRequestDto,
    @UploadedFiles() files: Array<Express.Multer.File>,
    @CurrentUser() user: User,
  ) {
    const attachments = files?.map(f => ({ url: `/uploads/requests/${f.filename}`, name: f.originalname, type: f.mimetype })) || [];
    return this.requestsService.updateAdditionalInfo(id, infoId, { ...dto, attachments }, user);
  }

  @Delete(':id/additional-info/:infoId')
  @ApiOperation({ summary: 'Видалити доповнення (протягом 30 хв)' })
  removeAdditionalInfo(
    @Param('id') id: string,
    @Param('infoId') infoId: string,
    @CurrentUser() user: User,
  ) {
    return this.requestsService.removeAdditionalInfo(id, infoId, user);
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

  @Post(':id/save')
  @ApiOperation({ summary: 'Зберегти заявку' })
  saveRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.requestsService.saveRequest(id, user.id);
  }

  @Delete(':id/save')
  @ApiOperation({ summary: 'Видалити заявку зі збережених' })
  unsaveRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.requestsService.unsaveRequest(id, user.id);
  }

  @Post(':id/pending-review')
  @ApiOperation({ summary: 'Відправити заявку на перевірку виконання' })
  markAsPendingReview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<Request> {
    return this.requestsService.markAsPendingReview(id, user);
  }

  @Post(':id/confirm-completion')
  @ApiOperation({ summary: 'Підтвердити завершення заявки' })
  confirmCompletion(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<Request> {
    return this.requestsService.confirmCompletion(id, user);
  }

  @Post(':id/return-to-progress')
  @ApiOperation({ summary: 'Повернути заявку в роботу (скасувати перевірку)' })
  returnToProgress(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<Request> {
    return this.requestsService.returnToProgress(id, user);
  }
}
