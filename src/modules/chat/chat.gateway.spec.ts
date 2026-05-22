import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ChatGateway } from './chat.gateway';
import { Chat } from './entities/chat.entity';
import { Message } from './entities/message.entity';
import { User } from '@modules/users/entities/user.entity';

describe('ChatGateway — WebSocket methods', () => {
  let gateway: ChatGateway;
  let mockUserRepo: any;
  let mockChatRepo: any;
  let mockMessageRepo: any;
  let mockJwtService: any;

  const createMockSocket = (overrides: any = {}): any => ({
    id: 'socket-1',
    handshake: {
      auth: { token: 'valid-jwt' },
      headers: {},
    },
    data: {},
    join: jest.fn(),
    emit: jest.fn(),
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    disconnect: jest.fn(),
    ...overrides,
  });

  beforeEach(async () => {
    mockUserRepo = {
      findOne: jest.fn(),
    };

    mockChatRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    };

    mockMessageRepo = {
      save: jest.fn().mockResolvedValue({ id: 'msg-1', chatId: 'chat-1', content: 'System', messageType: 'system' }),
    };

    mockJwtService = {
      verify: jest.fn().mockReturnValue({ sub: 'user-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: getRepositoryToken(Chat), useValue: mockChatRepo },
        { provide: getRepositoryToken(Message), useValue: mockMessageRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    gateway = module.get<ChatGateway>(ChatGateway);
    // Примусово встановлюємо server для тестів
    (gateway as any).server = {
      sockets: {
        sockets: new Map(),
      },
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };
  });

  // ------------------------------------------------------
  // 4.1 — handleConnection: успішне підключення
  // ------------------------------------------------------
  it('4.1 — handleConnection: верифікує токен та підписує на чати', async () => {
    const socket = createMockSocket();
    mockUserRepo.findOne.mockResolvedValue({ id: 'user-1', fullName: 'Test', isBlocked: false });
    mockChatRepo.createQueryBuilder = jest.fn().mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{ id: 'chat-1' }]),
    });

    await gateway.handleConnection(socket);

    expect(socket.data.userId).toBe('user-1');
    expect(socket.data.fullName).toBe('Test');
    expect(socket.join).toHaveBeenCalledWith('chat:chat-1');
  });

  // ------------------------------------------------------
  // 4.2 — handleConnection: відхилення без токена
  // ------------------------------------------------------
  it('4.2 — handleConnection: відключає клієнта без токена', async () => {
    const socket = createMockSocket({ handshake: { auth: {}, headers: {} } });

    await gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  // ------------------------------------------------------
  // 4.3 — handleConnection: відхилення забаненого користувача
  // ------------------------------------------------------
  it('4.3 — handleConnection: відключає заблокованого користувача', async () => {
    const socket = createMockSocket();
    mockUserRepo.findOne.mockResolvedValue({ id: 'user-1', fullName: 'Blocked', isBlocked: true });

    await gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  // ------------------------------------------------------
  // 4.4 — handleDisconnect: видаляє користувача з connectedUsers
  // ------------------------------------------------------
  it('4.4 — handleDisconnect: видаляє userId з мапи підключень', () => {
    // Симулюємо підключення
    const connectedUsers = (gateway as any).connectedUsers;
    connectedUsers.set('user-1', 'socket-1');

    const socket = createMockSocket();
    socket.data.userId = 'user-1';

    gateway.handleDisconnect(socket);

    expect(connectedUsers.has('user-1')).toBe(false);
  });

  // ------------------------------------------------------
  // 4.5 — sendSystemMessage: зберігає та транслює системне повідомлення
  // ------------------------------------------------------
  it('4.5 — sendSystemMessage: зберігає в БД і транслює', async () => {
    const emitMock = jest.fn();
    (gateway as any).server.to.mockReturnValue({ emit: emitMock });

    await gateway.sendSystemMessage('chat-1', 'Волонтер приєднався');

    expect(mockMessageRepo.save).toHaveBeenCalledWith({
      chatId: 'chat-1',
      content: 'Волонтер приєднався',
      messageType: 'system',
    });
    expect(emitMock).toHaveBeenCalledWith('new_message', expect.objectContaining({
      messageType: 'system',
    }));
  });
});