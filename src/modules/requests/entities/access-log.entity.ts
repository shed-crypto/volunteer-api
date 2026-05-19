import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { ClearanceLevel } from '@common/enums';
import { Request } from './request.entity';

export type AccessAction = 'view_detail' | 'view_list' | 'view_media' | 'download_media';

@Entity('access_logs')
@Index(['requestId', 'createdAt'])
export class AccessLog extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'request_id', type: 'uuid' })
  requestId: string;

  @Column({ type: 'varchar', length: 50 })
  action: AccessAction;

  @Column({ name: 'ip', type: 'varchar', length: 45, nullable: true })
  ip: string;

  @Column({ name: 'user_agent', type: 'varchar', length: 500, nullable: true })
  userAgent: string;

  @Column({
    name: 'clearance_at_access',
    type: 'enum',
    enum: ClearanceLevel,
    default: ClearanceLevel.LOCAL,
  })
  clearanceAtAccess: ClearanceLevel;

  @ManyToOne(() => Request, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request: Request;
}