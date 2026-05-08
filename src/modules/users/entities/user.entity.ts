import {
  Entity,
  Column,
  OneToMany,
  Index,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import * as argon2 from 'argon2';
import { BaseEntity } from '@common/entities/base.entity';
import { SystemRole, ClearanceLevel } from '@common/enums';
import { Vehicle } from '@modules/users/entities/vehicle.entity';
import { TrustVouch } from '@modules/users/entities/trust-vouch.entity';
import { OrganizationMember } from '@modules/organizations/entities/organization-member.entity';
import { TaskAssignment } from '@modules/tasks/entities/task-assignment.entity';

@Entity('users')
@Index(['email'], { unique: true })
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  @Exclude()
  passwordHash: string;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  fullName: string;

  @Column({ name: 'phone_number', type: 'varchar', length: 50, nullable: true })
  phoneNumber: string;

  @Column({
    name: 'system_role',
    type: 'enum',
    enum: SystemRole,
    default: SystemRole.VOLUNTEER,
  })
  systemRole: SystemRole;

  @Column({
    name: 'clearance_level',
    type: 'enum',
    enum: ClearanceLevel,
    default: ClearanceLevel.LOCAL,
  })
  clearanceLevel: ClearanceLevel;

  @Column({
    name: 'trust_score',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0.0,
  })
  trustScore: number;

  @Column({
    name: 'telegram_chat_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  telegramChatId: string;

  @Column({
    name: 'refresh_token_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  @Exclude()
  refreshTokenHash: string;

  @Column({ name: 'is_blocked', type: 'boolean', default: false })
  isBlocked: boolean;

  @Column({ name: 'avatar_url', type: 'varchar', length: 1000, nullable: true })
  avatarUrl: string;

  // ─── Email-верифікація (FR-01 доробка) ──────────────────────────────────

  /**
   * Підтверджена чи ні пошта.
   * false за замовчуванням. true встановлюється після переходу за посиланням
   * із листа верифікації.
   */
  @Column({ name: 'is_email_verified', type: 'boolean', default: false })
  isEmailVerified: boolean;

  /**
   * Тимчасовий токен для підтвердження пошти (UUID v4).
   * Обнуляється після успішної верифікації.
   */
  @Column({
    name: 'email_verification_token',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  @Exclude()
  emailVerificationToken: string | null;

  @Column({
    name: 'password_reset_token',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  @Exclude()
  passwordResetToken: string | null;

  @Column({
    name: 'password_reset_expires',
    type: 'timestamp',
    nullable: true,
  })
  @Exclude()
  passwordResetExpires: Date | null;

  // ─── Зв'язки ────────────────────────────────────────────────────────────────

  @OneToMany(() => Vehicle, (vehicle) => vehicle.user, { cascade: true })
  vehicles: Vehicle[];

  @OneToMany(() => TrustVouch, (vouch) => vouch.voucher)
  givenVouches: TrustVouch[];

  @OneToMany(() => TrustVouch, (vouch) => vouch.vouchee)
  receivedVouches: TrustVouch[];

  @OneToMany(() => OrganizationMember, (member) => member.user)
  organizationMemberships: OrganizationMember[];

  @OneToMany(() => TaskAssignment, (assignment) => assignment.user)
  taskAssignments: TaskAssignment[];


  // ─── Методи ─────────────────────────────────────────────────────────────────

  @BeforeInsert()
  @BeforeUpdate()
  async hashPassword() {
    if (this.passwordHash && !this.passwordHash.startsWith('$argon2')) {
      this.passwordHash = await argon2.hash(this.passwordHash);
    }
  }

  async verifyPassword(plainPassword: string): Promise<boolean> {
    return argon2.verify(this.passwordHash, plainPassword);
  }

  get vouchCount(): number {
    return this.receivedVouches?.length ?? 0;
  }
}
