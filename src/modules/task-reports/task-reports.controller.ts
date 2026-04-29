import {
  Controller, Post, Get, Body, Param,
  UseGuards, Request, UseInterceptors, UploadedFiles, NotFoundException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { TaskReportsService } from './task-reports.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';

// ─── Multer: зберігаємо файли на диск у папку uploads/reports ─────────────────
const reportStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const dir = 'uploads/reports';
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${extname(file.originalname)}`);
  },
});

@Controller('tasks/:taskId/reports')
@UseGuards(JwtAuthGuard)
export class TaskReportsController {
  constructor(private readonly reportsService: TaskReportsService) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('attachments', 10, {
      storage: reportStorage,
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 МБ на файл
    }),
  )
  async create(
    @Param('taskId') taskId: string,
    @Request() req: any,
    @Body() body: { comment: string },
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    return this.reportsService.create(taskId, req.user, body.comment, files ?? []);
  }

  @Get()
  async findAll(@Param('taskId') taskId: string) {
    return this.reportsService.findByTask(taskId);
  }

  @Post(':id/edit')
  async update(
    @Param('id') id: string,
    @Body() body: { comment: string },
  ) {
    return this.reportsService.update(id, body.comment);
  }

  @Post(':id/delete')
  async delete(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.reportsService.delete(id, req.user.id);
  }

  @Post(':id/verify')
  async verify(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.reportsService.verifyReport(id, req.user.id);
  }

  // Примітка: завантаження / перегляд файлів відбувається через
  // статичне обслуговування ServeStaticModule (/uploads/**).
  // Окремі ендпоінти для скачування не потрібні.
}
