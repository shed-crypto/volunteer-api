import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { AssignmentStatus } from '@common/enums';
import { Task } from './task.entity';
import { User } from '@modules/users/entities/user.entity';

/**
 * Призначення волонтера на підзадачу (M2M з атрибутами).
 * Реалізує FR-06 (кілька волонтерів на одну задачу) та FR-07 (специфічні ролі).
 *
 * Унікальне обмеження: один волонтер — одне призначення на конкретну задачу.
 */
@Entity('task_assignments')
@Unique(['taskId', 'userId'])
export class TaskAssignment extends BaseEntity {
  @ManyToOne(() => Task, (task) => task.assignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @ManyToOne(() => User, (user) => user.taskAssignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /**
   * FR-07: яку конкретну роль виконує ця людина в задачі.
   * Наприклад: "Водій", "Медик", "Вантажник", "Перекладач".
   */
  @Column({ name: 'fulfilled_role', type: 'varchar', length: 100, nullable: true })
  fulfilledRole: string;

  @Column({
    type: 'enum',
    enum: AssignmentStatus,
    default: AssignmentStatus.ASSIGNED,
  })
  status: AssignmentStatus;

  @Column({ name: 'assigned_at', type: 'timestamptz', default: () => 'NOW()' })
  assignedAt: Date;

  /** Час завершення (заповнюється при статусі COMPLETED) */
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date;

  /** Нотатки волонтера до свого призначення */
  @Column({ name: 'volunteer_notes', type: 'text', nullable: true })
  volunteerNotes: string;
}
