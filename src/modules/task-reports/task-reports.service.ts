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

  async update(id: string, comment: string): Promise<TaskReport> {
    const report = await this.findById(id);
    // Перевірка часу: 30 хвилин
    const diff = (Date.now() - new Date(report.createdAt).getTime()) / 60000;
    if (diff > 30) {
      throw new Error('Редагування звіту можливе лише протягом 30 хвилин');
    }
    report.comment = comment;
    return this.reportRepository.save(report);
  }

  async verifyReport(id: string, userId: string): Promise<TaskReport> {
    const report = await this.findById(id);
    report.isVerified = true;
    report.verifiedById = userId;
    report.verifiedAt = new Date();
    return this.reportRepository.save(report);
  }

  async delete(id: string, userId: string): Promise<void> {
    const report = await this.findById(id);
    if (report.userId !== userId) {
      throw new Error('Ви не можете видалити чужий звіт');
    }
    // Перевірка часу: 30 хвилин
    const diff = (Date.now() - new Date(report.createdAt).getTime()) / 60000;
    if (diff > 30) {
      throw new Error('Видалення звіту можливе лише протягом 30 хвилин');
    }
    await this.reportRepository.delete(id);
  }
}
