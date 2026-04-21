import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { Chat } from './entities/chat.entity';
import { Message } from './entities/message.entity';
import { User } from '@modules/users/entities/user.entity';
import { ChatType, SystemRole } from '@common/enums';

/**
 * WebSocket шлюз для реального часу (чат).
 *
 * Клієнт при підключенні надсилає JWT у auth.token.
 * Після верифікації — join'ить кімнати всіх своїх чатів.
 *
 * Події:
 *  - join_chat:    client → server (увійти в кімнату чату)
 *  - send_message: client → server (надіслати повідомлення)
 *  - new_message:  server → client (broadcast нового повідомлення)
 *  - user_typing:  client ↔ server (показати "друкує...")
 */
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  // Зберігаємо userId → socketId для online-статусу
  private connectedUsers = new Map<string, string>();

  constructor(
    @InjectRepository(Chat)
    private readonly chatRepository: Repository<Chat>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  // ─── Підключення ─────────────────────────────────────────────────────────

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect(true);
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });

      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
        select: ['id', 'fullName', 'isBlocked'],
      });

      if (!user || user.isBlocked) {
        client.disconnect(true);
        return;
      }

      // Прив'язуємо userId до сокету
      client.data.userId = user.id;
      client.data.fullName = user.fullName;
      this.connectedUsers.set(user.id, client.id);

      // Автоматично підписуємося на всі чати цього користувача
      const userChats = await this.chatRepository
        .createQueryBuilder('chat')
        .innerJoin('chat.participants', 'p', 'p.id = :userId', { userId: user.id })
        .select(['chat.id'])
        .getMany();

      for (const chat of userChats) {
        await client.join(`chat:${chat.id}`);
      }

      this.logger.log(`User ${user.fullName} (${user.id}) connected`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = client.data?.userId;
    if (userId) {
      this.connectedUsers.delete(userId);
      this.logger.log(`User ${userId} disconnected`);
    }
  }

  // ─── Надіслати повідомлення ───────────────────────────────────────────────

  @SubscribeMessage('send_message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { chatId: string; content: string; attachmentUrl?: string },
  ): Promise<void> {
    const { userId, fullName } = client.data;

    // Перевіряємо, чи є користувач учасником чату або адмін у таск-чаті
    const chat = await this.chatRepository
      .createQueryBuilder('chat')
      .innerJoin('chat.participants', 'p', 'p.id = :userId', { userId })
      .where('chat.id = :chatId', { chatId: data.chatId })
      .getOne();

    if (!chat) {
      // Якщо не учасник, перевіряємо чи є адміном для таск-чатів
      const userWithRole = await this.userRepository.findOne({
        where: { id: userId },
        select: ['id', 'systemRole']
      });
      
      const chatWithType = await this.chatRepository.findOne({
        where: { id: data.chatId },
        select: ['id', 'type']
      });
      
      // Дозволяємо адміну писати в таск-чатах
      if (!(userWithRole?.systemRole === SystemRole.ADMIN && chatWithType?.type === ChatType.TASK_CHAT)) {
        throw new WsException('Немає доступу до цього чату');
      }
    }

    // Зберігаємо повідомлення в БД
    const message = await this.messageRepository.save({
      chatId: data.chatId,
      senderId: userId,
      content: data.content,
      attachmentUrl: data.attachmentUrl,
      messageType: data.attachmentUrl ? 'attachment' : 'text',
    });

    // Broadcast у кімнату чату (всім учасникам)
    this.server.to(`chat:${data.chatId}`).emit('new_message', {
      id: message.id,
      chatId: message.chatId,
      senderId: userId,
      senderName: fullName,
      content: message.content,
      attachmentUrl: message.attachmentUrl,
      messageType: message.messageType,
      sentAt: message.sentAt,
    });
  }

  // ─── "Друкує..." ──────────────────────────────────────────────────────────

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string; isTyping: boolean },
  ): void {
    client.to(`chat:${data.chatId}`).emit('user_typing', {
      userId: client.data.userId,
      name: client.data.fullName,
      isTyping: data.isTyping,
    });
  }

  // ─── Публічний метод: відправити системне повідомлення з сервера ──────────

  async sendSystemMessage(chatId: string, content: string): Promise<void> {
    const message = await this.messageRepository.save({
      chatId,
      content,
      messageType: 'system',
    });

    this.server.to(`chat:${chatId}`).emit('new_message', {
      ...message,
      messageType: 'system',
    });
  }

  /**
   * Додати нового учасника до WebSocket-кімнати чату.
   * Викликається із TasksService після assignVolunteer.
   *
   * Надсилає клієнту подію `new_chat_joined` — клієнт підписується
   * на нову кімнату без необхідності реконнекту (FR-10d fix).
   */
  addParticipantToRoom(userId: string, chatId: string, chatName?: string): void {
    const socketId = this.connectedUsers.get(userId);
    if (!socketId) return;

    if (!this.server || !this.server.sockets) {
      this.logger.warn(`WebSocket server or sockets not initialized when trying to add participant ${userId} to chat ${chatId}`);
      return;
    }
    
    // Додаткова перевірка для sockets.sockets
    if (!this.server.sockets.sockets) {
      this.logger.warn(`WebSocket server.sockets.sockets not initialized when trying to add participant ${userId} to chat ${chatId}`);
      return;
    }
    
    const socket = this.server.sockets.sockets.get(socketId);
    if (!socket) return;

    // Підписуємо сокет на кімнату
    socket.join(`chat:${chatId}`);

    // Повідомляємо клієнта, щоб він додав чат у свій локальний список
    socket.emit('new_chat_joined', {
      chatId,
      chatName: chatName ?? `Чат ${chatId.substring(0, 8)}`,
    });
  }
}