import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { Organization } from './organization.entity';
import { User } from '@modules/users/entities/user.entity';

/**
 * Склад / Транзитна точка (Hub).
 *
 * Може належати організації або конкретному волонтеру.
 * Геолокація зберігається у форматі PostGIS Point (SRID 4326 = WGS 84).
 * Використовується для побудови ланцюгів постачання.
 */
@Entity('hubs')
export class Hub extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'address', type: 'varchar', length: 500, nullable: true })
  address: string;

  @Column({ name: 'media_url', type: 'varchar', length: 1000, nullable: true })
  mediaUrl: string;

  /**
   * Геопросторова точка PostGIS.
   * Тип geography дозволяє розраховувати відстані в метрах без проекцій.
   *
   * Формат: { type: 'Point', coordinates: [longitude, latitude] }
   */
  @Index({ spatial: true })
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  location: string; // GeoJSON Point WKT

  /** Широта (для зручного читання без PostGIS) */
  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitude: number;

  /** Довгота */
  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitude: number;

  @ManyToOne(() => Organization, (org) => org.hubs, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'owner_user_id' })
  ownerUser: User;

  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId: string;

  /** Чи відкритий для інших організацій (публічний транзитний хаб) */
  @Column({ name: 'is_public', type: 'boolean', default: false })
  isPublic: boolean;
}
