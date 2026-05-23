import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { TasksService } from './tasks.service';
import { Task } from './entities/task.entity';
import { TaskAssignment } from './entities/task-assignment.entity';
import { TaskDelegation } from './entities/task-delegation.entity';
import { TrustVouch } from '@modules/users/entities/trust-vouch.entity';
import { Request } from '@modules/requests/entities/request.entity';
import { Chat } from '@modules/chat/entities/chat.entity';
import { User } from '@modules/users/entities/user.entity';
import { OrganizationMember } from '@modules/organizations/entities/organization-member.entity';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { ChatGateway } from '@modules/chat/chat.gateway';
import { TaskStatus, AssignmentStatus, RequestStatus, ClearanceLevel, SystemRole, ChatType, OrgRole } from '@common/enums';

describe('TasksService — assignVolunteer (3.4)', () => {
  let service: TasksService;
  let dataSource: DataSource;
  let mockManager: any;

  const createTask = (overrides: Partial<Task> = {}): Task =>
    ({
      id: 'task-1',
      title: 'Test Task',
      requestId: 'req-1',
      status: TaskStatus.TODO,
      neededPeopleCount: 2,
      chatId: null,
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as Task);

  const createRequest = (overrides: Partial<Request> = {}): Request =>
    ({
      id: 'req-1',
      title: 'Test Request',
      status: RequestStatus.OPEN,
      creatorId: 'creator-id',
      requiredClearance: ClearanceLevel.FRONTLINE,
      ...overrides,
    } as Request);

  const createUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'vol-1',
      email: 'vol@test.com',
      fullName: 'Volunteer',
      passwordHash: 'hash',
      systemRole: SystemRole.VOLUNTEER,
      clearanceLevel: ClearanceLevel.FRONTLINE,
      trustScore: 10,
      isBlocked: false,
      isEmailVerified: true,
      isIdentityVerified: true,
      phoneNumber: '+380501234567',
      avatarUrl: 'http://example.com/avatar.jpg',
      refreshTokenHash: null,
      emailVerificationToken: null,
      passwordResetCode: null,
      passwordResetToken: null,
      passwordResetExpires: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      vehicles: [],
      givenVouches: [],
      receivedVouches: [],
      organizationMemberships: [],
      taskAssignments: [],
      ...overrides,
    } as User);

  beforeEach(async () => {
    mockManager = {
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    } as any;

    const mockTaskRepo = { createQueryBuilder: jest.fn(), findOne: jest.fn() };
    const mockAssignmentRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    const mockDelegationRepo = {};
    const mockVouchRepo = { count: jest.fn() };
    const mockRequestRepo = { findOne: jest.fn() };
    const mockChatRepo = { save: jest.fn(), create: jest.fn() };
    const mockOrgMemberRepo = {};

    const mockDataSource = {
      transaction: jest.fn((cb: (manager: EntityManager) => Promise<any>) => cb(mockManager as any)),
      createQueryBuilder: jest.fn(),
    };

    const mockNotificationsService = {
      notifyVolunteerAssigned: jest.fn().mockResolvedValue(undefined),
      notifyRequesterTeamFound: jest.fn().mockResolvedValue(undefined),
    };

    const mockChatGateway = {
      addParticipantToRoom: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: getRepositoryToken(Task), useValue: mockTaskRepo },
        { provide: getRepositoryToken(TaskAssignment), useValue: mockAssignmentRepo },
        { provide: getRepositoryToken(TaskDelegation), useValue: mockDelegationRepo },
        { provide: getRepositoryToken(TrustVouch), useValue: mockVouchRepo },
        { provide: getRepositoryToken(Request), useValue: mockRequestRepo },
        { provide: getRepositoryToken(Chat), useValue: mockChatRepo },
        { provide: getRepositoryToken(OrganizationMember), useValue: mockOrgMemberRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: ChatGateway, useValue: mockChatGateway },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
    dataSource = module.get<DataSource>(DataSource);
  });

  // ------------------------------------------------------
  // 3.4a — Заборонити REQUESTER брати задачу
  // ------------------------------------------------------
  it('3.4a — відхилити REQUESTER користувача', async () => {
    const task = createTask();
    const request = createRequest();
    const requesterUser = createUser({ id: 'req-user', systemRole: SystemRole.REQUESTER });

    mockManager.findOne.mockImplementation((entity: any, opts: any) => {
      if (entity === Task) return Promise.resolve(task);
      if (entity === Request) return Promise.resolve(request);
      if (entity === TaskAssignment) return Promise.resolve(null);
      return null;
    });
    mockManager.find.mockResolvedValue([]);

    await expect(service.assignVolunteer('task-1', {}, requesterUser as User))
      .rejects.toThrow('Requester');
  });

  // ------------------------------------------------------
  // 3.4b — Заборонити з недостатнім clearance (не FRONTLINE)
  // ------------------------------------------------------
  it('3.4b — відхилити користувача з LOCAL clearance для INTERNATIONAL задачі', async () => {
    const task = createTask();
    const request = createRequest({ requiredClearance: ClearanceLevel.INTERNATIONAL });
    const localUser = createUser({ id: 'local-user', clearanceLevel: ClearanceLevel.LOCAL });

    mockManager.findOne.mockImplementation((entity: any, opts: any) => {
      if (entity === Task) return Promise.resolve(task);
      if (entity === Request) return Promise.resolve(request);
      if (entity === TaskAssignment) return Promise.resolve(null);
      return null;
    });
    mockManager.find.mockResolvedValue([]);

    await expect(service.assignVolunteer('task-1', {}, localUser as User))
      .rejects.toThrow('Потрібен рівень допуску');
  });

  // ------------------------------------------------------
  // 3.4c — Перевірка поручителів для FRONTLINE
  // ------------------------------------------------------
  it('3.4c — відхилити волонтера без достатньої кількості поручителів для FRONTLINE', async () => {
    const task = createTask();
    const request = createRequest({ requiredClearance: ClearanceLevel.FRONTLINE });
    // INTERNATIONAL/LOCAL волонтер без поручителів має бути відхилений
    const volunteer = createUser({ id: 'vol-no-vouches', clearanceLevel: ClearanceLevel.LOCAL });

    mockManager.findOne.mockImplementation((entity: any, opts: any) => {
      if (entity === Task) return Promise.resolve(task);
      if (entity === Request) return Promise.resolve(request);
      if (entity === TaskAssignment) return Promise.resolve(null);
      return null;
    });
    mockManager.find.mockResolvedValue([]);
    // 0 поручителів — недостатньо для FRONTLINE (потрібно 3)
    mockManager.count.mockResolvedValue(0);

    await expect(service.assignVolunteer('task-1', {}, volunteer as User))
      .rejects.toThrow('поручителі');
  });

  // ------------------------------------------------------
  // 3.4d — Успішне призначення (TODO → IN_PROGRESS)
  // ------------------------------------------------------
  it('3.4d — успішне призначення: створює запис і переводить задачу в IN_PROGRESS', async () => {
    const task = createTask();
    const request = createRequest({ requiredClearance: ClearanceLevel.FRONTLINE });
    const volunteer = createUser();

    mockManager.findOne.mockImplementation((entity: any, opts: any) => {
      if (entity === Task) return Promise.resolve(task);
      if (entity === Request) return Promise.resolve(request);
      if (entity === TaskAssignment) return Promise.resolve(null);
      return null;
    });
    mockManager.find.mockResolvedValue([]);
    mockManager.count.mockResolvedValue(3);
    mockManager.save.mockResolvedValue({ id: 'assgn-1', taskId: 'task-1', userId: 'vol-1', status: AssignmentStatus.ASSIGNED, assignedAt: new Date() });
    // Створюємо chat при першому призначенні
    mockManager.create.mockReturnValue({ id: 'chat-1', type: ChatType.TASK_CHAT, name: 'Test', participants: [] });

    const result = await service.assignVolunteer('task-1', {}, volunteer as User);

    expect(result).toBeDefined();
    expect(mockManager.save).toHaveBeenCalled();
  });

  // ------------------------------------------------------
  // 3.4e — Відмова для DONE/CANCELLED задач
  // ------------------------------------------------------
  it('3.4e — відхилити якщо задача вже DONE', async () => {
    const task = createTask({ status: TaskStatus.DONE });
    const request = createRequest();
    const volunteer = createUser();

    mockManager.findOne.mockImplementation((entity: any, opts: any) => {
      if (entity === Task) return Promise.resolve(task);
      if (entity === Request) return Promise.resolve(request);
      if (entity === TaskAssignment) return Promise.resolve(null);
      return null;
    });
    mockManager.find.mockResolvedValue([]);

    await expect(service.assignVolunteer('task-1', {}, volunteer as User))
      .rejects.toThrow('завершено');
  });

  // ------------------------------------------------------
  // 3.4f — ConflictException при активному призначенні
  // ------------------------------------------------------
  it('3.4f — відхилити повторне призначення (вже призначений)', async () => {
    const task = createTask({ status: TaskStatus.IN_PROGRESS });
    const request = createRequest();
    const volunteer = createUser();
    const existingAssignment = { id: 'ex-1', taskId: 'task-1', userId: 'vol-1', status: AssignmentStatus.ASSIGNED };

    mockManager.findOne.mockImplementation((entity: any, opts: any) => {
      if (entity === Task) return Promise.resolve(task);
      if (entity === Request) return Promise.resolve(request);
      if (entity === TaskAssignment) return Promise.resolve(existingAssignment);
      return null;
    });
    mockManager.find.mockResolvedValue([]);

    await expect(service.assignVolunteer('task-1', {}, volunteer as User))
      .rejects.toThrow('Ви вже призначені');
  });

  // ------------------------------------------------------
  // 3.4g — UPSERT для WITHDRAWN → ASSIGNED
  // ------------------------------------------------------
  it('3.4g — дозволити повторне призначення після WITHDRAWN (UPSERT)', async () => {
    const task = createTask({ status: TaskStatus.IN_PROGRESS });
    const request = createRequest();
    const volunteer = createUser();
    const withdrawnAssignment = { id: 'ex-2', taskId: 'task-1', userId: 'vol-1', status: AssignmentStatus.WITHDRAWN };

    mockManager.findOne.mockImplementation((entity: any, opts: any) => {
      if (entity === Task) return Promise.resolve(task);
      if (entity === Request) return Promise.resolve(request);
      if (entity === TaskAssignment) return Promise.resolve(withdrawnAssignment);
      return null;
    });
    mockManager.find.mockResolvedValue([]);
    mockManager.count.mockResolvedValue(3);
    mockManager.save.mockResolvedValue({ ...withdrawnAssignment, status: AssignmentStatus.ASSIGNED });

    const result = await service.assignVolunteer('task-1', {}, volunteer as User);
    expect(result.status).toBe(AssignmentStatus.ASSIGNED);
  });
});

