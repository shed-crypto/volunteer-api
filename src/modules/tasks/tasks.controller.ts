import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, UseGuards,
  ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
} from '@nestjs/swagger';
import { TaskStatus } from '@common/enums';
import { TasksService } from './tasks.service';
import { CreateTaskDto, AssignTaskDto, DelegateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { User } from '@modules/users/entities/user.entity';
import { Task } from './entities/task.entity';
import { TaskAssignment } from './entities/task-assignment.entity';
import { TaskDelegation } from './entities/task-delegation.entity';

@ApiTags('Підзадачі (Tasks / Kanban)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  // ─── Kanban-дошка для заявки ─────────────────────────────────────────────

  @Get('requests/:requestId/tasks')
  @ApiOperation({ summary: 'Kanban-дошка: всі підзадачі заявки' })
  findByRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: User,
  ): Promise<Task[]> {
    return this.tasksService.findByRequest(requestId, user);
  }

  // ─── Декомпозиція (створення підзадачі) ──────────────────────────────────

  @Post('requests/:requestId/tasks')
  @ApiOperation({ summary: 'Декомпозиція: створити підзадачу для заявки' })
  create(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: User,
  ): Promise<Task> {
    return this.tasksService.create(requestId, dto, user);
  }

  // ─── Деталі підзадачі ────────────────────────────────────────────────────

  @Get('tasks/:id')
  @ApiOperation({ summary: 'Деталі підзадачі з призначеннями та делегуваннями' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Task> {
    return this.tasksService.findById(id);
  }

  @Patch('tasks/:id')
  @ApiOperation({ summary: 'Редагувати підзадачу (тільки якщо немає активних волонтерів)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: User,
  ): Promise<Task> {
    return this.tasksService.update(id, dto, user);
  }

  // ─── Взяти задачу в роботу (ключовий Sequence) ───────────────────────────

  @Post('tasks/:id/assign')
  @ApiOperation({
    summary: 'Взяти підзадачу в роботу (з перевіркою допуску та поручителів)',
  })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTaskDto,
    @CurrentUser() user: User,
  ): Promise<TaskAssignment> {
    return this.tasksService.assignVolunteer(id, dto, user);
  }

  // ─── Відмовитися від задачі ───────────────────────────────────────────────

  @Delete('tasks/:id/assign')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Відмовитися від виконання підзадачі' })
  withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.tasksService.withdrawAssignment(id, user);
  }

  // ─── Позначити задачу як виконану (волонтер → PENDING_REVIEW) ─────────────

  @Patch('tasks/:id/complete')
  @ApiOperation({ summary: 'Позначити підзадачу як виконану (→ PENDING_REVIEW)' })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<Task> {
    return this.tasksService.completeTask(id, user);
  }

  @Patch('tasks/:id/status')
  @ApiOperation({ summary: 'Адмін: примусово змінити статус підзадачі' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: TaskStatus },
    @CurrentUser() user: User,
  ): Promise<Task> {
    return this.tasksService.updateTaskStatusAdmin(id, body.status, user);
  }

  @Patch('tasks/:id/return')
  @ApiOperation({ summary: 'Повернути підзадачу в роботу (PENDING_REVIEW → IN_PROGRESS)' })
  returnToProgress(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<Task> {
    return this.tasksService.returnToProgress(id, user);
  }

  // ─── Підтвердити завершення задачі (автор заявки → DONE) ─────────────────

  @Patch('tasks/:id/confirm')
  @ApiOperation({
    summary: 'Підтвердити виконання підзадачі (автор заявки → DONE, підвищує trust score виконавцям)',
  })
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<Task> {
    return this.tasksService.confirmTaskCompletion(id, user);
  }

  @Patch('tasks/:id/cancel')
  @ApiOperation({ summary: 'Скасувати виконання підзадачі (status → CANCELLED)' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<Task> {
    return this.tasksService.cancelTask(id, user);
  }

  @Patch('tasks/:id/renew')
  @ApiOperation({ summary: 'Поновити скасовану підзадачу (status → TODO)' })
  renew(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<Task> {
    return this.tasksService.renewTask(id, user);
  }

  // ─── Відхилити результат (автор → повернення IN_PROGRESS) (FR-09d) ─────────

  @Patch('tasks/:id/reject')
  @ApiOperation({ summary: 'Відхилити виконання (автор → PENDING_REVIEW → IN_PROGRESS)' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: User,
  ): Promise<Task> {
    return this.tasksService.rejectTask(id, user, body.reason);
  }

  // ─── Оновити статус призначення EN_ROUTE / ON_SITE (FR-06e) ─────────────

  @Patch('tasks/:id/assignment-status')
  @ApiOperation({ summary: 'Оновити статус виконавця: assigned → en_route → on_site' })
  updateAssignmentStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: string },
    @CurrentUser() user: User,
  ): Promise<TaskAssignment> {
    return this.tasksService.updateAssignmentStatus(id, body.status, user);
  }

  // ─── Делегувати задачу іншій організації (FR-04) ─────────────────────────

  @Post('tasks/:id/delegate')
  @ApiOperation({ summary: 'Делегувати підзадачу іншій волонтерській організації' })
  delegate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DelegateTaskDto,
    @CurrentUser() user: User,
  ): Promise<TaskDelegation> {
    return this.tasksService.delegateTask(id, dto, user);
  }
}
