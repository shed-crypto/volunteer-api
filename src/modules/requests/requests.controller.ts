import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards,
  ParseUUIDPipe, HttpCode, HttpStatus, UseInterceptors, UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { RemoveExifInterceptor } from '@common/interceptors/remove-exif.interceptor';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { RequestsService } from './requests.service';
import { CreateRequestDto, AddInfoRequestDto } from './dto/create-request.dto';
import { UpdateRequestDto } from './dto/update-request.dto';
import { FindRequestsDto } from './dto/find-requests.dto';
import { JwtAuthGuard, RolesGuard, Roles } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { User } from '@modules/users/entities/user.entity';
import { Request } from './entities/request.entity';
import { SystemRole } from '@common/enums';

@ApiTags('Заявки (Requests / Epics)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  @ApiOperation({ summary: 'Створити нову заявку на допомогу' })
  @ApiResponse({ status: 201, type: Request })
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
  }), RemoveExifInterceptor)
  create(
    @Body() dto: CreateRequestDto,
    @UploadedFiles() files: Array<Express.Multer.File>,
    @CurrentUser() user: User,
  ): Promise<Request> {
    const mediaUrls = files?.map(f => ({ url: `/uploads/requests/${f.filename}`, name: f.originalname, type: f.mimetype })) || [];
    return this.requestsService.create({ ...dto, mediaUrls }, user);
  }

  @Get()
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @ApiOperation({ summary: 'Отримати список заявок з пріоритезацією та пагінацією' })
  findAll(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('latitude') latitude?: number,
    @Query('longitude') longitude?: number,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('urgency') urgency?: string,
    @Query('category') category?: string,
    @Query('creatorId') creatorId?: string,
    @Query('radiusKm') radiusKm?: number,
    @Query('excludeCreatorId') excludeCreatorId?: string,
    @CurrentUser() user?: User,
  ): Promise<any[]> {
    // REQUESTER бачить тільки свої заявки
    if (user?.systemRole === SystemRole.REQUESTER) {
      return this.requestsService.getMyRequests(user.id, {
        limit: limit ? parseInt(limit as any) : 20,
        offset: offset ? parseInt(offset as any) : 0,
      });
    }

    // Only use geo-search when all three are provided
    const userLat = latitude != null ? parseFloat(latitude as any) : undefined;
    const userLng = longitude != null ? parseFloat(longitude as any) : undefined;
    const rad = radiusKm != null ? parseFloat(radiusKm as any) : undefined;
    const useGeo = userLat != null && userLng != null && rad != null && rad > 0;

    return this.requestsService.getRequestsWithPriority({
      userId: user?.id,
      userLat: useGeo ? userLat : undefined,
      userLng: useGeo ? userLng : undefined,
      radiusKm: useGeo ? rad : undefined,
      limit: limit ? parseInt(limit as any) : 20,
      offset: offset ? parseInt(offset as any) : 0,
      search,
      status,
      urgency,
      category,
      creatorId,
      excludeCreatorId,
    });
  }

  @Get('saved-ids')
  @ApiOperation({ summary: 'Отримати ID збережених заявок для синхронізації' })
  async getSavedIds(@CurrentUser() user: User): Promise<string[]> {
    return this.requestsService.getSavedRequestIds(user.id);
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
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Деталі заявки з усіма підзадачами' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<Request> {
    return this.requestsService.findOne(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Редагувати заявку (тільки якщо немає активних волонтерів)' })
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
  }), RemoveExifInterceptor)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRequestDto,
    @UploadedFiles() files: Array<Express.Multer.File>,
    @CurrentUser() user: User,
  ): Promise<Request> {
    const mediaUrls = files?.map(f => ({ url: `/uploads/requests/${f.filename}`, name: f.originalname, type: f.mimetype })) || [];
    return this.requestsService.update(id, { ...dto, mediaUrls }, user);
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
  }), RemoveExifInterceptor)
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
  }), RemoveExifInterceptor)
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

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Скасувати заявку з причиною' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: User,
  ): Promise<Request> {
    return this.requestsService.cancel(id, reason, user);
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

  // ─── Admin: Access Logs ──────────────────────────────────────────────────
  @Get('admin/access-logs')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.ADMIN)
  @ApiOperation({ summary: 'Аудит доступу до заявок (Admin)' })
  getAccessLogs(
    @Query('requestId') requestId?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<any[]> {
    return this.requestsService.getAccessLogs({
      requestId,
      userId,
      action,
      from,
      to,
      limit: limit ? parseInt(limit as any) : 50,
      offset: offset ? parseInt(offset as any) : 0,
    });
  }
}
