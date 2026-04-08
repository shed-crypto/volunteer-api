import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { Task } from './task.entity';
import { Organization } from '@modules/organizations/entities/organization.entity';
import { User } from '@modules/users/entities/user.entity';

/**
 * Делегування підзадачі іншій організації (FR-04 — B2B routing).
 *
 * Координатор може передати підзадачу іншій волонтерській групі.
 * Організація-отримувач бачить задачу у своїй Kanban-дошці.
 */
@Entity('task_delegations')
export class TaskDelegation extends BaseEntity {
  @ManyToOne(() => Task, (task) => task.delegations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  /** Організація, якій делегована підзадача */
  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** Хто делегував (координатор) */
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'delegated_by_user_id' })
  delegatedBy: User;

  @Column({ name: 'delegated_by_user_id', type: 'uuid', nullable: true })
  delegatedByUserId: string;

  @Column({ name: 'delegated_at', type: 'timestamptz', default: () => 'NOW()' })
  delegatedAt: Date;

  /** Статус прийняття (null = очікує, true = прийнято, false = відхилено) */
  @Column({ name: 'is_accepted', type: 'boolean', nullable: true })
  isAccepted: boolean;

  @Column({ type: 'text', nullable: true })
  message: string;
}
