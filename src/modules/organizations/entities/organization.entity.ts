import {
  Entity,
  Column,
  ManyToOne,
  OneToMany,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { OrganizationMember } from './organization-member.entity';
import { Hub } from './hub.entity';
import { OrganizationSettings } from './organization-settings.entity';
import { OrganizationJoinRequest } from './organization-join-request.entity';

/**
 * Організація / Волонтерська група (FR-03).
 *
 * Підтримує нескінченну ієрархію підгруп через поле parent_org_id
 * (дерево суміжних вузлів — Adjacency List Pattern).
 *
 * Приклад ієрархії:
 * - "Правий Берег" (root)
 *   - "Медична бригада Правого Берега"
 *   - "Логістика Правого Берега"
 *     - "Склад #1"
 */
@Entity('organizations')
export class Organization extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'logo_url', type: 'varchar', length: 1000, nullable: true })
  logoUrl: string;

  @Column({ name: 'banner_url', type: 'varchar', length: 1000, nullable: true })
  bannerUrl: string;

  /** Зв'язок "батько — дочірня організація" */
  @ManyToOne(() => Organization, (org) => org.children, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'parent_org_id' })
  parent: Organization;

  @Column({ name: 'parent_org_id', type: 'uuid', nullable: true })
  parentOrgId: string;

  @OneToMany(() => Organization, (org) => org.parent)
  children: Organization[];

  @OneToMany(() => OrganizationMember, (member) => member.organization, {
    cascade: true,
  })
  members: OrganizationMember[];

  @OneToMany(() => Hub, (hub) => hub.organization)
  hubs: Hub[];

  @OneToOne(() => OrganizationSettings, (settings) => settings.organization, {
    cascade: true,
  })
  settings: OrganizationSettings;

  @OneToMany(() => OrganizationJoinRequest, (request) => request.organization)
  joinRequests: OrganizationJoinRequest[];

  /** Чи публічна організація (видима в пошуку) */
  @Column({ name: 'is_public', type: 'boolean', default: true })
  isPublic: boolean;
}
