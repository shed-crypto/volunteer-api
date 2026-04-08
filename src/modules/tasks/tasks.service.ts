import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Task } from './entities/task.entity';
import { TaskAssignment } from './entities/task-assignment.entity';
import { TaskDelegation } from './entities/task-delegation.entity';
import { TrustVouch } from '@modules/users/entities/trust-vouch.entity';
import { Chat } from '@modules/chat/entities/chat.entity';
import { Request } from '@modules/requests/entities/request.entity';
import { User } from '@modules/users/entities/user.entity';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { ChatGateway } from '@modules/chat/chat.gateway';
import {
  TaskStatus, AssignmentStatus, RequestStatus,
  ClearanceLevel, SystemRole, ChatType,
} from '@common/enums';
import { CreateTaskDto } from './dto/create-task.dto';
import { AssignTaskDto } from './dto/assign-task.dto';
import { DelegateTaskDto } from './dto/delegate-task.dto';

const FRONTLINE_VOUCHES_REQUIRED = parseInt(
  process.env.FRONTLINE_VOUCHES_REQUIRED || '3',
  10,
);

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(TaskAssignment)
    private readonly assignmentRepository: Repository<TaskAssignment>,
    @InjectRepository(TaskDelegation)
    private readonly delegationRepository: Repository<TaskDelegation>,
    @InjectRepository(TrustVouch)
    private readonly vouchRepository: Repository<TrustVouch>,
    @InjectRepository(Request)
    private readonly requestRepository: Repository<Request>,
    @InjectRepository(Chat)
    private readonly chatRepository: Repository<Chat>,
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly chatGateway?: ChatGateway,
  ) {}

  // ─── Kanban: Отримати всі задачі по заявці ───────────────────────────────

  async findByRequest(requestId: string, user: User): Promise<Task[]> {
    return this.taskRepository.find({
      where: { requestId },
      relations: ['assignments', 'assignments.user'],
      order: { priority: 'DESC', createdAt: 'ASC' },
    });
  }

  async findById(id: string): Promise<Task> {
    const task = await this.taskRepository.findOne({
      where: { id },
      relations: ['assignments', 'assignments.user', 'delegations', 'request'],
    });
    if (!task) throw new NotFoundException('Підзадачу не знайдено');
    return task;
  }

  // ─── Створити підзадачу (декомпозиція) ───────────────────────────────────

  async create(requestId: string, dto: CreateTaskDto, creator: User): Promise<Task> {
    const request = await this.requestRepository.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Заявку не знайдено');

    if (
      request.creatorId !== creator.id &&
      creator.systemRole !== SystemRole.ADMIN &&
      creator.systemRole !== SystemRole.COORDINATOR
    ) {
      throw new ForbiddenException('Лише координатор може декомпозувати заявку на підзадачі');
    }

    const task = this.taskRepository.create({ ...dto, requestId });
    return this.taskRepository.save(task);
  }

  // ─── Взяти задачу в роботу ───────────────────────────────────────────────
  //
  // БАГ-ФІКс: TypeORM з lock: { mode: 'pessimistic_write' } разом із
  // relations: ['request'] генерує LEFT JOIN + FOR UPDATE, що PostgreSQL
  // забороняє для nullable-сторони join-у.
  //
  // РІШЕННЯ: завантажуємо task ОКРЕМО (з блокуванням, без relations),
  // потім request ОКРЕМО (без блокування). Блокування task-рядка достатньо
  // для захисту від race condition при одночасному assign.

  async assignVolunteer(
    taskId: string,
    dto: AssignTaskDto,
    volunteer: User,
  ): Promise<TaskAssignment> {
    return this.dataSource.transaction(async (manager) => {

      // ─── Крок 1: Завантажити task з pessimistic lock (без relation-join-ів) ──
      const task = await manager.findOne(Task, {
        where: { id: taskId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!task) throw new NotFoundException('Підзадачу не знайдено');

      // ─── Крок 1b: Завантажити assignments та request окремо ──────────────
      const [assignments, request] = await Promise.all([
        manager.find(TaskAssignment, { where: { taskId } }),
        manager.findOne(Request, { where: { id: task.requestId } }),
      ]);
      if (!request) throw new NotFoundException('Батьківську заявку не знайдено');

      // Прикріпляємо завантажені дані до task (для приватних методів нижче)
      task.assignments = assignments;
      task.request     = request;

      // ─── Крок 2: Перевірка рівня допуску ─────────────────────────────────
      this.checkClearanceAccess(request.requiredClearance, volunteer);

      // ─── Крок 3: Перевірка поручителів для Frontline (FR-02) ─────────────
      if (request.requiredClearance === ClearanceLevel.FRONTLINE) {
        const vouchCount = await manager.count(TrustVouch, {
          where: { voucheeId: volunteer.id },
        });
        if (vouchCount < FRONTLINE_VOUCHES_REQUIRED) {
          throw new ForbiddenException(
            `Для цього завдання потрібно ${FRONTLINE_VOUCHES_REQUIRED} поручителі. ` +
            `У вас: ${vouchCount}. Зверніться до верифікованих учасників.`,
          );
        }
      }

      // ─── Крок 4: Перевірка слотів (FR-06) ────────────────────────────────
      const activeAssignments = assignments.filter(
        (a) => a.status !== AssignmentStatus.WITHDRAWN,
      );
      if (activeAssignments.length >= task.neededPeopleCount) {
        throw new BadRequestException(
          `Усі слоти (${task.neededPeopleCount}) вже заповнені`,
        );
      }

      // ─── Перевірка дублювання ─────────────────────────────────────────────
      const existing = await manager.findOne(TaskAssignment, {
        where: { taskId, userId: volunteer.id },
      });
      if (existing && existing.status !== AssignmentStatus.WITHDRAWN) {
        throw new ConflictException('Ви вже призначені на цю підзадачу');
      }

      // ─── Крок 5: Створити призначення ─────────────────────────────────────
      const assignment = manager.create(TaskAssignment, {
        taskId,
        userId: volunteer.id,
        fulfilledRole: dto.fulfilledRole,
        status: AssignmentStatus.ASSIGNED,
      });
      await manager.save(assignment);

      const newActiveCount = activeAssignments.length + 1;
      const isNowFull = newActiveCount >= task.neededPeopleCount;

      // ─── Кроки 6–7: Змінити статус та створити чат ────────────────────────
      if (isNowFull && task.status === TaskStatus.TODO) {
        task.status = TaskStatus.IN_PROGRESS;
        const chat = await this.createTaskChat(manager, task, request, volunteer);
        task.chatId = chat.id;
        await manager.save(task);

        // FR-10d: сповістити всіх учасників через WS щоб підписались
        // на нову кімнату без реконнекту (new_chat_joined event)
        setImmediate(() => {
          const participantIds = [
            request.creatorId,
            ...assignments
              .filter((a) => a.status !== AssignmentStatus.WITHDRAWN)
              .map((a) => a.userId),
            volunteer.id,
          ];
          for (const uid of new Set(participantIds)) {
            this.chatGateway?.addParticipantToRoom(uid, chat.id, `Задача: ${task.title}`);
          }
        });
      }

      // ─── Крок 8: Оновити батьківську заявку ──────────────────────────────
      if (request.status === RequestStatus.OPEN) {
        await manager.update(Request, request.id, {
          status: RequestStatus.IN_PROGRESS,
        });
      }

      // ─── Async notifications (не блокуємо транзакцію) ────────────────────
      setImmediate(() => {
        this.notificationsService
          .notifyVolunteerAssigned(volunteer.id, task.title, request.title)
          .catch(() => {});
        this.notificationsService
          .notifyRequesterTeamFound(request.creatorId, task.title, volunteer.fullName)
          .catch(() => {});
      });

      return assignment;
    });
  }

  // ─── Відмовитися від задачі ───────────────────────────────────────────────

  async withdrawAssignment(taskId: string, volunteer: User): Promise<void> {
    const assignment = await this.assignmentRepository.findOne({
      where: { taskId, userId: volunteer.id },
    });

    if (!assignment) throw new NotFoundException('Призначення не знайдено');

    if (assignment.status === AssignmentStatus.COMPLETED) {
      throw new BadRequestException('Не можна відмовитися від завершеного призначення');
    }

    await this.assignmentRepository.update(assignment.id, {
      status: AssignmentStatus.WITHDRAWN,
    });

    const remaining = await this.assignmentRepository.count({
      where: { taskId, status: AssignmentStatus.ASSIGNED },
    });
    if (remaining === 0) {
      await this.taskRepository.update(taskId, {
        status: TaskStatus.TODO,
        chatId: null,
      });
    }
  }

  // ─── Завершити задачу ─────────────────────────────────────────────────────

  async completeTask(taskId: string, user: User): Promise<Task> {
    const task = await this.taskRepository.findOne({
      where: { id: taskId },
      relations: ['request', 'assignments'],
    });
    if (!task) throw new NotFoundException('Підзадачу не знайдено');

    const isAssignee = task.assignments.some(
      (a) => a.userId === user.id && a.status === AssignmentStatus.ASSIGNED,
    );
    if (!isAssignee && user.systemRole !== SystemRole.ADMIN &&
        user.systemRole !== SystemRole.COORDINATOR) {
      throw new ForbiddenException('Лише виконавець може завершити цю задачу');
    }

    task.status = TaskStatus.PENDING_REVIEW;
    return this.taskRepository.save(task);
  }

  // ─── Підтвердити завершення задачі (автор заявки) ────────────────────────

  async confirmTaskCompletion(taskId: string, requester: User): Promise<Task> {
    const task = await this.taskRepository.findOne({
      where: { id: taskId },
      relations: ['request', 'assignments'],
    });
    if (!task) throw new NotFoundException('Підзадачу не знайдено');
    if (task.request.creatorId !== requester.id &&
        requester.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Лише автор заявки може підтвердити виконання');
    }
    if (task.status !== TaskStatus.PENDING_REVIEW) {
      throw new BadRequestException('Задача не очікує підтвердження');
    }

    task.status = TaskStatus.DONE;

    await this.assignmentRepository.update(
      { taskId, status: AssignmentStatus.ASSIGNED },
      { status: AssignmentStatus.COMPLETED, completedAt: new Date() },
    );

    await this.boostVolunteerScores(task.assignments.map((a) => a.userId));
    await this.checkRequestCompletion(task.requestId);

    return this.taskRepository.save(task);
  }

  // ─── Відхилити виконання (FR-09d): PENDING_REVIEW → IN_PROGRESS ─────────

  async rejectTask(taskId: string, requester: User, reason?: string): Promise<Task> {
    const task = await this.taskRepository.findOne({
      where: { id: taskId },
      relations: ['request', 'assignments'],
    });
    if (!task) throw new NotFoundException('Підзадачу не знайдено');
    if (task.request.creatorId !== requester.id && requester.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Лише автор заявки може відхилити виконання');
    }
    if (task.status !== TaskStatus.PENDING_REVIEW) {
      throw new BadRequestException('Задача не очікує підтвердження');
    }

    task.status = TaskStatus.IN_PROGRESS;

    await this.assignmentRepository.update(
      { taskId, status: AssignmentStatus.COMPLETED },
      { status: AssignmentStatus.ASSIGNED, completedAt: undefined as any },
    );

    return this.taskRepository.save(task);
  }

  // ─── Оновити статус призначення EN_ROUTE / ON_SITE (FR-06e) ──────────────

  async updateAssignmentStatus(
    taskId: string,
    newStatus: string,
    volunteer: User,
  ): Promise<TaskAssignment> {
    const allowed = [AssignmentStatus.EN_ROUTE, AssignmentStatus.ON_SITE, AssignmentStatus.ASSIGNED];
    if (!allowed.includes(newStatus as AssignmentStatus)) {
      throw new BadRequestException(`Дозволені статуси: ${allowed.join(', ')}`);
    }

    const assignment = await this.assignmentRepository.findOne({
      where: { taskId, userId: volunteer.id },
    });
    if (!assignment) throw new NotFoundException('Призначення не знайдено');
    if (assignment.status === AssignmentStatus.WITHDRAWN || assignment.status === AssignmentStatus.COMPLETED) {
      throw new BadRequestException('Неможливо змінити статус завершеного або скасованого призначення');
    }

    assignment.status = newStatus as AssignmentStatus;
    return this.assignmentRepository.save(assignment);
  }

  // ─── Делегувати підзадачу іншій організації (FR-04) ──────────────────────

  async delegateTask(
    taskId: string,
    dto: DelegateTaskDto,
    coordinator: User,
  ): Promise<TaskDelegation> {
    const task = await this.taskRepository.findOne({
      where: { id: taskId },
      relations: ['request'],
    });
    if (!task) throw new NotFoundException('Підзадачу не знайдено');

    if (coordinator.systemRole !== SystemRole.COORDINATOR &&
        coordinator.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Лише координатор може делегувати задачі');
    }

    const delegation = await this.delegationRepository.save(
      this.delegationRepository.create({
        taskId,
        organizationId: dto.organizationId,
        delegatedByUserId: coordinator.id,
        message: dto.message,
      }),
    );

    setImmediate(() => {
      this.notificationsService
        .notifyDelegation(dto.organizationId, task.title, 'Невідома організація')
        .catch(() => {});
    });

    return delegation;
  }

  // ─── Приватні методи ──────────────────────────────────────────────────────

  private checkClearanceAccess(required: ClearanceLevel, user: User): void {
    const ranks: Record<ClearanceLevel, number> = {
      [ClearanceLevel.LOCAL]: 0,
      [ClearanceLevel.INTERNATIONAL]: 1,
      [ClearanceLevel.FRONTLINE]: 2,
    };
    if ((ranks[user.clearanceLevel] ?? 0) < (ranks[required] ?? 0)) {
      throw new ForbiddenException(
        `Для цього завдання потрібен рівень допуску: ${required}`,
      );
    }
  }

  private async createTaskChat(
    manager: any,
    task: Task,
    request: Request,
    newVolunteer: User,
  ): Promise<Chat> {
    const participantIds = new Set<string>([request.creatorId]);
    task.assignments
      .filter((a) => a.status !== AssignmentStatus.WITHDRAWN)
      .forEach((a) => participantIds.add(a.userId));
    participantIds.add(newVolunteer.id);

    const participants = Array.from(participantIds).map((id) => ({ id } as User));

    const chat = manager.create(Chat, {
      type: ChatType.TASK_CHAT,
      relatedRequestId: request.id,
      name: `Задача: ${task.title}`,
      participants,
    });

    return manager.save(chat);
  }

  private async boostVolunteerScores(userIds: string[]): Promise<void> {
    if (!userIds.length) return;
    await this.dataSource
      .createQueryBuilder()
      .update('users')
      .set({
        trust_score: () => 'LEAST(trust_score + 5, 100)',
      } as any)
      .where('id IN (:...ids)', { ids: userIds })
      .execute();
  }

  private async checkRequestCompletion(requestId: string): Promise<void> {
    const [total, done] = await Promise.all([
      this.taskRepository.count({ where: { requestId } }),
      this.taskRepository.count({ where: { requestId, status: TaskStatus.DONE } }),
    ]);

    if (total > 0 && total === done) {
      await this.requestRepository.update(requestId, {
        status: RequestStatus.COMPLETED,
      });
    }
  }
}