// =====================================================================
// Етап 2 — 8 тестів для інших методів TasksService
// =====================================================================

describe('TasksService — life cycle methods', () => {
  let service: TasksService;
  let mockTaskRepo: any;
  let mockAssignmentRepo: any;
  let mockVouchRepo: any;
  let mockDataSource: any;

  const createTask = (overrides: Partial<Task> = {}): Task =>
    ({
      id: 'task-1',
      title: 'Test Task',
      requestId: 'req-1',
      request: { id: 'req-1', creatorId: 'creator-id', status: RequestStatus.OPEN } as Request,
      status: TaskStatus.TODO,
      neededPeopleCount: 2,
      chatId: null,
      priority: 1,
      assignments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as Task);

  const createUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'vol-1',
      email: 'vol@test.com',
      fullName: 'Volunteer',
      passwordHash: 'hash',
      systemRole: SystemRole.VOLUNTEER,
      clearanceLevel: ClearanceLevel.FRONTLINE,
      trustScore: 10,
      isBlocked: false,
      isEmailVerified: true,
      isIdentityVerified: true,
      phoneNumber: '+380501234567',
      avatarUrl: 'http://example.com/avatar.jpg',
      refreshTokenHash: null,
      emailVerificationToken: null,
      passwordResetCode: null,
      passwordResetToken: null,
      passwordResetExpires: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      vehicles: [],
      givenVouches: [],
      receivedVouches: [],
      organizationMemberships: [],
      taskAssignments: [],
      ...overrides,
    } as User);

  beforeEach(async () => {
    mockTaskRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    mockAssignmentRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
      save: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
    };

    mockVouchRepo = { count: jest.fn() };

    const mockRequestRepo = { findOne: jest.fn() };
    const mockChatRepo = { save: jest.fn(), create: jest.fn() };
    const mockDelegationRepo = {};
    const mockOrgMemberRepo = {};

    mockDataSource = {
      transaction: jest.fn((cb: (manager: any) => Promise<any>) => cb({
        findOne: jest.fn(),
        find: jest.fn(),
        count: jest.fn(),
        save: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      })),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      })),
    };

    const mockNotificationsService = {
      notifyVolunteerAssigned: jest.fn().mockResolvedValue(undefined),
      notifyRequesterTeamFound: jest.fn().mockResolvedValue(undefined),
    };

    const mockChatGateway = {
      addParticipantToRoom: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: getRepositoryToken(Task), useValue: mockTaskRepo },
        { provide: getRepositoryToken(TaskAssignment), useValue: mockAssignmentRepo },
        { provide: getRepositoryToken(TaskDelegation), useValue: mockDelegationRepo },
        { provide: getRepositoryToken(TrustVouch), useValue: mockVouchRepo },
        { provide: getRepositoryToken(Request), useValue: mockRequestRepo },
        { provide: getRepositoryToken(Chat), useValue: mockChatRepo },
        { provide: getRepositoryToken(OrganizationMember), useValue: mockOrgMemberRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: ChatGateway, useValue: mockChatGateway },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  // ------------------------------------------------------
  // 2.1 — withdrawAssignment: успішне відкликання
  // ------------------------------------------------------
  it('2.1 — withdrawAssignment: змінює статус на WITHDRAWN', async () => {
    const assignment = {
      id: 'assgn-1',
      taskId: 'task-1',
      userId: 'vol-1',
      status: AssignmentStatus.ASSIGNED,
    };
    mockAssignmentRepo.findOne.mockResolvedValue(assignment);
    mockAssignmentRepo.count.mockResolvedValue(1); // ще є активні

    await service.withdrawAssignment('task-1', createUser() as User);

    expect(mockAssignmentRepo.update).toHaveBeenCalledWith('assgn-1', {
      status: AssignmentStatus.WITHDRAWN,
    });
  });

  // ------------------------------------------------------
  // 2.2 — withdrawAssignment: відхилення COMPLETED
  // ------------------------------------------------------
  it('2.2 — withdrawAssignment: забороняє відмову від COMPLETED', async () => {
    const assignment = {
      id: 'assgn-2',
      taskId: 'task-1',
      userId: 'vol-1',
      status: AssignmentStatus.COMPLETED,
    };
    mockAssignmentRepo.findOne.mockResolvedValue(assignment);

    await expect(service.withdrawAssignment('task-1', createUser() as User))
      .rejects.toThrow('завершеного');
  });

  // ------------------------------------------------------
  // 2.3 — completeTask: переводить у PENDING_REVIEW
  // ------------------------------------------------------
  it('2.3 — completeTask: виконавець переводить задачу в PENDING_REVIEW', async () => {
    const task = createTask({
      status: TaskStatus.IN_PROGRESS,
      assignments: [
        { userId: 'vol-1', status: AssignmentStatus.ASSIGNED } as any,
      ],
    });
    mockTaskRepo.findOne.mockResolvedValue(task);
    mockTaskRepo.save.mockResolvedValue({ ...task, status: TaskStatus.PENDING_REVIEW });

    const result = await service.completeTask('task-1', createUser() as User);

    expect(result.status).toBe(TaskStatus.PENDING_REVIEW);
  });

  // ------------------------------------------------------
  // 2.4 — confirmTaskCompletion: автор заявки підтверджує
  // ------------------------------------------------------
  it('2.4 — confirmTaskCompletion: автор підтверджує → DONE', async () => {
    const task = createTask({
      status: TaskStatus.PENDING_REVIEW,
      request: { id: 'req-1', creatorId: 'creator-id' } as any,
      assignments: [
        { userId: 'vol-1', status: AssignmentStatus.ASSIGNED, completedAt: null } as any,
      ],
    });
    mockTaskRepo.findOne.mockResolvedValue(task);
    mockTaskRepo.save.mockResolvedValue({ ...task, status: TaskStatus.DONE });
    mockAssignmentRepo.update.mockResolvedValue({});

    const requester = createUser({ id: 'creator-id' });
    const result = await service.confirmTaskCompletion('task-1', requester as User);

    expect(result.status).toBe(TaskStatus.DONE);
  });

  // ------------------------------------------------------
  // 2.5 — confirmTaskCompletion: не-автор ВІДХИЛЯЄТЬСЯ
  // ------------------------------------------------------
  it('2.5 — confirmTaskCompletion: не-власник заявки не може підтвердити', async () => {
    const task = createTask({
      status: TaskStatus.PENDING_REVIEW,
      request: { id: 'req-1', creatorId: 'another-user' } as any,
      assignments: [
        { userId: 'vol-1', status: AssignmentStatus.ASSIGNED } as any,
      ],
    });
    mockTaskRepo.findOne.mockResolvedValue(task);

    const nonOwner = createUser({ id: 'random-user' });
    await expect(
      service.confirmTaskCompletion('task-1', nonOwner as User),
    ).rejects.toThrow('автор');
  });

  // ------------------------------------------------------
  // 2.6 — rejectTask: автор відхиляє виконання
  // ------------------------------------------------------
  it('2.6 — rejectTask: автор відхиляє → IN_PROGRESS', async () => {
    const task = createTask({
      status: TaskStatus.PENDING_REVIEW,
      request: { id: 'req-1', creatorId: 'creator-id' } as any,
      assignments: [
        { userId: 'vol-1', status: AssignmentStatus.COMPLETED } as any,
      ],
    });
    mockTaskRepo.findOne.mockResolvedValue(task);
    mockTaskRepo.save.mockResolvedValue({ ...task, status: TaskStatus.IN_PROGRESS });
    mockAssignmentRepo.update.mockResolvedValue({});

    const requester = createUser({ id: 'creator-id' });
    const result = await service.rejectTask('task-1', requester as User, 'Неякісна робота');

    expect(result.status).toBe(TaskStatus.IN_PROGRESS);
  });

  // ------------------------------------------------------
  // 2.7 — cancelTask: адмін скасовує задачу
  // ------------------------------------------------------
  it('2.7 — cancelTask: адмін скасовує → CANCELLED', async () => {
    const task = createTask({
      status: TaskStatus.TODO,
      request: { id: 'req-1', creatorId: 'creator-id' } as any,
    });
    mockTaskRepo.findOne.mockResolvedValue(task);
    mockTaskRepo.save.mockResolvedValue({ ...task, status: TaskStatus.CANCELLED });

    const admin = createUser({ id: 'admin-id', systemRole: SystemRole.ADMIN });
    const result = await service.cancelTask('task-1', admin as User);

    expect(result.status).toBe(TaskStatus.CANCELLED);
  });

  // ------------------------------------------------------
  // 2.8 — renewTask: відновлення скасованої задачі
  // ------------------------------------------------------
  it('2.8 — renewTask: адмін відновлює CANCELLED → TODO', async () => {
    const task = createTask({
      status: TaskStatus.CANCELLED,
      request: { id: 'req-1', creatorId: 'creator-id' } as any,
    });
    mockTaskRepo.findOne.mockResolvedValue(task);
    mockTaskRepo.save.mockResolvedValue({ ...task, status: TaskStatus.TODO });

    const admin = createUser({ id: 'admin-id', systemRole: SystemRole.ADMIN });
    const result = await service.renewTask('task-1', admin as User);

    expect(result.status).toBe(TaskStatus.TODO);
  });

  // ------------------------------------------------------
  // 2.9 — renewTask: забороняє відновлення не-CANCELLED
  // ------------------------------------------------------
  it('2.9 — renewTask: відхиляє відновлення TODO задачі', async () => {
    const task = createTask({
      status: TaskStatus.TODO,
      request: { id: 'req-1', creatorId: 'creator-id' } as any,
    });
    mockTaskRepo.findOne.mockResolvedValue(task);

    const admin = createUser({ id: 'admin-id', systemRole: SystemRole.ADMIN });
    await expect(service.renewTask('task-1', admin as User))
      .rejects.toThrow('не скасована');
  });

  // ------------------------------------------------------
  // 2.10 — updateAssignmentStatus: EN_ROUTE
  // ------------------------------------------------------
  it('2.10 — updateAssignmentStatus: змінює статус на EN_ROUTE', async () => {
    const assignment = {
      id: 'assgn-5',
      taskId: 'task-1',
      userId: 'vol-1',
      status: AssignmentStatus.ASSIGNED,
    };
    mockAssignmentRepo.findOne.mockResolvedValue(assignment);
    mockAssignmentRepo.save.mockResolvedValue({ ...assignment, status: AssignmentStatus.EN_ROUTE });

    const result = await service.updateAssignmentStatus('task-1', AssignmentStatus.EN_ROUTE, createUser() as User);

    expect(result.status).toBe(AssignmentStatus.EN_ROUTE);
  });

  // ------------------------------------------------------
  // 2.11 — updateAssignmentStatus: ON_SITE
  // ------------------------------------------------------
  it('2.11 — updateAssignmentStatus: змінює статус на ON_SITE', async () => {
    const assignment = {
      id: 'assgn-6',
      taskId: 'task-1',
      userId: 'vol-1',
      status: AssignmentStatus.EN_ROUTE,
    };
    mockAssignmentRepo.findOne.mockResolvedValue(assignment);
    mockAssignmentRepo.save.mockResolvedValue({ ...assignment, status: AssignmentStatus.ON_SITE });

    const result = await service.updateAssignmentStatus('task-1', AssignmentStatus.ON_SITE, createUser() as User);

    expect(result.status).toBe(AssignmentStatus.ON_SITE);
  });

  // ------------------------------------------------------
  // 2.12 — updateAssignmentStatus: відхиляє невалідний статус
  // ------------------------------------------------------
  it('2.12 — updateAssignmentStatus: відхиляє COMPLETED статус', async () => {
    await expect(
      service.updateAssignmentStatus('task-1', AssignmentStatus.COMPLETED, createUser() as User),
    ).rejects.toThrow('Дозволені статуси');
  });

  // ------------------------------------------------------
  // 2.13 — updateAssignmentStatus: відхиляє WITHDRAWN призначення
  // ------------------------------------------------------
  it('2.13 — updateAssignmentStatus: відхиляє зміну для WITHDRAWN', async () => {
    const assignment = {
      id: 'assgn-7',
      taskId: 'task-1',
      userId: 'vol-1',
      status: AssignmentStatus.WITHDRAWN,
    };
    mockAssignmentRepo.findOne.mockResolvedValue(assignment);

    await expect(
      service.updateAssignmentStatus('task-1', AssignmentStatus.EN_ROUTE, createUser() as User),
    ).rejects.toThrow('завершеного або скасованого');
  });

  // ------------------------------------------------------
  // 2.14 — updateTaskStatusAdmin: адмін примусово змінює статус
  // ------------------------------------------------------
  it('2.14 — updateTaskStatusAdmin: примусово змінює статус задачі', async () => {
    const task = createTask({ status: TaskStatus.TODO });
    mockTaskRepo.findOne.mockResolvedValue(task);
    mockTaskRepo.save.mockResolvedValue({ ...task, status: TaskStatus.IN_PROGRESS });

    const admin = createUser({ id: 'admin-id', systemRole: SystemRole.ADMIN });
    const result = await service.updateTaskStatusAdmin('task-1', TaskStatus.IN_PROGRESS, admin as User);

    expect(result.status).toBe(TaskStatus.IN_PROGRESS);
  });

  // ------------------------------------------------------
  // 2.15 — updateTaskStatusAdmin: не-адмін відхиляється
  // ------------------------------------------------------
  it('2.15 — updateTaskStatusAdmin: забороняє не-адміну змінювати статус', async () => {
    const volunteer = createUser();
    await expect(
      service.updateTaskStatusAdmin('task-1', TaskStatus.DONE, volunteer as User),
    ).rejects.toThrow('адміністратор');
  });

  // ------------------------------------------------------
  // 2.16 — returnToProgress: повертає PENDING_REVIEW → IN_PROGRESS
  // ------------------------------------------------------
  it('2.16 — returnToProgress: повертає PENDING_REVIEW в IN_PROGRESS', async () => {
    const task = createTask({
      status: TaskStatus.PENDING_REVIEW,
      request: { id: 'req-1', creatorId: 'creator-id' } as any,
      assignments: [
        { userId: 'vol-1', status: AssignmentStatus.ASSIGNED } as any,
      ],
    });
    mockTaskRepo.findOne.mockResolvedValue(task);
    mockTaskRepo.save.mockResolvedValue({ ...task, status: TaskStatus.IN_PROGRESS });
    mockAssignmentRepo.update.mockResolvedValue({});

    const result = await service.returnToProgress('task-1', createUser() as User);

    expect(result.status).toBe(TaskStatus.IN_PROGRESS);
  });

  // ------------------------------------------------------
  // 2.17 — cancelTask: координатор може скасувати
  // ------------------------------------------------------
  it('2.17 — cancelTask: координатор може скасувати задачу', async () => {
    const task = createTask({
      status: TaskStatus.TODO,
      request: { id: 'req-1', creatorId: 'creator-id' } as any,
    });
    mockTaskRepo.findOne.mockResolvedValue(task);
    mockTaskRepo.save.mockResolvedValue({ ...task, status: TaskStatus.CANCELLED });

    const coordinator = createUser({ id: 'coord-id', systemRole: SystemRole.COORDINATOR });
    const result = await service.cancelTask('task-1', coordinator as User);

    expect(result.status).toBe(TaskStatus.CANCELLED);
  });

  // ------------------------------------------------------
  // 2.18 — cancelTask: звичайний волонтер не може скасувати
  // ------------------------------------------------------
  it('2.18 — cancelTask: волонтер не може скасувати чужу задачу', async () => {
    const task = createTask({
      status: TaskStatus.TODO,
      request: { id: 'req-1', creatorId: 'another-user' } as any,
    });
    mockTaskRepo.findOne.mockResolvedValue(task);

    const volunteer = createUser({ id: 'random-vol' });
    await expect(service.cancelTask('task-1', volunteer as User))
      .rejects.toThrow('Немає прав');
  });
});

