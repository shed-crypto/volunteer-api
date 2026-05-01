import { Entity, Column, OneToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { Organization } from './organization.entity';
import { OrgRole } from '@common/enums';

@Entity('organization_settings')
export class OrganizationSettings extends BaseEntity {
  @OneToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'allow_public_join', type: 'boolean', default: false })
  allowPublicJoin: boolean;

  @Column({ name: 'require_join_approval', type: 'boolean', default: true })
  requireJoinApproval: boolean;

  @Column({ name: 'member_invite_allowed', type: 'boolean', default: true })
  memberInviteAllowed: boolean;

  @Column({ name: 'subgroup_creation_allowed', type: 'boolean', default: true })
  subgroupCreationAllowed: boolean;

  @Column({ name: 'media_upload_allowed', type: 'boolean', default: true })
  mediaUploadAllowed: boolean;

  @Column({ name: 'allowed_member_roles', type: 'enum', enum: OrgRole, array: true, default: [OrgRole.MEMBER, OrgRole.COORDINATOR, OrgRole.LEADER] })
  allowedMemberRoles: OrgRole[];
}