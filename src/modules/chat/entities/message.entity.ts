import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { Chat } from './chat.entity';
import { User } from '@modules/users/entities/user.entity';

@Entity('messages')
@Index(['chatId', 'sentAt'])
export class Message extends BaseEntity {
  @ManyToOne(() => Chat, (chat) => chat.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chat_id' })
  chat: Chat;

  @Column({ name: 'chat_id', type: 'uuid' })
  chatId: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'sender_id' })
  sender: User;

  @Column({ name: 'sender_id', type: 'uuid', nullable: true })
  senderId: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'sent_at', type: 'timestamptz', default: () => 'NOW()' })
  sentAt: Date;

  /** Прочитано учасниками (зберігаємо список userId) */
  @Column({ name: 'read_by', type: 'text', array: true, nullable: true, default: '{}' })
  readBy: string[] = [];

  /** Тип повідомлення (текст / фото / системне) */
  @Column({ name: 'message_type', type: 'varchar', length: 50, default: 'text' })
  messageType: string;

  /** URL вкладення (фото звіту тощо) */
  @Column({ name: 'attachment_url', type: 'varchar', length: 1000, nullable: true })
  attachmentUrl: string;
}