import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequestsService } from './requests.service';
import { Request } from './entities/request.entity';
import { SavedRequest } from './entities/saved-request.entity';
import { AccessLog } from './entities/access-log.entity';
import { Task } from '@modules/tasks/entities/task.entity';
import { User } from '@modules/users/entities/user.entity';
import {
  SystemRole,
  ClearanceLevel,
  RequestStatus,
  RequestCategory,
  TaskStatus,
  TaskOrigin,
} from '@common/enums';

describe('RequestsService', () => {
  let service: RequestsService;
  let requestRepo: jest.Mocked<Repository<Request>>;
  let savedRequestRepo: jest.Mocked<Repository<SavedRequest>>;
  let accessLogRepo: jest.Mocked<Repository<AccessLog>>;
  let taskRepo: jest.Mocked<Repository<Task>>;

  const createRequest = (overrides: Partial<Request> = {}): Request =>
    ({
      id: 'req-1',
      title: 'Test Request',
      description: 'Test description',
      status: RequestStatus.OPEN,
      creatorId: 'creator-id',
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
      isLocationHidden: false,
      latitude: 50.45,
      longitude: 30.52,
      tags: [],
      mediaUrls: [{ url: 'http://example.com/img.jpg', blurred: false }],
      additionalInfo: [],
      requiredClearance: ClearanceLevel.LOCAL,
      ...overrides,
    } as Request);

  const createUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'viewer-id',
      email: 'viewer@test.com',
      fullName: 'Viewer',
      passwordHash: 'hash',
      systemRole: SystemRole.VOLUNTEER,
      clearanceLevel: ClearanceLevel.LOCAL,
      trustScore: 0,
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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestsService,
        {
          provide: getRepositoryToken(Request),
          useValue: {
            createQueryBuilder: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
            softDelete: jest.fn(),
            query: jest.fn(),
            create: jest.fn(),
            findAndCount: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SavedRequest),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
            exists: jest.fn().mockResolvedValue(false),
            create: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(AccessLog),
          useValue: {
            save: jest.fn().mockResolvedValue({}),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Task),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RequestsService>(RequestsService);
    requestRepo = module.get(getRepositoryToken(Request));
    savedRequestRepo = module.get(getRepositoryToken(SavedRequest));
    accessLogRepo = module.get(getRepositoryToken(AccessLog));
    taskRepo = module.get(getRepositoryToken(Task));
  });

  // =====================================================================
  // 6.1 - Obfuscation of coordinates
  // =====================================================================

  it('6.1a - obfuscation: owner sees exact coordinates', () => {
    const req = createRequest({ creatorId: 'owner-id' });
    const owner = createUser({ id: 'owner-id' });

    const result = (service as any).obfuscateLocation(req, owner);

    expect(result.latitude).toBe(50.45);
    expect(result.longitude).toBe(30.52);
  });

  it('6.1b - obfuscation: FRONTLINE user sees exact coordinates', () => {
    const req = createRequest({ creatorId: 'other-id' });
    const frontline = createUser({
      id: 'frontline-id',
      clearanceLevel: ClearanceLevel.FRONTLINE,
    });

    const result = (service as any).obfuscateLocation(req, frontline);

    expect(result.latitude).toBe(50.45);
    expect(result.longitude).toBe(30.52);
  });

  it('6.1c - obfuscation: LOCAL user does NOT see exact coordinates', () => {
    const req = createRequest({ creatorId: 'other-id' });
    const local = createUser({
      id: 'local-id',
      clearanceLevel: ClearanceLevel.LOCAL,
    });

    const result = (service as any).obfuscateLocation(req, local);

    // Координати мають бути змінені (обфусковані)
    const exactlyOriginal = result.latitude === 50.45 && result.longitude === 30.52;
    expect(exactlyOriginal).toBe(false);
  });

  it('6.1d - obfuscation: admin sees exact coordinates', () => {
    const req = createRequest({ creatorId: 'other-id' });
    const admin = createUser({
      id: 'admin-id',
      systemRole: SystemRole.ADMIN,
      clearanceLevel: ClearanceLevel.LOCAL,
    });

    const result = (service as any).obfuscateLocation(req, admin);

    expect(result.latitude).toBe(50.45);
    expect(result.longitude).toBe(30.52);
  });

  // =====================================================================
  // 6.2 - Auto-categorization (auto-tagging)
  // =====================================================================

  it('6.2a - auto-tag: text contains "medik" - tag "#Medicine"', () => {
    const tags = (service as any).autoCategorizeTags('Потрібен медик для огляду');
    expect(tags).toContain('#Медицина');
  });

  it('6.2b - auto-tag: text contains "evacuation" - tag "#Evacuation"', () => {
    const tags = (service as any).autoCategorizeTags('Термінова евакуація з міста');
    expect(tags).toContain('#Евакуація');
  });

  it('6.2c - auto-tag: text without keywords - empty array', () => {
    const tags = (service as any).autoCategorizeTags('Звичайний опис без спеціальних слів');
    expect(tags).toEqual([]);
  });

  it('6.2d - автотег: кілька ключових слів → кілька тегів', () => {
    const tags = (service as any).autoCategorizeTags(
      'Потрібен транспорт для доставки ліки та перевезення поранених',
    );
    expect(tags).toContain('#Медицина');
    expect(tags).toContain('#Логістика');
  });

  // =====================================================================
  // 6.3 - Clearance filtering (checkClearanceAccess)
  // =====================================================================

  it('6.3a - clearance: LOCAL cannot view FRONTLINE request', () => {
    const req = createRequest({
      requiredClearance: ClearanceLevel.FRONTLINE,
      creatorId: 'other-id',
    });
    const local = createUser({
      id: 'local-id',
      clearanceLevel: ClearanceLevel.LOCAL,
    });

    expect(() => (service as any).checkClearanceAccess(req, local)).toThrow(
      'Недостатній рівень допуску',
    );
  });

  it('6.3b - clearance: admin sees any request', () => {
    const req = createRequest({
      requiredClearance: ClearanceLevel.FRONTLINE,
      creatorId: 'other-id',
    });
    const admin = createUser({
      id: 'admin-id',
      systemRole: SystemRole.ADMIN,
      clearanceLevel: ClearanceLevel.LOCAL,
    });

    expect(() => (service as any).checkClearanceAccess(req, admin)).not.toThrow();
  });

  it('6.3c - clearance: coordinator sees any request', () => {
    const req = createRequest({
      requiredClearance: ClearanceLevel.FRONTLINE,
      creatorId: 'other-id',
    });
    const coordinator = createUser({
      id: 'coord-id',
      systemRole: SystemRole.COORDINATOR,
      clearanceLevel: ClearanceLevel.LOCAL,
    });

    expect(() =>
      (service as any).checkClearanceAccess(req, coordinator),
    ).not.toThrow();
  });

  // =====================================================================
  // 6.4 - Create (request creation)
  // =====================================================================

  it('6.4a - create: successful request creation with auto-task', async () => {
    const dto = {
      title: 'Нова заявка',
      description: 'Опис',
      category: RequestCategory.MEDICAL,
      urgency: undefined,
      latitude: 50.45,
      longitude: 30.52,
      isLocationHidden: false,
      requiredClearance: ClearanceLevel.LOCAL,
      tags: [],
    };
    const creator = createUser({ id: 'creator-id' });

    const savedRequest = { id: 'req-1', ...dto, creatorId: 'creator-id', tags: ['#Медицина'] };
    requestRepo.create.mockReturnValue(savedRequest as any);
    requestRepo.save.mockResolvedValue(savedRequest as any);
    taskRepo.create.mockReturnValue({ requestId: 'req-1', title: 'Виконати заявку' } as any);
    taskRepo.save.mockResolvedValue({} as any);
    requestRepo.query.mockResolvedValue(undefined);

    const result = await service.create(dto as any, creator as User);

    expect(result).toBeDefined();
    expect(requestRepo.save).toHaveBeenCalled();
    expect(taskRepo.save).toHaveBeenCalled();
    expect(result.tags).toContain('#Медицина');
  });

  it('6.4b - create: without coordinates - no PostGIS query', async () => {
    const dto = {
      title: 'Заявка без координат',
      description: 'Опис',
      category: RequestCategory.OTHER,
      urgency: undefined,
      requiredClearance: ClearanceLevel.LOCAL,
      tags: [],
    };
    const creator = createUser({ id: 'creator-id' });

    const savedRequest = { id: 'req-2', ...dto, creatorId: 'creator-id', tags: [] };
    requestRepo.create.mockReturnValue(savedRequest as any);
    requestRepo.save.mockResolvedValue(savedRequest as any);
    taskRepo.create.mockReturnValue({ requestId: 'req-2' } as any);
    taskRepo.save.mockResolvedValue({} as any);

    await service.create(dto as any, creator as User);

    // query() не має викликатись для PostGIS
    expect(requestRepo.query).not.toHaveBeenCalled();
  });

  // =====================================================================
  // 6.5 - addInfo (additional info)
  // =====================================================================

  it('6.5a - addInfo: owner adds info', async () => {
    const req = createRequest({ creatorId: 'owner-id', additionalInfo: [] });
    requestRepo.findOne.mockResolvedValue(req as any);
    requestRepo.save.mockResolvedValue(req as any);

    const dto = { text: 'Нова інформація', attachments: [] };
    const owner = createUser({ id: 'owner-id' });

    const result = await service.addInfo('req-1', dto, owner as User);

    expect(result.additionalInfo).toHaveLength(1);
    expect(result.additionalInfo[0].text).toBe('Нова інформація');
  });

  it('6.5b - addInfo: non-owner rejected', async () => {
    const req = createRequest({ creatorId: 'owner-id' });
    requestRepo.findOne.mockResolvedValue(req as any);

    const dto = { text: 'Спроба доповнити', attachments: [] };
    const other = createUser({ id: 'other-id' });

    await expect(service.addInfo('req-1', dto, other as User)).rejects.toThrow(
      'Тільки власник',
    );
  });

  // =====================================================================
  // 6.6 - Status operations
  // =====================================================================

  it('6.6a - cancel: owner cancels OPEN request', async () => {
    const req = createRequest({ creatorId: 'owner-id', status: RequestStatus.OPEN });
    requestRepo.findOne.mockResolvedValue(req as any);
    requestRepo.save.mockResolvedValue({ ...req, status: RequestStatus.CANCELLED } as any);

    const owner = createUser({ id: 'owner-id' });
    const result = await service.cancel('req-1', 'Причина', owner as User);

    expect(result.status).toBe(RequestStatus.CANCELLED);
    // Перевіряємо що save було викликано з cancelReason
    expect(requestRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ cancelReason: 'Причина', status: RequestStatus.CANCELLED }),
    );
  });

  it('6.6b - cancel: non-owner rejected', async () => {
    const req = createRequest({ creatorId: 'other-id', status: RequestStatus.OPEN });
    requestRepo.findOne.mockResolvedValue(req as any);

    const notOwner = createUser({ id: 'random-id' });
    await expect(service.cancel('req-1', 'Причина', notOwner as User)).rejects.toThrow(
      'Немає прав',
    );
  });

  it('6.6c - cancel: COMPLETED request cannot be cancelled', async () => {
    const req = createRequest({
      creatorId: 'owner-id',
      status: RequestStatus.COMPLETED,
    });
    requestRepo.findOne.mockResolvedValue(req as any);

    const owner = createUser({ id: 'owner-id' });
    await expect(service.cancel('req-1', 'Причина', owner as User)).rejects.toThrow(
      'Завершену заявку',
    );
  });

  it('6.6d - confirmCompletion: owner confirms completion', async () => {
    const req = createRequest({ creatorId: 'owner-id', status: RequestStatus.IN_PROGRESS });
    requestRepo.findOne.mockResolvedValue(req as any);
    requestRepo.save.mockResolvedValue({
      ...req,
      status: RequestStatus.COMPLETED,
    } as any);

    const owner = createUser({ id: 'owner-id' });
    const result = await service.confirmCompletion('req-1', owner as User);

    expect(result.status).toBe(RequestStatus.COMPLETED);
  });

  it('6.6e - returnToProgress: returns CANCELLED → IN_PROGRESS (within 10 min)', async () => {
    const justCancelled = new Date(Date.now() - 60 * 1000); // 1 хвилина тому
    const req = createRequest({
      creatorId: 'owner-id',
      status: RequestStatus.CANCELLED,
      cancelledAt: justCancelled,
    });
    requestRepo.findOne.mockResolvedValue(req as any);
    requestRepo.save.mockResolvedValue({
      ...req,
      status: RequestStatus.IN_PROGRESS,
    } as any);

    const owner = createUser({ id: 'owner-id' });
    const result = await service.returnToProgress('req-1', owner as User);

    expect(result.status).toBe(RequestStatus.IN_PROGRESS);
    // Перевіряємо що save було викликано з об'єктом що має очищені поля скасування
    expect(requestRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: RequestStatus.IN_PROGRESS,
        cancelReason: null,
        cancelledAt: null,
        cancelledByUserId: null,
      }),
    );
  });

  // =====================================================================
  // 6.7 - Access Log (view audit)
  // =====================================================================

  it('6.7a - log view of FRONTLINE request by non-owner', async () => {
    const request = createRequest({
      requiredClearance: ClearanceLevel.FRONTLINE,
      creatorId: 'other-id',
    });
    const viewer = createUser({ id: 'viewer-id' });

    // Mock the query builder for findOne
    const mockGetOne = jest.fn().mockResolvedValue(request);
    (service as any).requestRepository = {
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: mockGetOne,
      })),
    };

    await (service as any).logAccess(request, viewer, 'view_detail');

    expect(accessLogRepo.save).toHaveBeenCalled();
    const logEntry = (accessLogRepo.save as jest.Mock).mock.calls[0][0];
    expect(logEntry.userId).toBe('viewer-id');
    expect(logEntry.requestId).toBe('req-1');
    expect(logEntry.action).toBe('view_detail');
    expect(logEntry.clearanceAtAccess).toBe(ClearanceLevel.LOCAL);
  });

  it('6.7b - do NOT log if user is owner', async () => {
    const request = createRequest({
      requiredClearance: ClearanceLevel.FRONTLINE,
      creatorId: 'viewer-id',
    });
    const viewer = createUser({ id: 'viewer-id' });

    await (service as any).logAccess(request, viewer, 'view_detail');

    expect(accessLogRepo.save).not.toHaveBeenCalled();
  });

  it('6.7c - do NOT log for non-FRONTLINE requests', async () => {
    const request = createRequest({
      requiredClearance: ClearanceLevel.LOCAL,
      creatorId: 'other-id',
    });
    const viewer = createUser({ id: 'viewer-id' });

    await (service as any).logAccess(request, viewer, 'view_detail');

    expect(accessLogRepo.save).not.toHaveBeenCalled();
  });

  // =====================================================================
  // 6.8 - remove (request deletion)
  // =====================================================================

  it('6.8a - remove: owner deletes request (within 10 min)', async () => {
    const req = createRequest({ creatorId: 'owner-id', status: RequestStatus.OPEN, createdAt: new Date() });
    requestRepo.findOne.mockResolvedValue(req as any);
    requestRepo.softDelete.mockResolvedValue({} as any);

    const owner = createUser({ id: 'owner-id' });
    await service.remove('req-1', owner as User);
    expect(requestRepo.findOne).toHaveBeenCalled();
  });

  it('6.8b - remove: non-owner or non-admin rejected', async () => {
    const req = createRequest({ creatorId: 'owner-id' });
    requestRepo.findOne.mockResolvedValue(req as any);

    const other = createUser({ id: 'other-id', systemRole: SystemRole.VOLUNTEER });
    await expect(service.remove('req-1', other as User)).rejects.toThrow('Немає прав');
  });

  // =====================================================================
  // 6.9 - markAsPendingReview (request pending review)
  // =====================================================================

  it('6.9 - markAsPendingReview: changes request status to PENDING_REVIEW', async () => {
    const req = createRequest({ creatorId: 'owner-id', status: RequestStatus.OPEN });
    requestRepo.findOne.mockResolvedValue(req as any);
    requestRepo.save.mockResolvedValue({ ...req, status: RequestStatus.PENDING_REVIEW } as any);

    const owner = createUser({ id: 'owner-id' });
    const result = await service.markAsPendingReview('req-1', owner as User);

    expect(result.status).toBe(RequestStatus.PENDING_REVIEW);
  });

  // =====================================================================
  // 6.10 - findOne: detailed request view
  // =====================================================================

  it('6.10a - findOne: owner sees request', async () => {
    const req = createRequest({ id: 'req-xyz', creatorId: 'owner-id' });
    const mockGetOne = jest.fn().mockResolvedValue(req);
    requestRepo.createQueryBuilder.mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: mockGetOne,
    } as any);

    const owner = createUser({ id: 'owner-id' });
    const result = await service.findOne('req-xyz', owner as User);

    expect(result).toBeDefined();
    expect(result.id).toBe('req-xyz');
  });

  it('6.10b - findOne: not found → 404', async () => {
    const mockGetOne = jest.fn().mockResolvedValue(null);
    requestRepo.createQueryBuilder.mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: mockGetOne,
    } as any);

    const user = createUser();
    await expect(service.findOne('nonexistent', user as User)).rejects.toThrow(
      'не знайдено',
    );
  });

  // =====================================================================
  // 6.11 - findAll with filters
  // =====================================================================

  it('6.11 - findAll: returns requests with basic filters', async () => {
    const mockQb: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    requestRepo.createQueryBuilder.mockReturnValue(mockQb);

    const dto = { page: 1, limit: 10 };
    const user = createUser();

    const result = await service.findAll(dto as any, user as User);

    expect(Array.isArray(result)).toBe(true);
  });

  // =====================================================================
  // 6.12 - saveRequest / unsaveRequest / getSavedRequests
  // =====================================================================

  it('6.12a - saveRequest: saves request to favorites', async () => {
    savedRequestRepo.findOne.mockResolvedValue(null);
    savedRequestRepo.save.mockResolvedValue({} as any);

    await service.saveRequest('req-1', 'user-1');

    expect(savedRequestRepo.save).toHaveBeenCalled();
  });

  it('6.12b - unsaveRequest: removes from favorites', async () => {
    savedRequestRepo.delete.mockResolvedValue({} as any);

    await service.unsaveRequest('req-1', 'user-1');

    expect(savedRequestRepo.delete).toHaveBeenCalledWith({ requestId: 'req-1', userId: 'user-1' });
  });

  it('6.12c - getSavedRequests: returns saved requests with limit/offset', async () => {
    const savedItems = [
      { id: 'saved-1', requestId: 'req-1', request: createRequest({ id: 'req-1' }) },
    ];
    savedRequestRepo.find.mockResolvedValue(savedItems as any);

    const result = await service.getSavedRequests('user-1', 50, 0);

    expect(result).toHaveLength(1);
    expect(savedRequestRepo.find).toHaveBeenCalledWith(expect.any(Object));
  });

  it('6.12d - getSavedRequestIds: returns array of saved request IDs', async () => {
    savedRequestRepo.find.mockResolvedValue([
      { requestId: 'req-1' },
      { requestId: 'req-2' },
    ] as any);

    const result = await service.getSavedRequestIds('user-1');

    expect(result).toEqual(['req-1', 'req-2']);
  });

  // =====================================================================
  // 6.13 - update (request update)
  // =====================================================================

  it('6.13a - update: owner updates request', async () => {
    const req = createRequest({ id: 'req-1', creatorId: 'owner-id' });
    requestRepo.findOne.mockResolvedValue(req as any);
    requestRepo.save.mockResolvedValue({ ...req, title: 'Оновлена заявка' } as any);

    const owner = createUser({ id: 'owner-id' });
    const result = await service.update('req-1', { title: 'Оновлена заявка' } as any, owner as User);

    expect(result.title).toBe('Оновлена заявка');
  });

  it('6.13b - update: non-owner rejected', async () => {
    const req = createRequest({ id: 'req-1', creatorId: 'owner-id' });
    requestRepo.findOne.mockResolvedValue(req as any);

    const other = createUser({ id: 'other-id' });
    await expect(service.update('req-1', { title: 'New' } as any, other as User)).rejects.toThrow('Немає прав');
  });

  // =====================================================================
  // 6.14 - updateAdditionalInfo
  // =====================================================================

  it('6.14a - updateAdditionalInfo: owner updates within 30 min', async () => {
    const req = createRequest({
      creatorId: 'owner-id',
      additionalInfo: [{ id: 'info-1', text: 'Old text', attachments: [], createdAt: new Date() }],
    });
    requestRepo.findOne.mockResolvedValue(req as any);
    requestRepo.save.mockResolvedValue(req as any);

    const owner = createUser({ id: 'owner-id' });
    const result = await service.updateAdditionalInfo('req-1', 'info-1', { text: 'Updated text', attachments: [] }, owner as User);

    expect(result.additionalInfo[0].text).toBe('Updated text');
    expect(result.additionalInfo[0].updatedAt).toBeDefined();
  });

  it('6.14b - updateAdditionalInfo: info not found', async () => {
    const req = createRequest({
      creatorId: 'owner-id',
      additionalInfo: [{ id: 'info-1', text: 'Old text', attachments: [], createdAt: new Date() }],
    });
    requestRepo.findOne.mockResolvedValue(req as any);

    const owner = createUser({ id: 'owner-id' });
    await expect(service.updateAdditionalInfo('req-1', 'nonexistent', { text: 'Updated text', attachments: [] }, owner as User))
      .rejects.toThrow('Доповнення не знайдено');
  });

  it('6.14c - updateAdditionalInfo: admin can edit after 30 min', async () => {
    const oldDate = new Date(Date.now() - 40 * 60 * 1000); // 40 min ago
    const req = createRequest({
      creatorId: 'owner-id',
      additionalInfo: [{ id: 'info-1', text: 'Old text', attachments: [], createdAt: oldDate }],
    });
    requestRepo.findOne.mockResolvedValue(req as any);
    requestRepo.save.mockResolvedValue(req as any);

    const admin = createUser({ id: 'admin-id', systemRole: SystemRole.ADMIN });
    const result = await service.updateAdditionalInfo('req-1', 'info-1', { text: 'Admin updated', attachments: [] }, admin as User);

    expect(result.additionalInfo[0].text).toBe('Admin updated');
  });

  it('6.14d - updateAdditionalInfo: non-admin rejected after 30 min', async () => {
    const oldDate = new Date(Date.now() - 40 * 60 * 1000); // 40 min ago
    const req = createRequest({
      creatorId: 'owner-id',
      additionalInfo: [{ id: 'info-1', text: 'Old text', attachments: [], createdAt: oldDate }],
    });
    requestRepo.findOne.mockResolvedValue(req as any);

    const owner = createUser({ id: 'owner-id' });
    await expect(service.updateAdditionalInfo('req-1', 'info-1', { text: 'Updated', attachments: [] }, owner as User))
      .rejects.toThrow('Редагування можливе лише протягом 30 хвилин');
  });

  // =====================================================================
  // 6.15 - removeAdditionalInfo
  // =====================================================================

  it('6.15a - removeAdditionalInfo: owner removes within 30 min', async () => {
    const req = createRequest({
      creatorId: 'owner-id',
      additionalInfo: [{ id: 'info-1', text: 'To remove', attachments: [], createdAt: new Date() }],
    });
    requestRepo.findOne.mockResolvedValue(req as any);
    requestRepo.save.mockResolvedValue({ ...req, additionalInfo: [] } as any);

    const owner = createUser({ id: 'owner-id' });
    const result = await service.removeAdditionalInfo('req-1', 'info-1', owner as User);

    expect(result.additionalInfo).toHaveLength(0);
  });

  it('6.15b - removeAdditionalInfo: info not found', async () => {
    const req = createRequest({
      creatorId: 'owner-id',
      additionalInfo: [{ id: 'info-1', text: 'Old text', attachments: [], createdAt: new Date() }],
    });
    requestRepo.findOne.mockResolvedValue(req as any);

    const owner = createUser({ id: 'owner-id' });
    await expect(service.removeAdditionalInfo('req-1', 'nonexistent', owner as User))
      .rejects.toThrow('Доповнення не знайдено');
  });

  it('6.15c - removeAdditionalInfo: non-owner rejected', async () => {
    const req = createRequest({
      creatorId: 'owner-id',
      additionalInfo: [{ id: 'info-1', text: 'Old text', attachments: [], createdAt: new Date() }],
    });
    requestRepo.findOne.mockResolvedValue(req as any);

    const other = createUser({ id: 'other-id' });
    await expect(service.removeAdditionalInfo('req-1', 'info-1', other as User))
      .rejects.toThrow('Тільки власник');
  });

  it('6.15d - removeAdditionalInfo: rejected after 30 min for non-admin', async () => {
    const oldDate = new Date(Date.now() - 40 * 60 * 1000); // 40 min ago
    const req = createRequest({
      creatorId: 'owner-id',
      additionalInfo: [{ id: 'info-1', text: 'Old text', attachments: [], createdAt: oldDate }],
    });
    requestRepo.findOne.mockResolvedValue(req as any);

    const owner = createUser({ id: 'owner-id' });
    await expect(service.removeAdditionalInfo('req-1', 'info-1', owner as User))
      .rejects.toThrow('Видалення можливе лише протягом 30 хвилин');
  });

  // =====================================================================
  // 6.16 - getAccessLogs
  // =====================================================================

  it('6.16a - getAccessLogs: returns logs with filters', async () => {
    const mockQb: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        { id: 'log-1', userId: 'user-1', requestId: 'req-1', action: 'view_detail', createdAt: new Date() },
      ]),
    };
    accessLogRepo.createQueryBuilder.mockReturnValue(mockQb);

    const result = await service.getAccessLogs({
      requestId: 'req-1',
      userId: 'user-1',
      action: 'view_detail',
      from: '2025-01-01',
      to: '2025-12-31',
      limit: 10,
      offset: 0,
    });

    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe('user-1');
    expect(result[0].requestId).toBe('req-1');
  });

  it('6.16b - getAccessLogs: returns empty when no logs', async () => {
    const mockQb: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    accessLogRepo.createQueryBuilder.mockReturnValue(mockQb);

    const result = await service.getAccessLogs({ limit: 10, offset: 0 });

    expect(result).toHaveLength(0);
  });

  // =====================================================================
  // 6.17 - getRequestsWithPriority
  // =====================================================================

  it('6.17a - getRequestsWithPriority: with coordinates orders by distance', async () => {
    requestRepo.query.mockResolvedValue([{ id: 'req-1', title: 'Near' }, { id: 'req-2', title: 'Far' }]);
    const mockTaskQb: any = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    taskRepo.createQueryBuilder.mockReturnValue(mockTaskQb);

    const result = await service.getRequestsWithPriority({
      userLat: 50.45,
      userLng: 30.52,
      limit: 10,
      offset: 0,
    });

    expect(result).toHaveLength(2);
    expect(requestRepo.query).toHaveBeenCalled();
  });

  it('6.17b - getRequestsWithPriority: without coordinates returns raw SQL results', async () => {
    requestRepo.query.mockResolvedValue([{ id: 'req-3', title: 'No coords' }]);
    const mockTaskQb: any = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    taskRepo.createQueryBuilder.mockReturnValue(mockTaskQb);

    const result = await service.getRequestsWithPriority({ status: 'OPEN', limit: 5, offset: 0 });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('req-3');
  });

  // =====================================================================
  // 6.18 - getMyRequests
  // =====================================================================

  it('6.18a - getMyRequests: returns requests with total count', async () => {
    requestRepo.findAndCount.mockResolvedValue([
      [createRequest({ id: 'req-1', title: 'My request' })],
      1,
    ]);

    const result = await service.getMyRequests('creator-id', { limit: 10, offset: 0 });

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('My request');
    expect(result[0]._meta.total).toBe(1);
  });
});
