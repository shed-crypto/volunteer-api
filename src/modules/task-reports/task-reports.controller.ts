import { Controller, Post, Get, Body, Param, UseGuards, Request } from '@nestjs/common';
import { TaskReportsService } from './task-reports.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';

@Controller('tasks/:taskId/reports')
@UseGuards(JwtAuthGuard)
export class TaskReportsController {
  constructor(private readonly reportsService: TaskReportsService) {}

  @Post()
  async create(
    @Param('taskId') taskId: string,
    @Request() req: any,
    @Body() body: { comment: string; attachments: any[] },
  ) {
    return this.reportsService.create(taskId, req.user, body.comment, body.attachments);
  }

  @Get()
  async findAll(@Param('taskId') taskId: string) {
    return this.reportsService.findByTask(taskId);
  }
}
