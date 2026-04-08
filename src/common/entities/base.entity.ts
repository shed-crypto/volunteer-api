import {
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * Базова сутність. Всі entity успадковують від неї.
 *
 * Включає:
 * - UUID первинний ключ (генерується автоматично)
 * - Мітки часу: createdAt, updatedAt
 * - Soft-delete: deletedAt (запис не видаляється фізично, лише позначається)
 *
 * Soft-delete дозволяє відновлювати видалені записи та зберігати аудит-лог.
 */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt: Date;
}
