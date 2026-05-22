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