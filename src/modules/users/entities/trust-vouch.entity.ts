import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
  Check,
} from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { User } from './user.entity';

/**
 * Система "Поручителів" (FR-02).
 *
 * Один верифікований волонтер підтверджує особу іншого.
 * Після досягнення порогового значення (FRONTLINE_VOUCHES_REQUIRED)
 * рівень допуску автоматично підвищується.
 *
 * Унікальне обмеження: одна людина може поручитися за іншу лише один раз.
 * Перевірка: не можна поручитися за самого себе.
 */
@Entity('trust_vouches')
@Unique(['voucheeId', 'voucherId'])
@Check('"vouchee_id" != "voucher_id"')
export class TrustVouch extends BaseEntity {
  /** За кого поручаються */
  @ManyToOne(() => User, (user) => user.receivedVouches, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vouchee_id' })
  vouchee: User;

  @Column({ name: 'vouchee_id', type: 'uuid' })
  voucheeId: string;

  /** Хто поручається (повинен мати clearance_level >= frontline) */
  @ManyToOne(() => User, (user) => user.givenVouches, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'voucher_id' })
  voucher: User;

  @Column({ name: 'voucher_id', type: 'uuid' })
  voucherId: string;

  /** Коментар-обґрунтування (необов'язковий) */
  @Column({ type: 'text', nullable: true })
  comment: string;
}
