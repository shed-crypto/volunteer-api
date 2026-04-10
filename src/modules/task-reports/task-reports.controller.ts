import { Controller, Post, Get, Body, Param, UseGuards, Request, UseInterceptors, UploadedFiles } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { TaskReportsService } from './task-reports.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';

@Controller('tasks/:taskId/reports')
@UseGuards(JwtAuthGuard)
export class TaskReportsController {
  constructor(private readonly reportsService: TaskReportsService) {}

  @Post()
  @UseInterceptors(FilesInterceptor('attachments'))
  async create(
    @Param('taskId') taskId: string,
    @Request() req: any,
    @Body() body: { comment: string },
    @UploadedFiles() files: Array<any>,
  ) {
    return this.reportsService.create(taskId, req.user, body.comment, files);
  }

  @Get()
  async findAll(@Param('taskId') taskId: string) {
    return this.reportsService.findByTask(taskId);
  }
}
