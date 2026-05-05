import {
  Entity,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import {
  RequestCategory,
  RequestUrgency,
  RequestStatus,
  ClearanceLevel,
} from '@common/enums';
import { User } from '@modules/users/entities/user.entity';
import { Task } from '@modules/tasks/entities/task.entity';

/**
 * Заявка (Request / Epic) — головна бізнес-сутність системи.
 *
 * Може містити підзадачі (Task) і мати складний lifecycle статусів.
 * Реалізує FR-05 (структура Epic/Task) та FR-08 (приховування координат).
 *
 * Геолокація зберігається у PostGIS. Для неверифікованих користувачів
 * на рівні сервісу підмінюється на обфускований радіус.
 */
@Entity('requests')
@Index(['status'])
@Index(['urgency'])
@Index(['category'])
export class Request extends BaseEntity {
  /** Хто створив заявку */
  @ManyToOne(() => User, { eager: false, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'creator_id' })
  creator: User;

  @Column({ name: 'creator_id', type: 'uuid', nullable: true })
  creatorId: string;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: RequestCategory,
    default: RequestCategory.OTHER,
  })
  category: RequestCategory;

  @Column({
    type: 'enum',
    enum: RequestUrgency,
    default: RequestUrgency.MEDIUM,
  })
  urgency: RequestUrgency;

  @Column({
    type: 'enum',
    enum: RequestStatus,
    default: RequestStatus.OPEN,
  })
  status: RequestStatus;

  /**
   * Мінімальний рівень допуску для перегляду та взяття цієї заявки.
   * За замовчуванням — LOCAL (доступна всім верифікованим волонтерам).
   * Для "Червоних зон" — FRONTLINE.
   */
  @Column({
    name: 'required_clearance',
    type: 'enum',
    enum: ClearanceLevel,
    default: ClearanceLevel.LOCAL,
  })
  requiredClearance: ClearanceLevel;

  /**
   * Точні GPS-координати (PostGIS Point).
   * НІКОЛИ не передаються на клієнт напряму, якщо is_location_hidden = true.
   * Сервіс замість цього повертає обфусковану точку + радіус.
   */
  @Index({ spatial: true })
  @Column({
    name: 'exact_location',
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  exactLocation: string;

  /** Широта (для зручного доступу без PostGIS ST_X/ST_Y) */
  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitude: number;

  /** Довгота */
  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitude: number;

  /**
   * FR-08: якщо true — точні координати приховані.
   * Буде відкрито лише після того, як верифікований волонтер візьме завдання.
   */
  @Column({ name: 'is_location_hidden', type: 'boolean', default: false })
  isLocationHidden: boolean;

  /** Дедлайн виконання (null = без обмежень) */
  @Column({ name: 'deadline', type: 'timestamptz', nullable: true })
  deadline: Date;

  /**
   * Автоматично призначені теги (наприклад, ["#Медикаменти", "#Термінова"]).
   * Заповнюються сервісом автоматичної категоризації через аналіз тексту.
   */
  @Column({ type: 'simple-array', nullable: true, default: '' })
  tags: string[];

  /** Посилання на збір коштів (Monobank jar, тощо) */
  @Column({
    name: 'fundraising_url',
    type: 'varchar',
    length: 1000,
    nullable: true,
  })
  fundraisingUrl: string;

  /** URL фотозвіту або акту прийому-передачі після закриття */
  @Column({ type: 'simple-array', nullable: true, default: '' })
  reportUrls: string[];

  /** Додаткова інформація, додана власником після створення (FR-09) */
  @Column({ name: 'additional_info', type: 'jsonb', nullable: true, default: [] })
  additionalInfo: Array<{ id: string; text: string; attachments: any[]; createdAt: Date; updatedAt?: Date }>;

  // Поля для офлайн-синхронізації (NFR-03)
  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date;

  @OneToMany(() => Task, (task) => task.request, { cascade: true })
  tasks: Task[];
}
