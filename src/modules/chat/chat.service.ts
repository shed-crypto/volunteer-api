// ─── chat.service.ts ──────────────────────────────────────────────────────────
import {
  Injectable, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chat } from './entities/chat.entity';
import { Message } from './entities/message.entity';
import { User } from '@modules/users/entities/user.entity';
import { ChatType, SystemRole } from '@common/enums';
import { ChatGateway } from './chat.gateway';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Chat) private readonly chatRepo: Repository<Chat>,
    @InjectRepository(Message) private readonly messageRepo: Repository<Message>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly chatGateway: ChatGateway,
  ) {}

  /** Усі чати поточного користувача */
  async getUserChats(user: User): Promise<Chat[]> {
    return this.chatRepo
      .createQueryBuilder('chat')
      .innerJoin('chat.participants', 'p', 'p.id = :userId', { userId: user.id })
      .leftJoinAndSelect('chat.participants', 'participants')
      .orderBy('chat.updated_at', 'DESC')
      .getMany();
  }

  /** Отримати або створити приватний чат між двома користувачами */
  async getOrCreateDirectChat(user: User, targetUserId: string): Promise<Chat> {
    // Шукаємо існуючий direct чат між цими двома
    const existing = await this.chatRepo
      .createQueryBuilder('chat')
      .innerJoin('chat.participants', 'p1', 'p1.id = :uid', { uid: user.id })
      .innerJoin('chat.participants', 'p2', 'p2.id = :tid', { tid: targetUserId })
      .where('chat.type = :type', { type: ChatType.DIRECT })
      .getOne();

    if (existing) {
      return this.chatRepo
        .createQueryBuilder('chat')
        .leftJoinAndSelect('chat.participants', 'participants')
        .where('chat.id = :id', { id: existing.id })
        .getOne();
    }

    const target = { id: targetUserId } as User;
    const chat = this.chatRepo.create({
      type: ChatType.DIRECT,
      participants: [user, target],
    });
    const savedChat = await this.chatRepo.save(chat);
    return this.chatRepo
      .createQueryBuilder('chat')
      .leftJoinAndSelect('chat.participants', 'participants')
      .where('chat.id = :id', { id: savedChat.id })
      .getOne();
  }

  /** Історія повідомлень чату (пагінація курсором) */
  async getMessages(
    chatId: string,
    user: User,
    limit = 50,
    beforeId?: string,
    sort: 'ASC' | 'DESC' = 'ASC',
  ): Promise<Message[]> {
    try {
      await this.ensureParticipant(chatId, user.id);

      const qb = this.messageRepo
        .createQueryBuilder('msg')
        .leftJoinAndSelect('msg.sender', 'sender')
        .leftJoinAndSelect('msg.replyTo', 'replyTo')
        .where('msg.chatId = :chatId', { chatId });

      if (beforeId) {
        const cursor = await this.messageRepo.findOne({ where: { id: beforeId } });
        if (cursor) {
          if (sort === 'DESC') {
            qb.andWhere('msg.sentAt > :ts', { ts: cursor.sentAt });
          } else {
            qb.andWhere('msg.sentAt < :ts', { ts: cursor.sentAt });
          }
        }
      }

      const messages = await qb
        .orderBy('msg.sentAt', sort)
        .take(limit)
        .getMany();
        
      return messages;
    } catch (e) {
      console.error(`[ChatService.getMessages] Error for chatId ${chatId}:`, e);
      throw e;
    }
  }

  /** Надіслати нове повідомлення в чат */
  async sendMessage(
    chatId: string,
    user: User,
    dto: { content: string; attachmentUrl?: string; messageType?: string; replyToId?: string },
  ): Promise<Message> {
    await this.ensureParticipant(chatId, user.id);

    // Явно визначаємо тип повідомлення на основі наявності вкладення
    const messageType = dto.attachmentUrl ? 'attachment' : 'text';
    
    const message = this.messageRepo.create({
      chatId,
      senderId: user.id,
      content: dto.content,
      attachmentUrl: dto.attachmentUrl || null,
      messageType: messageType,
      messageStatus: 'sent', // Завжди sent по замовчуванню
      replyToId: dto.replyToId || null,
    });

    const saved = await this.messageRepo.save(message);
    
    // Повертаємо з усіма зв'язками для коректного відображення фронтендом
    return this.messageRepo.findOne({
      where: { id: saved.id },
      relations: ['sender', 'replyTo', 'replyTo.sender'],
    });
  }

    /** Позначити повідомлення як прочитані */
    async markAsRead(chatId: string, user: User): Promise<void> {
      await this.ensureParticipant(chatId, user.id);

      const result = await this.messageRepo.query(
        `UPDATE "messages" 
         SET "read_by" = array_append(COALESCE("read_by", '{}'::text[]), $1)
         WHERE "chat_id" = $2 
         AND NOT ($1 = ANY(COALESCE("read_by", '{}'::text[])))
         RETURNING "id"`,
        [user.id, chatId],
      );

      if (result.length > 0) {
        const updatedIds = result.map((row: any) => row.id);
        this.chatGateway.sendMessagesRead(chatId, user.id, updatedIds);
      }
    }

  private async ensureParticipant(chatId: string, userId: string): Promise<void> {
    // First check if user is a direct participant
    const chat = await this.chatRepo
      .createQueryBuilder('chat')
      .innerJoin('chat.participants', 'p', 'p.id = :userId', { userId })
      .where('chat.id = :chatId', { chatId })
      .getOne();

    // If not a participant, check for admin access to task chats
    if (!chat) {
      // Get user with role information
      const user = await this.userRepo.findOne({ 
        where: { id: userId },
        select: ['id', 'systemRole']
      });
      
      // Get chat type
      const chatWithType = await this.chatRepo.findOne({ 
        where: { id: chatId },
        select: ['id', 'type']
      });

      // Allow admin access to task chats
      if (user?.systemRole === SystemRole.ADMIN && chatWithType?.type === ChatType.TASK_CHAT) {
        return; // Allow access
      }
      
      throw new ForbiddenException('Немає доступу до цього чату');
    }
  }
}