import {
  Controller, Get, Post, Patch, Delete, Param,
  Body, UseGuards, ParseUUIDPipe, Query, BadRequestException,
  HttpCode, HttpStatus, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RemoveExifInterceptor } from '@common/interceptors/remove-exif.interceptor';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UsersService } from './users.service';
import { JwtAuthGuard, RolesGuard, Roles } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { User } from './entities/user.entity';
import { Vehicle } from './entities/vehicle.entity';
import { TrustVouch } from './entities/trust-vouch.entity';
import { SystemRole, ClearanceLevel } from '@common/enums';
import { AdminCreateUserDto } from './dto/create-user.dto';
import { UpdateClearanceDto } from './dto/update-clearance.dto';

@ApiTags('Користувачі')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles(SystemRole.ADMIN, SystemRole.COORDINATOR)
  @ApiOperation({ summary: 'Список всіх користувачів (Admin/Coordinator)' })
  findAll(): Promise<User[]> {
    return this.usersService.findAll();
  }

  @Get('search')
  @ApiOperation({ summary: 'Пошук користувачів для ініціації чату' })
  searchUsers(
    @Query('q') query: string,
  ): Promise<Partial<User>[]> {
    if (!query || query.length < 2) {
      throw new BadRequestException('Мінімум 2 символи для пошуку');
    }
    return this.usersService.searchUsers(query);
  }

  // ─── Адмін-панель: повний список з vouchCount, isBlocked, isEmailVerified ─
  // Виправляє: AdminScreen.tsx викликав /admin/users (не існував).
  // Тепер AdminScreen викликає GET /users/admin-list (тільки ADMIN).
  @Get('admin-list')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.ADMIN)
  @ApiOperation({ summary: 'Повний список для адмін-панелі (з vouchCount, isBlocked)' })
  findAllForAdmin(@CurrentUser() admin: User): Promise<any[]> {
    return this.usersService.findAllForAdmin();
  }

  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const dir = './uploads/avatars';
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (req, file, cb) => {
          const randomName = Array(32).fill(null).map(() => (Math.round(Math.random() * 16)).toString(16)).join('');
          cb(null, `${randomName}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype?.startsWith('image/')) {
          cb(new BadRequestException('Only images can be uploaded'), false);
          return;
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
    RemoveExifInterceptor,
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Upload avatar image' })
  async uploadAvatarEarly(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
  ): Promise<{ url: string }> {
    if (!file) throw new BadRequestException('File was not provided');
    const avatarUrl = `/uploads/avatars/${file.filename}`;
    await this.usersService.updateAvatar(user.id, avatarUrl);
    return { url: avatarUrl };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Профіль користувача' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<User> {
    return this.usersService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Оновити профіль користувача (власний або Admin)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { fullName?: string; phoneNumber?: string; telegramChatId?: string },
    @CurrentUser() currentUser: User,
  ): Promise<User> {
    return this.usersService.updateProfile(id, dto, currentUser);
  }

  // ─── Блокування / Розблокування (FR-02e) ──────────────────────────────────
  // Виправляє: AdminScreen викликав POST /admin/users/:id/block (не існував).
  // Тепер AdminScreen використовує PATCH /users/:id/block та PATCH /users/:id/unblock.

  @Patch(':id/block')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.ADMIN)
  @ApiOperation({ summary: 'Заблокувати користувача (Admin)' })
  block(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: User,
  ): Promise<void> {
    return this.usersService.blockUser(id, admin);
  }

  @Patch(':id/unblock')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.ADMIN)
  @ApiOperation({ summary: 'Розблокувати користувача (Admin)' })
  unblock(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: User,
  ): Promise<void> {
    return this.usersService.unblockUser(id, admin);
  }

  // ─── Зміна системної ролі (Admin → Coordinator / Volunteer) ──────────────
  // Вирішує питання: "хто робить волонтера координатором?"
  // Відповідь: тільки Admin через цей endpoint.
  // AdminScreen має кнопку "Змінити роль" яка кличе PATCH /users/:id/role.

  @Patch(':id/role')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.ADMIN)
  @ApiOperation({
    summary: 'Змінити системну роль користувача (Admin → Coordinator / Volunteer / Requester)',
    description: 'Єдиний спосіб підвищити волонтера до координатора. Координатор отримує права: створювати підзадачі, делегувати, переглядати всіх юзерів.',
  })
  changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { systemRole: SystemRole },
    @CurrentUser() admin: User,
  ): Promise<User> {
    return this.usersService.changeRole(id, body.systemRole, admin);
  }

  @Patch(':id/clearance')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.ADMIN)
  @ApiOperation({
    summary: 'Змінити рівень допуску користувача (Admin)',
    description: 'Дозволяє вручну призначити LOCAL, INTERNATIONAL або FRONTLINE.',
  })
  updateClearance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClearanceDto,
    @CurrentUser() admin: User,
  ): Promise<User> {
    return this.usersService.updateClearance(id, dto.clearanceLevel, admin);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(SystemRole.ADMIN)
  @ApiOperation({ summary: 'Створити нового користувача (Admin)' })
  createUser(
    @Body() dto: AdminCreateUserDto,
    @CurrentUser() admin: User,
  ): Promise<User> {
    return this.usersService.createUser(dto, admin);
  }

  // ─── Система Поручителів ──────────────────────────────────────────────────

  @Post(':id/vouch')
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @ApiOperation({
    summary: 'Поручитися за користувача (тільки FRONTLINE волонтери або Admin)',
  })
  vouch(
    @Param('id', ParseUUIDPipe) voucheeId: string,
    @CurrentUser() voucher: User,
  ): Promise<TrustVouch> {
    return this.usersService.vouchForUser(voucheeId, voucher);
  }

  @Get(':id/vouches')
  @ApiOperation({ summary: 'Список поручителів користувача (vouches received)' })
  getVouches(
    @Param('id', ParseUUIDPipe) userId: string,
  ): Promise<TrustVouch[]> {
    return this.usersService.getVouchesForUser(userId);
  }

  // ─── Відновлення / Відкликання поручительств (Admin) ─────────────────────

  @Post('trust-vouches/:id/restore')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.ADMIN)
  @ApiOperation({ summary: 'Відновити призупинене поручительство (Admin)' })
  async restoreVouch(
    @Param('id') vouchId: string,
    @CurrentUser() admin: User,
  ): Promise<TrustVouch> {
    return this.usersService.restoreVouch(vouchId, admin);
  }

  @Delete('trust-vouches/:id/revoke')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.ADMIN)
  @ApiOperation({ summary: 'Відкликати поручительство назавжди (Admin, hard delete)' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeVouch(
    @Param('id') vouchId: string,
    @CurrentUser() admin: User,
  ): Promise<void> {
    return this.usersService.revokeVouchPermanently(vouchId, admin);
  }

  // ─── Транспорт ────────────────────────────────────────────────────────────

  @Get(':id/vehicles')
  @ApiOperation({ summary: 'Транспорт користувача' })
  getVehicles(
    @Param('id', ParseUUIDPipe) userId: string,
  ): Promise<Vehicle[]> {
    return this.usersService.getUserVehicles(userId);
  }

  // ─── Аватарка ─────────────────────────────────────────────────────────────
  // NOTE: шлях 'avatar' замість 'me/avatar' щоб уникнути конфлікту з :id параметром
  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const dir = './uploads/avatars';
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (req, file, cb) => {
          const randomName = Array(32).fill(null).map(() => (Math.round(Math.random() * 16)).toString(16)).join('');
          cb(null, `${randomName}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype?.startsWith('image/')) {
          cb(new BadRequestException('Можна завантажувати тільки зображення'), false);
          return;
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
    RemoveExifInterceptor,
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Завантажити аватарку (тільки зображення)' })
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
  ): Promise<{ url: string }> {
    if (!file) throw new BadRequestException('Файл не передано');
    const avatarUrl = `/uploads/avatars/${file.filename}`;
    await this.usersService.updateAvatar(user.id, avatarUrl);
    return { url: avatarUrl };
  }

  @Post('me/vehicles')
  @ApiOperation({ summary: 'Додати транспортний засіб до свого профілю' })
  addVehicle(
    @Body() dto: Partial<Vehicle>,
    @CurrentUser() user: User,
  ): Promise<Vehicle> {
    return this.usersService.addVehicle(user.id, dto);
  }
}
