import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { join } from 'path';
import { User } from '../modules/users/entities/user.entity';
import { Vehicle } from '../modules/users/entities/vehicle.entity';
import { TrustVouch } from '../modules/users/entities/trust-vouch.entity';
import { Organization } from '../modules/organizations/entities/organization.entity';
import { OrganizationMember } from '../modules/organizations/entities/organization-member.entity';
import { Hub } from '../modules/organizations/entities/hub.entity';
import { OrganizationSettings } from '../modules/organizations/entities/organization-settings.entity';
import { OrganizationJoinRequest } from '../modules/organizations/entities/organization-join-request.entity';
import { Request } from '../modules/requests/entities/request.entity';
import { Task } from '../modules/tasks/entities/task.entity';
import { TaskAssignment } from '../modules/tasks/entities/task-assignment.entity';
import { TaskDelegation } from '../modules/tasks/entities/task-delegation.entity';
import { Message } from '../modules/chat/entities/message.entity';
import { Chat } from '../modules/chat/entities/chat.entity';
import { TaskReport } from '../modules/task-reports/entities/task-report.entity';

config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  username: process.env.DB_USER || 'volunteer',
  password: process.env.DB_PASSWORD || 'volunteer_pass',
  database: process.env.DB_NAME || 'volunteer_help',
  synchronize: false,
  logging: true,
  entities: [
    User,
    Vehicle,
    TrustVouch,
    Organization,
    OrganizationMember,
    Hub,
    OrganizationSettings,
    OrganizationJoinRequest,
    Request,
    Task,
    TaskAssignment,
    TaskDelegation,
    Message,
    Chat,
    TaskReport,
  ],
  migrations: [join(__dirname, './migrations/**/*{.ts,.js}')],
});