// =====================================================================
// Етап 3 — Делегування задач (delegateTask / acceptDelegation / declineDelegation)
// =====================================================================

describe('TasksService — Delegation', () => {
  let service: TasksService;
  let mockTaskRepo: any;
  let mockDelegationRepo: any;
  let mockOrgMemberRepo: any;
  let mockRequestRepo: any;

  beforeEach(async () => {
    mockTaskRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'task-1', request: { id: 'req-1' } }),
      save: jest.fn(),
    };
    mockDelegationRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((d) => Promise.resolve(d)),
      query: jest.fn(),
    };
    mockOrgMemberRepo = {
      findOne: jest.fn().mockResolvedValue({ orgRole: OrgRole.LEADER }),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ orgRole: OrgRole.LEADER }),
      }),
    };
    mockRequestRepo = {
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: getRepositoryToken(Task), useValue: mockTaskRepo },
        { provide: getRepositoryToken(TaskAssignment), useValue: mockTaskRepo },
        { provide: getRepositoryToken(TaskDelegation), useValue: mockDelegationRepo },
        { provide: getRepositoryToken(OrganizationMember), useValue: mockOrgMemberRepo },
        { provide: getRepositoryToken(Request), useValue: mockRequestRepo },
        { provide: getRepositoryToken(TrustVouch), useValue: { count: jest.fn().mockResolvedValue(3) } },
        { provide: getRepositoryToken(Chat), useValue: { save: jest.fn() } },
        { provide: ChatGateway, useValue: { addParticipantToRoom: jest.fn() } },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(async (cb: any) => cb({
              findOne: jest.fn(),
              find: jest.fn(),
              count: jest.fn().mockResolvedValue(0),
              save: jest.fn((x: any) => Promise.resolve(x)),
              create: jest.fn((x: any) => x),
            })),
          },
        },
        { provide: NotificationsService, useValue: { notify: jest.fn(), notifyDelegation: jest.fn() } },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  it('3.1 — delegateTask: координатор делегує задачу організації', async () => {
    mockOrgMemberRepo.findOne.mockResolvedValue({ orgRole: 'coordinator' });
    mockDelegationRepo.query.mockResolvedValue([{
      id: 'del-1',
      taskId: 'task-1',
      organizationId: 'org-1',
      isAccepted: null,
    }]);

    const coordinator = { id: 'coord-id', systemRole: SystemRole.COORDINATOR } as any;
    const result = await service.delegateTask('task-1', { organizationId: 'org-1', message: 'Test' }, coordinator);

    expect(result).toBeDefined();
    expect(mockDelegationRepo.query).toHaveBeenCalled();
  });

  it('3.2 — acceptDelegation: координатор приймає делегування', async () => {
    const delegation = { id: 'del-1', isAccepted: null, task: { request: { id: 'req-1' } } };
    mockDelegationRepo.findOne.mockResolvedValue(delegation);
    mockDelegationRepo.save.mockResolvedValue({ ...delegation, isAccepted: true });

    const coordinator = { id: 'coord-id', systemRole: SystemRole.COORDINATOR } as any;
    const result = await service.acceptDelegation('task-1', 'org-1', coordinator);

    expect(result.isAccepted).toBe(true);
    expect(mockRequestRepo.update).toHaveBeenCalledWith('req-1', { managingOrganizationId: 'org-1' });
  });

  it('3.3 — declineDelegation: координатор відхиляє делегування', async () => {
    const delegation = { id: 'del-1', isAccepted: null, task: { title: 'Task' } };
    mockDelegationRepo.findOne.mockResolvedValue(delegation);
    mockDelegationRepo.save.mockResolvedValue({ ...delegation, isAccepted: false });

    const coordinator = { id: 'coord-id', systemRole: SystemRole.COORDINATOR } as any;
    const result = await service.declineDelegation('task-1', 'org-1', coordinator);

    expect(result.isAccepted).toBe(false);
  });
});
