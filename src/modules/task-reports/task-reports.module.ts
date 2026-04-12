import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { join } from 'path';
import { TaskReport } from './entities/task-report.entity';
import { TaskReportsService } from './task-reports.service';
import { TaskReportsController } from './task-reports.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([TaskReport]),
  ],
  controllers: [TaskReportsController],
  providers: [TaskReportsService],
  exports: [TaskReportsService],
})
export class TaskReportsModule {}