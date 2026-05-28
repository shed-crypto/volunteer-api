import {
  Controller, Get, Post,
  Param, Query, UseGuards,
  ParseUUIDPipe,
  HttpCode, HttpStatus, Body,
  UseInterceptors, UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RemoveExifInterceptor } from '@common/interceptors/remove-exif.interceptor';
import { memoryStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync, promises as fs } from 'fs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { IsUUID, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
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

// ─── Multer: зберігаємо файли чату у пам'яті (значно швидше за diskStorage на Docker) ──
const chatStorage = memoryStorage();
const avatarStorage = memoryStorage();

@ApiTags('Чати')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

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

  @Post('avatar')
  @ApiOperation({ summary: 'Завантажити аватарку користувача' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: avatarStorage,
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype?.startsWith('image/')) {
          cb(new BadRequestException('Only images can be uploaded'), false);
          return;
        }
        cb(null, true);
      },
    }),
    RemoveExifInterceptor,
  )
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
  ): Promise<{ url: string }> {
    if (!file) throw new BadRequestException('File was not provided');

    const dir = 'uploads/avatars';
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`;

    // Асинхронний запис з буфера замість diskStorage
    await fs.writeFile(join(dir, filename), file.buffer);

    const avatarUrl = `/uploads/avatars/${filename}`;
    await this.userRepo.update(user.id, { avatarUrl });
    return { url: avatarUrl };
  }

  @Get(':chatId/messages')
  @ApiOperation({ summary: 'Історія повідомлень чату (курсорна пагінація)' })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({ name: 'beforeId', required: false, description: 'UUID повідомлення-курсора' })
  @ApiQuery({ name: 'sort', required: false, enum: ['ASC', 'DESC'], description: 'Порядок сортування' })
  getMessages(
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Query('limit') limit: string,
    @Query('beforeId') beforeId: string,
    @Query('sort') sort: 'ASC' | 'DESC' = 'ASC',
    @CurrentUser() user: User,
  ): Promise<Message[]> {
    return this.chatService.getMessages(chatId, user, parseInt(limit || '50', 10), beforeId, sort);
  }

  @Post(':chatId/messages')
  @ApiOperation({ summary: 'Надіслати нове повідомлення в чат' })
  async sendMessage(
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Body() dto: CreateMessageDto,
    @CurrentUser() user: User,
  ): Promise<Message> {
    const message = await this.chatService.sendMessage(chatId, user, dto);
    
    // Транслюємо через WebSocket
    this.chatGateway.server.to(`chat:${chatId}`).emit('new_message', {
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      senderName: user.fullName,
      content: message.content,
      attachmentUrl: message.attachmentUrl,
      messageType: message.messageType,
      sentAt: message.sentAt.toISOString(),
      replyToId: message.replyToId,
    });

    return message;
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
      limits: { fileSize: 100 * 1024 * 1024 }, // 100 МБ
    }),
    // NOTE: RemoveExifInterceptor тимчасово вимкнено для чату через проблеми з sharp на Alpine
    // RemoveExifInterceptor,
  )
  async uploadChatFile(
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string; name: string; mimeType: string }> {
    if (!file) throw new BadRequestException('File was not provided');

    const dir = 'uploads/chat';
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`;

    // Асинхронний запис з буфера — значно швидше, ніж diskStorage + Docker volume
    await fs.writeFile(join(dir, filename), file.buffer);

    return {
      url: `/uploads/chat/${filename}`,
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
