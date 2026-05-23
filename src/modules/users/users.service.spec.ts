import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { TrustVouch } from './entities/trust-vouch.entity';
import { Vehicle } from './entities/vehicle.entity';
import { SystemRole, ClearanceLevel } from '@common/enums';
import { ForbiddenException, ConflictException } from '@nestjs/common';

describe('UsersService — vouchForUser (6.5)', () => {
  let service: UsersService;
  let userRepo: jest.Mocked<Repository<User>>;

  const mockUserRepo = () => ({
    findOne: jest.fn(),
    update: jest.fn(),
    save: jest.fn(),
  });

  const mockVouchRepo = () => ({
    findOne: jest.fn(),
    count: jest.fn(),
    save: jest.fn().mockImplementation((v) => Promise.resolve({ id: 'v1', ...v })),
    update: jest.fn(),
  });

  const mockVehicleRepo = () => ({});

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useFactory: mockUserRepo },
        { provide: getRepositoryToken(TrustVouch), useFactory: mockVouchRepo },
        { provide: getRepositoryToken(Vehicle), useFactory: mockVehicleRepo },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    userRepo = module.get(getRepositoryToken(User));
  });

  const createVoucher = (overrides: Partial<User> = {}): User => ({
    id: 'voucher-id',
    email: 'voucher@test.com',
    fullName: 'Test Voucher',
    passwordHash: 'hash',
    systemRole: SystemRole.VOLUNTEER,
    clearanceLevel: ClearanceLevel.FRONTLINE,
    trustScore: 0,
    isBlocked: false,
    isEmailVerified: true,
    isIdentityVerified: true,
    phoneNumber: '+380501234567',
    avatarUrl: 'https://example.com/avatar.jpg',
    refreshTokenHash: null,
    emailVerificationToken: null,
    passwordResetCode: null,
    passwordResetToken: null,
    passwordResetExpires: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    // relations
    vehicles: [],
    givenVouches: [],
    receivedVouches: [],
    organizationMemberships: [],
    taskAssignments: [],
    ...overrides,
  } as User);

  const createVouchee = (): User => ({
    id: 'vouchee-id',
    email: 'vouchee@test.com',
    fullName: 'Test Vouchee',
    passwordHash: 'hash',
    systemRole: SystemRole.VOLUNTEER,
    clearanceLevel: ClearanceLevel.LOCAL,
    trustScore: 0,
    isBlocked: false,
    isEmailVerified: false,
    isIdentityVerified: false,
    phoneNumber: null,
    avatarUrl: null,
    refreshTokenHash: null,
    emailVerificationToken: null,
    passwordResetCode: null,
    passwordResetToken: null,
    passwordResetExpires: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    // relations
    vehicles: [],
    givenVouches: [],
    receivedVouches: [],
    organizationMemberships: [],
    taskAssignments: [],
  } as User);

  it('6.5a — дозволити поручитися верифікованому користувачу (email+phone+avatar+identity)', async () => {
    const voucher = createVoucher();
    const vouchee = createVouchee();

    (userRepo.findOne as jest.Mock).mockResolvedValueOnce(vouchee);
    (userRepo.findOne as jest.Mock).mockResolvedValueOnce(vouchee); // для recalculateClearance

    const result = await service.vouchForUser('vouchee-id', voucher);
    expect(result).toBeDefined();
    expect(result.voucheeId).toBe('vouchee-id');
    expect(result.voucherId).toBe('voucher-id');
  });

  it('6.5b — відхилити якщо email не підтверджений', async () => {
    const voucher = createVoucher({ isEmailVerified: false });
    const vouchee = createVouchee();

    (userRepo.findOne as jest.Mock).mockResolvedValueOnce(vouchee);

    await expect(service.vouchForUser('vouchee-id', voucher)).rejects.toThrow(
      ForbiddenException,
    );
  });

  // NOTE(alex): phoneNumber тимчасово не перевіряється — немає SMS-сервісу.
  // 6.5c — видалено (перевірка телефону). Повернути коли SMS готовий.
  // it('6.5c — відхилити якщо немає телефону', async () => {
  //   const voucher = createVoucher({ phoneNumber: '' });
  //   const vouchee = createVouchee();
  //   (userRepo.findOne as jest.Mock).mockResolvedValueOnce(vouchee);
  //   await expect(service.vouchForUser('vouchee-id', voucher)).rejects.toThrow(
  //     ForbiddenException,
  //   );
  // });

  it('6.5c — дозволити поручитися навіть без телефону (тимчасово)', async () => {
    const voucher = createVoucher({ phoneNumber: '', isPhoneVerified: false });
    const vouchee = createVouchee();

    (userRepo.findOne as jest.Mock).mockResolvedValueOnce(vouchee);
    (userRepo.findOne as jest.Mock).mockResolvedValueOnce(vouchee);

    const result = await service.vouchForUser('vouchee-id', voucher);
    expect(result).toBeDefined();
  });

  it('6.5d — відхилити якщо немає аватарки', async () => {
    const voucher = createVoucher({ avatarUrl: null });
    const vouchee = createVouchee();

    (userRepo.findOne as jest.Mock).mockResolvedValueOnce(vouchee);

    await expect(service.vouchForUser('vouchee-id', voucher)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('6.5e — відхилити якщо isIdentityVerified = false', async () => {
    const voucher = createVoucher({ isIdentityVerified: false });
    const vouchee = createVouchee();

    (userRepo.findOne as jest.Mock).mockResolvedValueOnce(vouchee);

    await expect(service.vouchForUser('vouchee-id', voucher)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('6.5f — відхилити забороненого користувача', async () => {
    const voucher = createVoucher({ isBlocked: true });
    const vouchee = createVouchee();

    (userRepo.findOne as jest.Mock).mockResolvedValueOnce(vouchee);

    await expect(service.vouchForUser('vouchee-id', voucher)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

// =====================================================================
// Етап 3 — 10 тестів для адмін-методів UsersService
// =====================================================================

describe('UsersService — admin methods', () => {
  let service: UsersService;
  let mockUserRepo: any;
  let mockVouchRepo: any;
  let mockVehicleRepo: any;

  const createAdmin = (): User =>
    ({
      id: 'admin-id',
      email: 'admin@test.com',
      fullName: 'Admin',
      passwordHash: 'hash',
      systemRole: SystemRole.ADMIN,
      clearanceLevel: ClearanceLevel.FRONTLINE,
      trustScore: 100,
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
    } as User);

  const createNonAdmin = (): User =>
    ({
      ...createAdmin(),
      id: 'user-id',
      systemRole: SystemRole.VOLUNTEER,
    } as User);

  const createTargetUser = (): User =>
    ({
      ...createAdmin(),
      id: 'target-id',
    } as User);

  beforeEach(async () => {
    mockUserRepo = {
      findOne: jest.fn().mockResolvedValue(createTargetUser()),
      update: jest.fn().mockResolvedValue({}),
      save: jest.fn(),
      manager: { find: jest.fn().mockResolvedValue([]) },
    };

    mockVouchRepo = {
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockResolvedValue([]),
    };

    mockVehicleRepo = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(TrustVouch), useValue: mockVouchRepo },
        { provide: getRepositoryToken(Vehicle), useValue: mockVehicleRepo },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  // ------------------------------------------------------
  // 3.1 — blockUser: адмін блокує користувача
  // ------------------------------------------------------
  it('3.1 — blockUser: адмін блокує користувача та призупиняє vouches', async () => {
    await service.blockUser('target-id', createAdmin() as User);

    expect(mockUserRepo.update).toHaveBeenCalledWith('target-id', {
      isBlocked: true,
    });
    expect(mockVouchRepo.update).toHaveBeenCalledWith(
      { voucherId: 'target-id', isSuspended: false },
      {
        isSuspended: true,
        suspendedAt: expect.any(Date),
        suspensionReason: 'voucher banned by admin',
      },
    );
  });

  // ------------------------------------------------------
  // 3.2 — blockUser: не-адмін ВІДХИЛЯЄТЬСЯ
  // ------------------------------------------------------
  it('3.2 — blockUser: не-адмін не може заблокувати користувача', async () => {
    await expect(
      service.blockUser('target-id', createNonAdmin() as User),
    ).rejects.toThrow(ForbiddenException);
  });

  // ------------------------------------------------------
  // 3.3 — unblockUser: адмін розблоковує користувача
  // ------------------------------------------------------
  it('3.3 — unblockUser: адмін розблоковує користувача (не відновлює vouches)', async () => {
    await service.unblockUser('target-id', createAdmin() as User);

    expect(mockUserRepo.update).toHaveBeenCalledWith('target-id', {
      isBlocked: false,
    });
    // vouches НЕ відновлюються автоматично
  });

  // ------------------------------------------------------
  // 3.4 — unblockUser: не-адмін ВІДХИЛЯЄТЬСЯ
  // ------------------------------------------------------
  it('3.4 — unblockUser: не-адмін не може розблокувати користувача', async () => {
    await expect(
      service.unblockUser('target-id', createNonAdmin() as User),
    ).rejects.toThrow(ForbiddenException);
  });

  // ------------------------------------------------------
  // 3.5 — changeRole: адмін змінює роль
  // ------------------------------------------------------
  it('3.5 — changeRole: адмін підвищує Volunteer → Coordinator', async () => {
    mockUserRepo.findOne
      .mockResolvedValueOnce(createTargetUser()) // шукаємо target
      .mockResolvedValueOnce({ ...createTargetUser(), systemRole: SystemRole.COORDINATOR }); // findById

    const result = await service.changeRole('target-id', SystemRole.COORDINATOR, createAdmin() as User);

    expect(mockUserRepo.update).toHaveBeenCalledWith('target-id', {
      systemRole: SystemRole.COORDINATOR,
    });
    expect(result.systemRole).toBe(SystemRole.COORDINATOR);
  });

  // ------------------------------------------------------
  // 3.6 — changeRole: не-адмін ВІДХИЛЯЄТЬСЯ
  // ------------------------------------------------------
  it('3.6 — changeRole: не-адмін не може змінити роль', async () => {
    await expect(
      service.changeRole('target-id', SystemRole.COORDINATOR, createNonAdmin() as User),
    ).rejects.toThrow(ForbiddenException);
  });

  // ------------------------------------------------------
  // 3.7 — updateClearance: адмін змінює рівень допуску
  // ------------------------------------------------------
  it('3.7 — updateClearance: адмін встановлює FRONTLINE → frontlineGrantedByAdmin=true', async () => {
    mockUserRepo.findOne
      .mockResolvedValueOnce(createTargetUser())
      .mockResolvedValueOnce({ ...createTargetUser(), clearanceLevel: ClearanceLevel.FRONTLINE, frontlineGrantedByAdmin: true });

    const result = await service.updateClearance('target-id', ClearanceLevel.FRONTLINE, createAdmin() as User);

    expect(mockUserRepo.update).toHaveBeenCalledWith('target-id', {
      clearanceLevel: ClearanceLevel.FRONTLINE,
      frontlineGrantedByAdmin: true,
    });
    expect(result.clearanceLevel).toBe(ClearanceLevel.FRONTLINE);
  });

  // ------------------------------------------------------
  // 3.8 — updateClearance: не-адмін ВІДХИЛЯЄТЬСЯ
  // ------------------------------------------------------
  it('3.8 — updateClearance: не-адмін не може змінити рівень допуску', async () => {
    await expect(
      service.updateClearance('target-id', ClearanceLevel.FRONTLINE, createNonAdmin() as User),
    ).rejects.toThrow(ForbiddenException);
  });

  // ------------------------------------------------------
  // 3.9 — recalculateClearance: без vouches → LOCAL
  // ------------------------------------------------------
  it('3.9 — recalculateClearance: 0 поручителів → залишає LOCAL', async () => {
    mockVouchRepo.count.mockResolvedValue(0);
    mockUserRepo.findOne.mockResolvedValue({
      ...createTargetUser(),
      clearanceLevel: ClearanceLevel.INTERNATIONAL,
      trustScore: 10,
      frontlineGrantedByAdmin: false,
    });

    await service.recalculateClearance('target-id');

    expect(mockUserRepo.update).toHaveBeenCalledWith('target-id', {
      clearanceLevel: ClearanceLevel.LOCAL,
      trustScore: 10, // trustScore не змінюється без підвищення
    });
  });

  // ------------------------------------------------------
  // 3.10 — recalculateClearance: 3+ vouches → INTERNATIONAL
  // ------------------------------------------------------
  it('3.10 — recalculateClearance: 3 поручителя → підвищує до INTERNATIONAL +5 trust', async () => {
    mockVouchRepo.count.mockResolvedValue(3);
    mockUserRepo.findOne.mockResolvedValue({
      ...createTargetUser(),
      clearanceLevel: ClearanceLevel.LOCAL,
      trustScore: 5,
      frontlineGrantedByAdmin: false,
    });

    await service.recalculateClearance('target-id');

    expect(mockUserRepo.update).toHaveBeenCalledWith('target-id', {
      clearanceLevel: ClearanceLevel.INTERNATIONAL,
      trustScore: 10, // 5 + 5
    });
  });
});

// =====================================================================
// Етап 4 — Тести на CRUD, профіль та статистику
// =====================================================================

describe('UsersService — CRUD та профіль', () => {
  let service: UsersService;
  let mockUserRepo: any;
  let mockVouchRepo: any;
  let mockVehicleRepo: any;

  beforeEach(async () => {
    mockUserRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'u1', fullName: 'Alice', systemRole: SystemRole.VOLUNTEER, clearanceLevel: ClearanceLevel.LOCAL, trustScore: 0 },
      ]),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    };

    mockVouchRepo = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };

    mockVehicleRepo = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(TrustVouch), useValue: mockVouchRepo },
        { provide: getRepositoryToken(Vehicle), useValue: mockVehicleRepo },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('4.1 — findAll: повертає список користувачів', async () => {
    const result = await service.findAll();
    expect(result).toHaveLength(1);
    expect(result[0].fullName).toBe('Alice');
  });

  it('4.2 — findAllForAdmin: повертає юзерів з vouchCount', async () => {
    mockUserRepo.find.mockResolvedValue([
      { id: 'u1', fullName: 'Alice' },
      { id: 'u2', fullName: 'Bob' },
    ]);
    mockVouchRepo.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);

    const result = await service.findAllForAdmin();
    expect(result).toHaveLength(2);
    expect(result[0].vouchCount).toBe(5);
    expect(result[1].vouchCount).toBe(2);
  });

  it('4.3 — updateProfile: власник редагує власний профіль', async () => {
    const currentUser = { id: 'u1', systemRole: SystemRole.VOLUNTEER } as User;
    mockUserRepo.findOne.mockResolvedValue({ id: 'u1', fullName: 'Updated' } as User);

    const result = await service.updateProfile('u1', { fullName: 'Updated' }, currentUser);
    expect(mockUserRepo.update).toHaveBeenCalledWith('u1', expect.objectContaining({ fullName: 'Updated' }));
  });

  it('4.4 — updateProfile: не-власник ВІДХИЛЯЄТЬСЯ', async () => {
    const currentUser = { id: 'u2', systemRole: SystemRole.VOLUNTEER } as User;
    await expect(service.updateProfile('u1', { fullName: 'Hacked' }, currentUser)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('4.5 — findById: репозиторій отримує юзера з реляціями', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: 'u1',
      fullName: 'Alice',
    } as User);

    const result = await service.findById('u1');
    expect(result).toBeDefined();
    expect(mockUserRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' } }));
  });
});
