// ─── organizations.module.ts ──────────────────────────────────────────────────
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationMember } from './entities/organization-member.entity';
import { Hub } from './entities/hub.entity';
import { OrganizationSettings } from './entities/organization-settings.entity';
import { OrganizationJoinRequest } from './entities/organization-join-request.entity';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { ChatModule } from '@modules/chat/chat.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Organization,
      OrganizationMember,
      Hub,
      OrganizationSettings,
      OrganizationJoinRequest,
    ]),
    ChatModule,
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService, TypeOrmModule],
})
export class OrganizationsModule {}
