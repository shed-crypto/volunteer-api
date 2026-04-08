import {
  Controller, Get, Post,
  Param, Query, UseGuards,
  ParseUUIDPipe, ParseIntPipe,
  HttpCode, HttpStatus, Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { IsUUID, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { User } from '@modules/users/entities/user.entity';
import { Chat } from './entities/chat.entity';
import { Message } from './entities/message.entity';

class CreateDirectChatDto {
  @ApiProperty({ description: 'UUID отримувача' })
  @IsUUID()
  targetUserId: string;
}

@ApiTags('Чати')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  @ApiOperation({ summary: 'Всі чати поточного користувача' })
  getMyChats(@CurrentUser() user: User): Promise<Chat[]> {
    return this.chatService.getUserChats(user);
  }

  @Post('direct')
  @ApiOperation({ summary: 'Відкрити / отримати приватний чат з іншим користувачем' })
  getOrCreateDirect(
    @Body() dto: CreateDirectChatDto,
    @CurrentUser() user: User,
  ): Promise<Chat> {
    return this.chatService.getOrCreateDirectChat(user, dto.targetUserId);
  }

  @Get(':chatId/messages')
  @ApiOperation({ summary: 'Історія повідомлень чату (курсорна пагінація)' })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({ name: 'beforeId', required: false, description: 'UUID повідомлення-курсора' })
  getMessages(
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Query('limit') limit: string,
    @Query('beforeId') beforeId: string,
    @CurrentUser() user: User,
  ): Promise<Message[]> {
    return this.chatService.getMessages(chatId, user, parseInt(limit || '50', 10), beforeId);
  }

  @Post(':chatId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Позначити всі повідомлення чату як прочитані' })
  markAsRead(
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.chatService.markAsRead(chatId, user);
  }
}
