import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from './entities/task.entity';
import { TaskAssignment } from './entities/task-assignment.entity';
import { TaskDelegation } from './entities/task-delegation.entity';
import { TrustVouch } from '@modules/users/entities/trust-vouch.entity';
import { Request } from '@modules/requests/entities/request.entity';
import { Chat } from '@modules/chat/entities/chat.entity';
import { OrganizationMember } from '@modules/organizations/entities/organization-member.entity';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { ChatModule } from '@modules/chat/chat.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Task, TaskAssignment, TaskDelegation,
      TrustVouch, Request, Chat, OrganizationMember,
    ]),
    NotificationsModule,
    ChatModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
