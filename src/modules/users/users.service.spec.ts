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