import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { OrgRole } from '@common/enums';
import { Organization } from './organization.entity';
import { User } from '@modules/users/entities/user.entity';

/**
 * Зв'язок "Користувач — Організація" (M2M з атрибутами).
 *
 * Унікальне обмеження: один користувач може мати лише одну роль
 * в одній організації одночасно.
 */
@Entity('organization_members')
@Unique(['organizationId', 'userId'])
export class OrganizationMember extends BaseEntity {
  @ManyToOne(() => Organization, (org) => org.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => User, (user) => user.organizationMemberships, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    name: 'org_role',
    type: 'enum',
    enum: OrgRole,
    default: OrgRole.MEMBER,
  })
  orgRole: OrgRole;

  @Column({ name: 'joined_at', type: 'timestamptz', default: () => 'NOW()' })
  joinedAt: Date;

  /** Запрошення прийнято? (false = pending invitation) */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}
