import {
  Controller, Get, Post,
  Param, Query, UseGuards,
  ParseUUIDPipe,
  HttpCode, HttpStatus, Body,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
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

class CreateMessageDto {
  @ApiProperty({ description: 'Текст повідомлення' })
  @IsString()
  content: string;

  @ApiPropertyOptional({ description: 'URL вкладення' })
  @IsString()
  @IsOptional()
  attachmentUrl?: string;

  @ApiPropertyOptional({ description: 'Тип повідомлення' })
  @IsString()
  @IsOptional()
  messageType?: string;

  @ApiPropertyOptional({ description: 'UUID повідомлення на яке відповідають' })
  @IsUUID()
  @IsOptional()
  replyToId?: string;
}

// ─── Multer: зберігаємо файли чату у uploads/chat ────────────────────────────
const chatStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const dir = 'uploads/chat';
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${extname(file.originalname)}`);
  },
});

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

  @Post(':chatId/messages')
  @ApiOperation({ summary: 'Надіслати нове повідомлення в чат' })
  sendMessage(
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Body() dto: CreateMessageDto,
    @CurrentUser() user: User,
  ): Promise<Message> {
    return this.chatService.sendMessage(chatId, user, dto);
  }

  /**
   * Завантажує файл у чат, зберігає на диск і повертає URL.
   * Клієнт використовує URL для відправки повідомлення з вкладенням через WebSocket.
   *
   * POST /api/chats/:chatId/files
   * Body: multipart/form-data з полем "file"
   * Response: { url, name, mimeType }
   */
  @Post(':chatId/files')
  @ApiOperation({ summary: 'Завантажити файл у чат' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: chatStorage,
      limits: { fileSize: 25 * 1024 * 1024 }, // 25 МБ
    }),
  )
  async uploadChatFile(
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string; name: string; mimeType: string }> {
    if (file.mimetype.startsWith('image/')) {
      const sharp = require('sharp');
      const buffer = await sharp(file.path)
        .rotate()
        .withMetadata({})
        .toBuffer();
      require('fs').writeFileSync(file.path, buffer);
    }
    
    return {
      url: `/uploads/chat/${file.filename}`,
      name: file.originalname,
      mimeType: file.mimetype,
    };
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
