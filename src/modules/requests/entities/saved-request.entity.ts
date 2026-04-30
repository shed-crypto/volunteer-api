import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index, BaseEntity, CreateDateColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Request } from './request.entity';

@Entity('saved_requests')
@Index(['userId', 'requestId'], { unique: true })
export class SavedRequest extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => Request, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request: Request;

  @Column({ name: 'request_id' })
  requestId: string;

  @CreateDateColumn({ name: 'saved_at', type: 'timestamptz' })
  savedAt: Date;
}