// ─── requests.module.ts ───────────────────────────────────────────────────────
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Request } from './entities/request.entity';
import { SavedRequest } from './entities/saved-request.entity';
import { AccessLog } from './entities/access-log.entity';
import { Task } from '@modules/tasks/entities/task.entity';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Request, SavedRequest, AccessLog, Task])],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService, TypeOrmModule],
})
export class RequestsModule {}
