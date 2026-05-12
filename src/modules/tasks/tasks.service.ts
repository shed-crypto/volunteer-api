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
import { UpdateTaskDto } from './dto/update-task.dto';
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

  async findByRequest(requestId: string, user: User): Promise<Task[]> {
    const tasks = await this.taskRepository.find({
      where: { requestId },
      relations: ['assignments', 'assignments.user'],
      order: { priority: 'DESC', createdAt: 'ASC' },
    });
    // Ensure assignedCount is a real property (serializable) not just a getter
    tasks.forEach((t: any) => {
      try {
        const asgns = t.assignments || [];
        t.assignedCount = asgns.filter(
          (a: any) => a && a.status !== 'withdrawn' && a.status !== 'completed',
        ).length;
      } catch {
        t.assignedCount = 0;
      }
    });
    return tasks;
  }

  async findById(id: string): Promise<Task> {
    const task = await this.taskRepository.findOne({
      where: { id },
      relations: ['assignments', 'assignments.user', 'delegations', 'request'],
    });
    if (!task) throw new NotFoundException('Підзадачу не знайдено');
    return task;
  }

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

  async update(id: string, dto: UpdateTaskDto, user: User): Promise<Task> {
    const task = await this.taskRepository.findOne({
      where: { id },
      relations: ['assignments', 'request'],
    });
    if (!task) throw new NotFoundException('Підзадачу не знайдено');

    const isOwner = task.request.creatorId === user.id;
    const isAdmin = user.systemRole === SystemRole.ADMIN;
    const isCoordinator = user.systemRole === SystemRole.COORDINATOR;

    if (!isOwner && !isAdmin && !isCoordinator) {
      throw new ForbiddenException('Немає прав для редагування цієї підзадачі');
    }

    // FR-09: не можна редагувати якщо вже є активні призначення
    const hasActiveAssignments = task.assignments?.some(
      (a) => a.status !== AssignmentStatus.WITHDRAWN,
    );

    if (hasActiveAssignments && !isAdmin) {
      throw new ForbiddenException(
        'Не можна редагувати підзадачу, яку вже взяли в роботу волонтери.',
      );
    }

    Object.assign(task, dto);
    return this.taskRepository.save(task);
  }

  // ─── Взяти задачу в роботу ────────────────────────────────────────────────
  //
  // БАГ-ФІКс 1: UPSERT — якщо є withdrawn запис, UPDATE замість INSERT,
  //   щоб не порушувати UNIQUE constraint (taskId, userId).
  //
  // БАГ-ФІКс 2: Використовуємо `new TaskAssignment()` + прямий property assignment
  //   замість `manager.create(TaskAssignment, {...})` — це гарантує правильний
  //   маппінг camelCase→snake_case колонок у контексті transaction manager.
  //
  // БАГ-ФІКс 3: neededPeopleCount — м'який ліміт, не жорстка блокування.
  //   Якщо слоти заповнені але задача ще не DONE/CANCELLED — доєднатись можна.
  //   Задача стає IN_PROGRESS при першому досягненні neededPeopleCount.

  async assignVolunteer(
    taskId: string,
    dto: AssignTaskDto,
    volunteer: User,
  ): Promise<TaskAssignment> {
    return this.dataSource.transaction(async (manager) => {

      // Крок 1: task з pessimistic lock
      const task = await manager.findOne(Task, {
        where: { id: taskId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!task) throw new NotFoundException('Підзадачу не знайдено');

      const [assignments, request] = await Promise.all([
        manager.find(TaskAssignment, { where: { taskId } }),
        manager.findOne(Request, { where: { id: task.requestId } }),
      ]);
      if (!request) throw new NotFoundException('Батьківську заявку не знайдено');

      console.log(`Found ${assignments.length} existing assignments for taskId: ${taskId}`);
      assignments.forEach((assignment, index) => {
        console.log(`  Assignment ${index}: id=${assignment.id}, taskId=${assignment.taskId}, userId=${assignment.userId}, status=${assignment.status}`);
        if (!assignment.taskId) {
          console.error(`ERROR: Assignment ${index} has null/undefined taskId!`);
        }
      });

      task.request     = request;

      // Крок 1.5: заборона REQUESTER брати задачі
      if (volunteer.systemRole === SystemRole.REQUESTER) {
        throw new ForbiddenException(
          'Заявники (Requester) не можуть брати задачі в роботу. ' +
          'Будь ласка, зверніться до адміністратора для підвищення ролі до Волонтера.',
        );
      }

      // Крок 2: перевірка допуску
      this.checkClearanceAccess(request.requiredClearance, volunteer);

      // Крок 3: Frontline — перевірка поручителів
      if (request.requiredClearance === ClearanceLevel.FRONTLINE) {
        // Якщо користувач вже має рівень FRONTLINE (призначений адміном або вже підтверджений),
        // пропускаємо перевірку поручителів.
        if (volunteer.clearanceLevel !== ClearanceLevel.FRONTLINE) {
          const vouchCount = await manager.count(TrustVouch, {
            where: { voucheeId: volunteer.id },
          });
          if (vouchCount < FRONTLINE_VOUCHES_REQUIRED) {
            throw new ForbiddenException(
              `Для цього завдання потрібно ${FRONTLINE_VOUCHES_REQUIRED} поручителі. ` +
              `У вас: ${vouchCount}.`,
            );
          }
        }
      }

      const activeAssignments = assignments.filter(
        (a) => a.status !== AssignmentStatus.WITHDRAWN,
      );

      // Крок 4: БАГ-ФІКс — м'який ліміт.
      // Якщо задача вже DONE або CANCELLED — не можна взяти.
      // Якщо слоти переповнені але задача IN_PROGRESS — дозволяємо (волонтер може помогти).
      if (task.status === TaskStatus.DONE || task.status === TaskStatus.CANCELLED) {
        throw new BadRequestException('Задачу вже завершено або скасовано');
      }

      // Крок 5: UPSERT (перевіряємо existing record)
      const existing = await manager.findOne(TaskAssignment, {
        where: { taskId, userId: volunteer.id },
      });

      let assignment: TaskAssignment;

      if (existing) {
        if (existing.status !== AssignmentStatus.WITHDRAWN) {
          throw new ConflictException('Ви вже призначені на цю підзадачу');
        }
        // БАГ-ФІКс: UPDATE withdrawn → ASSIGNED (не CREATE новий рядок)
        existing.status       = AssignmentStatus.ASSIGNED;
        existing.fulfilledRole = dto.fulfilledRole ?? existing.fulfilledRole;
        existing.assignedAt   = new Date();
        (existing as any).completedAt = null;
        assignment = await manager.save(TaskAssignment, existing);
      } else {
        // БАГ-ФІКс: `new Entity()` + прямий assignment замість manager.create({})
        // щоб TypeORM коректно маппив taskId → task_id колонку
        if (!taskId) {
          console.error('CRITICAL: Attempted to create TaskAssignment with null/empty taskId');
          throw new BadRequestException('TaskId не може бути порожнім');
        }

        const newAssignment = new TaskAssignment();
        newAssignment.taskId       = taskId;
        newAssignment.userId       = volunteer.id;
        newAssignment.fulfilledRole = dto.fulfilledRole ?? (null as any);
        newAssignment.status       = AssignmentStatus.ASSIGNED;
        newAssignment.assignedAt   = new Date();
        
        console.log(`Creating new TaskAssignment for taskId: ${taskId}, userId: ${volunteer.id}`);
        assignment = await manager.save(TaskAssignment, newAssignment);
      }

      const newActiveCount = activeAssignments.length + 1;
      const isNowFull = newActiveCount >= task.neededPeopleCount;

      // Якщо задача ще не в роботі, переводимо в IN_PROGRESS
      if (task.status === TaskStatus.TODO) {
        task.status = TaskStatus.IN_PROGRESS;
        const chat = await this.createChatWithAssignments(manager, task, request, volunteer, assignments);
        task.chatId = chat.id;
        await manager.save(Task, task);

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
      } else if (task.chatId) {
        // Якщо задача вже в роботі, додаємо нового волонтера в існуючий чат
        setImmediate(() => {
          this.chatGateway?.addParticipantToRoom(volunteer.id, task.chatId!, `Задача: ${task.title}`);
        });
      }

      if (request.status === RequestStatus.OPEN) {
        await manager.update(Request, request.id, {
          status: RequestStatus.IN_PROGRESS,
        });
      }

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
      await this.taskRepository.update(taskId, { status: TaskStatus.TODO, chatId: null });
    }
  }

  async completeTask(taskId: string, user: User): Promise<Task> {
    const task = await this.taskRepository.findOne({
      where: { id: taskId },
      relations: ['request', 'assignments'],
    });
    if (!task) throw new NotFoundException('Підзадачу не знайдено');

    const isAssignee = task.assignments.some(
      (a) => a.userId === user.id && (a.status === AssignmentStatus.ASSIGNED || a.status === AssignmentStatus.ON_SITE),
    );
    if (!isAssignee && user.systemRole !== SystemRole.ADMIN &&
        user.systemRole !== SystemRole.COORDINATOR) {
      throw new ForbiddenException('Лише виконавець може завершити цю задачу');
    }

    task.status = TaskStatus.PENDING_REVIEW;
    task.pendingReviewAt = new Date();
    return this.taskRepository.save(task);
  }

  async returnToProgress(taskId: string, user: User): Promise<Task> {
    const task = await this.taskRepository.findOne({
      where: { id: taskId },
      relations: ['request', 'assignments'],
    });
    if (!task) throw new NotFoundException('Підзадачу не знайдено');

    const isAssignee = task.assignments.some(
      (a) => a.userId === user.id && (a.status === AssignmentStatus.ASSIGNED || a.status === AssignmentStatus.ON_SITE || a.status === AssignmentStatus.COMPLETED),
    );

    if (!isAssignee && user.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Лише виконавець або адміністратор може повернути задачу в роботу');
    }

    if (task.status !== TaskStatus.PENDING_REVIEW) {
      throw new BadRequestException('Задача не знаходиться на перевірці');
    }

    if (task.pendingReviewAt) {
      const oneHourInMs = 60 * 60 * 1000;
      if (new Date().getTime() - task.pendingReviewAt.getTime() > oneHourInMs && user.systemRole !== SystemRole.ADMIN) {
        throw new ForbiddenException('Час для скасування відправки на перевірку вичерпано (1 година)');
      }
    }

    task.status = TaskStatus.IN_PROGRESS;
    task.pendingReviewAt = null as any;
    return this.taskRepository.save(task);
  }

  async confirmTaskCompletion(taskId: string, requester: User): Promise<Task> {
    const task = await this.taskRepository.findOne({
      where: { id: taskId },
      relations: ['request', 'assignments'],
    });
    if (!task) throw new NotFoundException('Підзадачу не знайдено');
    if (task.request.creatorId !== requester.id && requester.systemRole !== SystemRole.ADMIN) {
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

  async updateTaskStatusAdmin(taskId: string, status: TaskStatus, user: User): Promise<Task> {
    if (user.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Лише адміністратор може примусово змінювати статус');
    }
    const task = await this.taskRepository.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Підзадачу не знайдено');

    task.status = status;
    return this.taskRepository.save(task);
  }

  async cancelTask(taskId: string, user: User): Promise<Task> {
    const task = await this.taskRepository.findOne({
      where: { id: taskId },
      relations: ['request', 'assignments'],
    });
    if (!task) throw new NotFoundException('Підзадачу не знайдено');

    const isOwner = task.request.creatorId === user.id;
    const isAdmin = user.systemRole === SystemRole.ADMIN;
    const isCoordinator = user.systemRole === SystemRole.COORDINATOR;

    if (!isOwner && !isAdmin && !isCoordinator) {
      throw new ForbiddenException('Немає прав для скасування цієї підзадачі');
    }

    const hasActiveAssignments = task.assignments?.some(
      (a) => a.status !== AssignmentStatus.WITHDRAWN,
    );

    if (hasActiveAssignments && !isAdmin) {
      throw new ForbiddenException('Не можна скасувати підзадачу, яку вже взяли в роботу волонтери');
    }

    task.status = TaskStatus.CANCELLED;
    return this.taskRepository.save(task);
  }

  async renewTask(taskId: string, user: User): Promise<Task> {
    const task = await this.taskRepository.findOne({
      where: { id: taskId },
      relations: ['request'],
    });
    if (!task) throw new NotFoundException('Підзадачу не знайдено');

    const isOwner = task.request.creatorId === user.id;
    const isAdmin = user.systemRole === SystemRole.ADMIN;
    const isCoordinator = user.systemRole === SystemRole.COORDINATOR;

    if (!isOwner && !isAdmin && !isCoordinator) {
      throw new ForbiddenException('Немає прав для поновлення цієї підзадачі');
    }

    if (task.status !== TaskStatus.CANCELLED) {
      throw new BadRequestException('Підзадача не скасована');
    }

    task.status = TaskStatus.TODO;
    return this.taskRepository.save(task);
  }

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

  async delegateTask(
    taskId: string,
    dto: DelegateTaskDto,
    coordinator: User,
  ): Promise<TaskDelegation> {
    const task = await this.taskRepository.findOne({ where: { id: taskId }, relations: ['request'] });
    if (!task) throw new NotFoundException('Підзадачу не знайдено');

    if (coordinator.systemRole !== SystemRole.COORDINATOR && coordinator.systemRole !== SystemRole.ADMIN) {
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
        .notifyDelegation(dto.organizationId, task.title, '')
        .catch(() => {});
    });

    return delegation;
  }

  private checkClearanceAccess(required: ClearanceLevel, user: User): void {
    const ranks: Record<ClearanceLevel, number> = {
      [ClearanceLevel.LOCAL]: 0,
      [ClearanceLevel.INTERNATIONAL]: 1,
      [ClearanceLevel.FRONTLINE]: 2,
    };
    if ((ranks[user.clearanceLevel] ?? 0) < (ranks[required] ?? 0)) {
      throw new ForbiddenException(`Потрібен рівень допуску: ${required}`);
    }
  }

  private async createChatWithAssignments(manager: any, task: Task, request: Request, newVolunteer: User, assignments: TaskAssignment[]): Promise<Chat> {
    const participantIds = new Set<string>([request.creatorId]);
    assignments
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
       .set({ trustScore: () => 'LEAST(trust_score + 5, 100)' } as any)
       .where('id IN (:...ids)', { ids: userIds })
       .execute();
   }

  private async checkRequestCompletion(requestId: string): Promise<void> {
    const [total, done] = await Promise.all([
      this.taskRepository.count({ where: { requestId } }),
      this.taskRepository.count({ where: { requestId, status: TaskStatus.DONE } }),
    ]);
    if (total > 0 && total === done) {
      await this.requestRepository.update(requestId, { status: RequestStatus.COMPLETED });
    }
  }
}
