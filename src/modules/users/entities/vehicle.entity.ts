import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { VehicleType, VehicleStatus } from '@common/enums';
import { User } from './user.entity';

@Entity('vehicles')
export class Vehicle extends BaseEntity {
  @ManyToOne(() => User, (user) => user.vehicles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    type: 'enum',
    enum: VehicleType,
  })
  type: VehicleType;

  /** Вантажопідйомність у кілограмах */
  @Column({ name: 'capacity_kg', type: 'int', nullable: true })
  capacityKg: number;

  /** Місткість у кількості пасажирів */
  @Column({ name: 'passenger_capacity', type: 'int', nullable: true })
  passengerCapacity: number;

  @Column({
    type: 'enum',
    enum: VehicleStatus,
    default: VehicleStatus.ACTIVE,
  })
  status: VehicleStatus;

  /** Державний номер (за бажанням) */
  @Column({ name: 'license_plate', type: 'varchar', length: 20, nullable: true })
  licensePlate: string;

  /** Нотатки (наприклад, "є причеп", "4×4") */
  @Column({ type: 'text', nullable: true })
  notes: string;
}
