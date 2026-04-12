import {
  Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskReport } from './entities/task-report.entity';

@Injectable()
export class TaskReportsService {
  constructor(
    @InjectRepository(TaskReport)
    private readonly reportRepository: Repository<TaskReport>,
  ) {}

  async create(
    taskId: string,
    user: any,
    comment: string,
    files: Express.Multer.File[],
  ): Promise<TaskReport> {
    // Mapуємо збережені файли у масив вкладень
    // url починається з '/' → фронтенд конкатенує baseUrl + url правильно
    const attachments = files.map((file) => ({
      url: `/uploads/reports/${file.filename}`,
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

  async findById(id: string): Promise<TaskReport> {
    const report = await this.reportRepository.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!report) throw new NotFoundException(`Report ${id} not found`);
    return report;
  }
}
