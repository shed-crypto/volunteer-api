import {
  Entity,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { OrganizationMember } from './organization-member.entity';
import { Hub } from './hub.entity';

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

  /** Чи публічна організація (видима в пошуку) */
  @Column({ name: 'is_public', type: 'boolean', default: true })
  isPublic: boolean;
}
