import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Vehicle } from './entities/vehicle.entity';
import { TrustVouch } from './entities/trust-vouch.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UsersAvatarController } from './users-avatar.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, Vehicle, TrustVouch])],
  controllers: [UsersAvatarController, UsersController],
  providers: [UsersService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
