import {
  Controller, Get, Post, Patch, Param,
  Body, UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard, RolesGuard, Roles } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { User } from './entities/user.entity';
import { Vehicle } from './entities/vehicle.entity';
import { TrustVouch } from './entities/trust-vouch.entity';
import { SystemRole } from '@common/enums';

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

  // ─── Система Поручителів ──────────────────────────────────────────────────

  @Post(':id/vouch')
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

  // ─── Транспорт ────────────────────────────────────────────────────────────

  @Get(':id/vehicles')
  @ApiOperation({ summary: 'Транспорт користувача' })
  getVehicles(
    @Param('id', ParseUUIDPipe) userId: string,
  ): Promise<Vehicle[]> {
    return this.usersService.getUserVehicles(userId);
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
