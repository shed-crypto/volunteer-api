// ─── chat.module.ts ───────────────────────────────────────────────────────────
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Chat } from './entities/chat.entity';
import { Message } from './entities/message.entity';
import { User } from '@modules/users/entities/user.entity';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Chat, Message, User]),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev_secret',
    }),
  ],
  controllers: [ChatController],
  providers: [ChatGateway, ChatService],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}
