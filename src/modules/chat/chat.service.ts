// ─── chat.service.ts ──────────────────────────────────────────────────────────
import {
  Injectable, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chat } from './entities/chat.entity';
import { Message } from './entities/message.entity';
import { User } from '@modules/users/entities/user.entity';
import { ChatType } from '@common/enums';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Chat) private readonly chatRepo: Repository<Chat>,
    @InjectRepository(Message) private readonly messageRepo: Repository<Message>,
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

    if (existing) return existing;

    const target = { id: targetUserId } as User;
    const chat = this.chatRepo.create({
      type: ChatType.DIRECT,
      participants: [user, target],
    });
    return this.chatRepo.save(chat);
  }

  /** Історія повідомлень чату (пагінація курсором) */
  async getMessages(
    chatId: string,
    user: User,
    limit = 50,
    beforeId?: string,
  ): Promise<Message[]> {
    await this.ensureParticipant(chatId, user.id);

    const qb = this.messageRepo
      .createQueryBuilder('msg')
      .leftJoinAndSelect('msg.sender', 'sender')
      .where('msg.chat_id = :chatId', { chatId })
      .orderBy('msg.sent_at', 'DESC')
      .take(limit);

    if (beforeId) {
      const cursor = await this.messageRepo.findOne({ where: { id: beforeId } });
      if (cursor) {
        qb.andWhere('msg.sent_at < :ts', { ts: cursor.sentAt });
      }
    }

    const messages = await qb.getMany();
    return messages.reverse(); // хронологічний порядок
  }

  /** Надіслати нове повідомлення в чат */
  async sendMessage(
    chatId: string,
    user: User,
    dto: { content: string; attachmentUrl?: string; messageType?: string },
  ): Promise<Message> {
    await this.ensureParticipant(chatId, user.id);

    const message = this.messageRepo.create({
      chatId,
      senderId: user.id,
      content: dto.content,
      attachmentUrl: dto.attachmentUrl || null,
      messageType: dto.messageType || 'text',
    });

    return this.messageRepo.save(message);
  }

    /** Позначити повідомлення як прочитані */
    async markAsRead(chatId: string, user: User): Promise<void> {
      await this.ensureParticipant(chatId, user.id);

      await this.messageRepo
        .createQueryBuilder()
        .update(Message)
        .set({
          readBy: () => `COALESCE("read_by", '{}') || '${user.id}'::text[]`,
        })
        .where('chat_id = :chatId AND (read_by IS NULL OR NOT (:userId = ANY(read_by)))', {
          chatId,
          userId: user.id,
        })
        .execute();
    }

  private async ensureParticipant(chatId: string, userId: string): Promise<void> {
    const chat = await this.chatRepo
      .createQueryBuilder('chat')
      .innerJoin('chat.participants', 'p', 'p.id = :userId', { userId })
      .where('chat.id = :chatId', { chatId })
      .getOne();

    if (!chat) {
      throw new ForbiddenException('Немає доступу до цього чату');
    }
  }
}