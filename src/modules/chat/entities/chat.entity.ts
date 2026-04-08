import {
  Entity,
  Column,
  ManyToOne,
  OneToMany,
  ManyToMany,
  JoinColumn,
  JoinTable,
} from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { ChatType } from '@common/enums';
import { User } from '@modules/users/entities/user.entity';
import { Message } from './message.entity';

/**
 * Чат. Реалізує FR-10 (автоматичне створення чату при взятті задачі).
 *
 * Учасники чату — M2M з User.
 * Тип чату визначає, до якої сутності він прив'язаний.
 */
@Entity('chats')
export class Chat extends BaseEntity {
  @Column({
    type: 'enum',
    enum: ChatType,
    default: ChatType.TASK_CHAT,
  })
  type: ChatType;

  /** Пов'язана заявка (якщо це task_chat або org_chat) */
  @Column({ name: 'related_request_id', type: 'uuid', nullable: true })
  relatedRequestId: string;

  /** Пов'язана організація (якщо це org_chat) */
  @Column({ name: 'related_org_id', type: 'uuid', nullable: true })
  relatedOrgId: string;

  /** Учасники чату (M2M) */
  @ManyToMany(() => User, { eager: false })
  @JoinTable({
    name: 'chat_participants',
    joinColumn: { name: 'chat_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'user_id', referencedColumnName: 'id' },
  })
  participants: User[];

  @OneToMany(() => Message, (msg) => msg.chat, { cascade: true })
  messages: Message[];

  /** Назва чату (опціонально, для групових чатів) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string;
}
