import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequestsService } from './requests.service';
import { Request } from './entities/request.entity';
import { SavedRequest } from './entities/saved-request.entity';
import { AccessLog } from './entities/access-log.entity';
import { User } from '@modules/users/entities/user.entity';
import { SystemRole, ClearanceLevel, RequestStatus } from '@common/enums';

describe('RequestsService — logAccess (6.7)', () => {
  let service: RequestsService;
  let accessLogRepo: jest.Mocked<Repository<AccessLog>>;

  const mockRequestRepo = () => ({
    createQueryBuilder: jest.fn(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
      getMany: jest.fn(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
    })),
    findOne: jest.fn(),
    save: jest.fn(),
    softDelete: jest.fn(),
    query: jest.fn(),
  });

  const mockSavedRequestRepo = () => ({
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn().mockResolvedValue(false),
  });

  const mockAccessLogRepo = () => ({
    save: jest.fn().mockResolvedValue({}),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestsService,
        { provide: getRepositoryToken(Request), useFactory: mockRequestRepo },
        { provide: getRepositoryToken(SavedRequest), useFactory: mockSavedRequestRepo },
        { provide: getRepositoryToken(AccessLog), useFactory: mockAccessLogRepo },
      ],
    }).compile();

    service = module.get<RequestsService>(RequestsService);
    accessLogRepo = module.get(getRepositoryToken(AccessLog));
  });

  const createRequest = (overrides: Partial<Request> = {}): Request => ({
    id: 'req-1',
    title: 'Test FRONTLINE Request',
    description: 'Test description',
    status: RequestStatus.OPEN,
    creatorId: 'creator-id',
    createdAt: new Date(),
    updatedAt: new Date(),
    isLocationHidden: true,
    latitude: 50.0,
    longitude: 30.0,
    tags: [],
    mediaUrls: [{ url: 'http://example.com/img.jpg', blurred: false }],
    requiredClearance: ClearanceLevel.FRONTLINE,
    ...overrides,
  } as Request);

  const createUser = (overrides: Partial<User> = {}): User => ({
    id: 'viewer-id',
    email: 'viewer@test.com',
    fullName: 'Viewer',
    passwordHash: 'hash',
    systemRole: SystemRole.VOLUNTEER,
    clearanceLevel: ClearanceLevel.FRONTLINE,
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

  it('6.7a — логувати перегляд FRONTLINE заявки не-власником', async () => {
    const request = createRequest({ requiredClearance: ClearanceLevel.FRONTLINE, creatorId: 'other-id' });
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

    // We'll test logAccess directly instead
    await (service as any).logAccess(request, viewer, 'view_detail');

    expect(accessLogRepo.save).toHaveBeenCalled();
    const logEntry = (accessLogRepo.save as jest.Mock).mock.calls[0][0];
    expect(logEntry.userId).toBe('viewer-id');
    expect(logEntry.requestId).toBe('req-1');
    expect(logEntry.action).toBe('view_detail');
    expect(logEntry.clearanceAtAccess).toBe(ClearanceLevel.FRONTLINE);
  });

  it('6.7b — НЕ логувати якщо користувач є власником', async () => {
    const request = createRequest({ requiredClearance: ClearanceLevel.FRONTLINE, creatorId: 'viewer-id' });
    const viewer = createUser({ id: 'viewer-id' });

    await (service as any).logAccess(request, viewer, 'view_detail');

    expect(accessLogRepo.save).not.toHaveBeenCalled();
  });

  it('6.7c — НЕ логувати для non-FRONTLINE заявок', async () => {
    const request = createRequest({ requiredClearance: ClearanceLevel.LOCAL, creatorId: 'other-id' });
    const viewer = createUser({ id: 'viewer-id' });

    await (service as any).logAccess(request, viewer, 'view_detail');

    expect(accessLogRepo.save).not.toHaveBeenCalled();
  });
});