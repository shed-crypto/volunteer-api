import {
  Entity,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { TaskStatus } from '@common/enums';
import { Request } from '@modules/requests/entities/request.entity';
import { TaskAssignment } from './task-assignment.entity';
import { TaskDelegation } from './task-delegation.entity';
import { Chat } from '@modules/chat/entities/chat.entity';

/**
 * Підзадача (Task / Kanban-картка).
 *
 * Реалізує FR-05 (структура Epic/Task), FR-06 (multi-assignment),
 * FR-07 (специфічні ролі) та FR-09 (Kanban-дошка).
 *
 * При переведенні у статус IN_PROGRESS автоматично створюється чат
 * між автором заявки та виконавцями (FR-10).
 */
@Entity('tasks')
@Index(['status'])
@Index(['requestId'])
export class Task extends BaseEntity {
  @ManyToOne(() => Request, (request) => request.tasks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request: Request;

  @Column({ name: 'request_id', type: 'uuid' })
  requestId: string;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: TaskStatus,
    default: TaskStatus.TODO,
  })
  status: TaskStatus;

  /**
   * FR-06: скільки людей потрібно для виконання цієї підзадачі.
   * Відображається як лічильник "Зібрано 2/5 людей".
   */
  @Column({ name: 'needed_people_count', type: 'int', default: 1 })
  neededPeopleCount: number;

  /**
   * FR-07: вимоги до виконавця у вільній формі.
   * Наприклад: ["Водій", "Вантажний автомобіль", "Медичний допуск"]
   */
  @Column({ type: 'simple-array', nullable: true, default: '' })
  requiredRoles: string[];

  /** Пріоритет підзадачі (0 = найнижчий) */
  @Column({ name: 'priority', type: 'int', default: 0 })
  priority: number;

  /** Дедлайн підзадачі */
  @Column({ name: 'deadline', type: 'timestamptz', nullable: true })
  deadline: Date;

  /** Автоматично створений чат при IN_PROGRESS (FR-10) */
  @ManyToOne(() => Chat, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'chat_id' })
  chat: Chat;

  @Column({ name: 'chat_id', type: 'uuid', nullable: true })
  chatId: string;

  @OneToMany(() => TaskAssignment, (assignment) => assignment.task, {
    cascade: true,
  })
  assignments: TaskAssignment[];

  @OneToMany(() => TaskDelegation, (delegation) => delegation.task, {
    cascade: true,
  })
  delegations: TaskDelegation[];

  /** Розрахункове поле: кількість активних призначень */
  get assignedCount(): number {
    return (
      this.assignments?.filter(
        (a) => a.status !== 'withdrawn' && a.status !== 'completed',
      ).length ?? 0
    );
  }

  /** Чи заповнені всі слоти */
  get isFull(): boolean {
    return this.assignedCount >= this.neededPeopleCount;
  }
}
