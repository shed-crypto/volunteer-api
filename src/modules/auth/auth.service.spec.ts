import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { User } from '@modules/users/entities/user.entity';
import { EmailService } from '@modules/email/email.service';
import { SystemRole, ClearanceLevel } from '@common/enums';
import {
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

// ─── Mock factories ──────────────────────────────────────────────────────────

const mockUserRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
});

const mockJwtService = () => ({
  signAsync: jest.fn(),
  verifyAsync: jest.fn(),
});

const mockEmailService = () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetCode: jest.fn().mockResolvedValue(undefined),
});

// ─── Test helpers ────────────────────────────────────────────────────────────

const createUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: 'test@volunteer.org',
  fullName: 'Test User',
  passwordHash: 'hashed_password',
  systemRole: SystemRole.VOLUNTEER,
  clearanceLevel: ClearanceLevel.LOCAL,
  isBlocked: false,
  isEmailVerified: false,
  emailVerificationToken: null,
  passwordResetCode: null,
  passwordResetExpires: null,
  passwordResetToken: null,
  refreshTokenHash: null,
  phoneNumber: null,
  avatarUrl: null,
  trustScore: 0,
  trustLevel: 0,
  location: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  verifyPassword: jest.fn(),
  vouchers: Promise.resolve([]),
  vouchees: Promise.resolve([]),
  vehicles: Promise.resolve([]),
  assignments: Promise.resolve([]),
  ...overrides,
} as User);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: jest.Mocked<Repository<User>>;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useFactory: mockUserRepo },
        { provide: JwtService, useFactory: mockJwtService },
        { provide: EmailService, useFactory: mockEmailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepo = module.get(getRepositoryToken(User));
    jwtService = module.get(JwtService);
  });

  // ─── register ────────────────────────────────────────────────────────────

  describe('register', () => {
    it('should register a new user and return tokens', async () => {
      const dto = {
        email: 'new@volunteer.org',
        password: 'StrongPass123!',
        fullName: 'New User',
        phoneNumber: '+380991234567',
        systemRole: SystemRole.VOLUNTEER,
      };

      const savedUser = createUser({
        id: 'new-user-id',
        email: dto.email,
        fullName: dto.fullName,
        phoneNumber: dto.phoneNumber,
        systemRole: dto.systemRole,
        isEmailVerified: false,
      });

      userRepo.findOne.mockResolvedValue(null); // no existing user
      userRepo.create.mockReturnValue(savedUser);
      userRepo.save.mockResolvedValue(savedUser);
      (jwtService.signAsync as jest.Mock).mockResolvedValueOnce('access-token');
      (jwtService.signAsync as jest.Mock).mockResolvedValueOnce('refresh-token');

      const result = await service.register(dto as any);

      expect(result).toHaveProperty('accessToken', 'access-token');
      expect(result).toHaveProperty('refreshToken', 'refresh-token');
      expect(result.user).toMatchObject({
        id: 'new-user-id',
        email: dto.email,
        fullName: dto.fullName,
      });
      // verify email was triggered (async via setImmediate, won't resolve in test)
      expect(userRepo.save).toHaveBeenCalled();
    });

    it('should throw ConflictException if email already exists', async () => {
      userRepo.findOne.mockResolvedValue(createUser({ email: 'existing@volunteer.org' }));

      await expect(
        service.register({
          email: 'existing@volunteer.org',
          password: 'Pass123!',
          fullName: 'Existing',
          phoneNumber: '',
          systemRole: SystemRole.VOLUNTEER,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── login ───────────────────────────────────────────────────────────────

  describe('login', () => {
    it('should login with valid credentials', async () => {
      const user = createUser({
        isEmailVerified: true,
        verifyPassword: jest.fn().mockResolvedValue(true) as any,
      });

      userRepo.findOne.mockResolvedValue(user);
      (jwtService.signAsync as jest.Mock).mockResolvedValueOnce('access');
      (jwtService.signAsync as jest.Mock).mockResolvedValueOnce('refresh');

      const result = await service.login({
        email: 'test@volunteer.org',
        password: 'StrongPass123!',
      });

      expect(result.accessToken).toBe('access');
      expect(result.refreshToken).toBe('refresh');
      expect(result.emailVerified).toBe(true);
    });

    it('should throw UnauthorizedException for wrong email', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nonexistent@volunteer.org', password: 'x' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw ForbiddenException when user is blocked', async () => {
      const blocked = createUser({ isBlocked: true });
      userRepo.findOne.mockResolvedValue(blocked);

      await expect(
        service.login({ email: 'blocked@volunteer.org', password: 'x' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      const user = createUser({
        verifyPassword: jest.fn().mockResolvedValue(false) as any,
      });
      userRepo.findOne.mockResolvedValue(user);

      await expect(
        service.login({ email: 'test@volunteer.org', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── email verification ─────────────────────────────────────────────────

  describe('verifyEmail', () => {
    it('should verify email successfully', async () => {
      const user = createUser({ emailVerificationToken: 'valid-token' });
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.verifyEmail('valid-token');

      expect(result).toEqual({
        message: expect.stringContaining('успішно'),
      });
      expect(userRepo.update).toHaveBeenCalledWith(user.id, {
        isEmailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      });
    });

    it('should throw BadRequestException for invalid token', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.verifyEmail('invalid-token')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── refresh tokens ──────────────────────────────────────────────────────

  describe('refreshTokens', () => {
    it('should issue new tokens on valid refresh', async () => {
      const user = createUser({
        refreshTokenHash: 'stored_hash',
        isEmailVerified: true,
      });
      userRepo.findOne.mockResolvedValue(user);

      // Mock argon2.verify to return true
      jest.spyOn(argon2, 'verify').mockResolvedValueOnce(true);

      (jwtService.signAsync as jest.Mock).mockResolvedValueOnce('new-access');
      (jwtService.signAsync as jest.Mock).mockResolvedValueOnce('new-refresh');

      const result = await service.refreshTokens('user-1', 'old-refresh');

      expect(result.accessToken).toBe('new-access');
      expect(result.refreshToken).toBe('new-refresh');
    });

    it('should throw UnauthorizedException if no refresh hash stored', async () => {
      userRepo.findOne.mockResolvedValue(createUser({ refreshTokenHash: null }));

      await expect(
        service.refreshTokens('user-1', 'some-token'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if refresh token is invalid', async () => {
      const user = createUser({ refreshTokenHash: 'stored_hash' });
      userRepo.findOne.mockResolvedValue(user);
      jest.spyOn(argon2, 'verify').mockResolvedValueOnce(false);

      await expect(
        service.refreshTokens('user-1', 'wrong-token'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── logout ──────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('should clear refreshTokenHash', async () => {
      await service.logout('user-1');

      expect(userRepo.update).toHaveBeenCalledWith('user-1', {
        refreshTokenHash: null,
      });
    });
  });

  // ─── password reset flow ─────────────────────────────────────────────────

  describe('requestPasswordReset', () => {
    it('should generate code and return exists=true', async () => {
      const user = createUser();
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.requestPasswordReset('test@volunteer.org');

      expect(result.exists).toBe(true);
      expect(userRepo.update).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({
          passwordResetCode: expect.any(String),
          passwordResetExpires: expect.any(Date),
        }),
      );
    });

    it('should return exists=false for unknown email', async () => {
      userRepo.findOne.mockResolvedValue(null);

      const result = await service.requestPasswordReset('unknown@volunteer.org');

      expect(result.exists).toBe(false);
      expect(userRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('verifyResetCode', () => {
    it('should accept valid code and return reset token', async () => {
      const future = new Date(Date.now() + 10 * 60 * 1000);
      const user = createUser({
        passwordResetCode: '123456',
        passwordResetExpires: future,
      });
      userRepo.findOne.mockResolvedValue(user);
      userRepo.update.mockResolvedValue({} as any);

      const result = await service.verifyResetCode('test@volunteer.org', '123456');

      expect(result).toHaveProperty('token');
      expect(typeof result.token).toBe('string');
    });

    it('should throw BadRequest if code expired', async () => {
      const past = new Date(Date.now() - 1000);
      const user = createUser({
        passwordResetCode: '123456',
        passwordResetExpires: past,
      });
      userRepo.findOne.mockResolvedValue(user);

      await expect(
        service.verifyResetCode('test@volunteer.org', '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequest for wrong code', async () => {
      const future = new Date(Date.now() + 10 * 60 * 1000);
      const user = createUser({
        passwordResetCode: '111111',
        passwordResetExpires: future,
      });
      userRepo.findOne.mockResolvedValue(user);

      await expect(
        service.verifyResetCode('test@volunteer.org', '999999'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('changePassword', () => {
    it('should change password when old password is correct', async () => {
      const user = createUser({
        verifyPassword: jest.fn().mockResolvedValue(true) as any,
      });
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.changePassword('user-1', {
        oldPassword: 'OldPass123!',
        newPassword: 'NewPass456!',
      });

      expect(result).toEqual({
        message: expect.stringContaining('змінено'),
      });
      expect(userRepo.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ passwordHash: expect.any(String) }),
      );
    });

    it('should throw UnauthorizedException if old password is wrong', async () => {
      const user = createUser({
        verifyPassword: jest.fn().mockResolvedValue(false) as any,
      });
      userRepo.findOne.mockResolvedValue(user);

      await expect(
        service.changePassword('user-1', {
          oldPassword: 'WrongPass',
          newPassword: 'NewPass456!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});