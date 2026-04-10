import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskReport } from './entities/task-report.entity';
import { Task } from '@modules/tasks/entities/task.entity';
import { User } from '@modules/users/entities/user.entity';

@Injectable()
export class TaskReportsService {
  constructor(
    @InjectRepository(TaskReport)
    private readonly reportRepository: Repository<TaskReport>,
  ) {}

  async create(taskId: string, user: User, comment: string, files: any[]): Promise<TaskReport> {
    const attachments = files.map((file) => ({
      url: file.path || file.filename,
      type: file.mimetype,
      name: file.originalname,
    }));

    const report = this.reportRepository.create({
      taskId,
      userId: user.id,
      comment,
      attachments,
    });
    return this.reportRepository.save(report);
  }

  async findByTask(taskId: string): Promise<TaskReport[]> {
    return this.reportRepository.find({
      where: { taskId },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });
  }
}
