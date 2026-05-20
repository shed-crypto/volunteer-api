import {
  Injectable, NotFoundException,
  ForbiddenException, ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationMember } from './entities/organization-member.entity';
import { Hub } from './entities/hub.entity';
import { OrganizationSettings } from './entities/organization-settings.entity';
import { OrganizationJoinRequest } from './entities/organization-join-request.entity';
import { Request } from '@modules/requests/entities/request.entity';
import { Task } from '@modules/tasks/entities/task.entity';
import { TaskDelegation } from '@modules/tasks/entities/task-delegation.entity';
import { User } from '@modules/users/entities/user.entity';
import { OrgRole, SystemRole, ChatType } from '@common/enums';
import { ChatService } from '@modules/chat/chat.service';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    @InjectRepository(OrganizationMember)
    private readonly memberRepo: Repository<OrganizationMember>,
    @InjectRepository(Hub)
    private readonly hubRepo: Repository<Hub>,
    @InjectRepository(OrganizationSettings)
    private readonly settingsRepo: Repository<OrganizationSettings>,
    @InjectRepository(OrganizationJoinRequest)
    private readonly joinRequestRepo: Repository<OrganizationJoinRequest>,
    @InjectRepository(Request)
    private readonly requestRepo: Repository<Request>,
    @InjectRepository(TaskDelegation)
    private readonly taskDelegationRepo: Repository<TaskDelegation>,
    private readonly chatService: ChatService,
  ) {}

  // ─── Створення організації ────────────────────────────────────────────────

  async create(
    dto: { name: string; description?: string; parentOrgId?: string },
    creator: User,
  ): Promise<Organization> {
    if (dto.parentOrgId) {
      const parent = await this.orgRepo.findOne({ where: { id: dto.parentOrgId } });
      if (!parent) throw new NotFoundException('Батьківську організацію не знайдено');
    }

    const org = await this.orgRepo.save(
      this.orgRepo.create(dto),
    );

    // Створюємо стандартні налаштування
    await this.settingsRepo.save(
      this.settingsRepo.create({
        organizationId: org.id,
      }),
    );

    // Автоматично додаємо засновника як LEADER
    await this.memberRepo.save({
      organizationId: org.id,
      userId: creator.id,
      orgRole: OrgRole.LEADER,
    });

    // Створюємо чат організації
    try {
      const chat = await this.chatService.createGroupChat(
        `Чат: ${org.name}`,
        [creator.id],
        ChatType.ORG_CHAT,
        org.id,
      );
      org.chatId = chat.id;
      await this.orgRepo.save(org);
    } catch (e) {
      console.error(`[OrganizationsService] Failed to create org chat:`, e);
    }

    return org;
  }

  async search(query: string): Promise<Organization[]> {
    return this.orgRepo.find({
      where: [
        { name: Like(`%${query}%`) },
        { description: Like(`%${query}%`) },
      ],
      relations: ['settings'],
    });
  }

  async update(id: string, dto: Partial<Organization>): Promise<Organization> {
    const org = await this.findById(id);
    Object.assign(org, dto);
    return this.orgRepo.save(org);
  }

  async delete(id: string, requester: User): Promise<void> {
    await this.checkLeaderOrAdmin(id, requester);
    const org = await this.findById(id);
    
    if (org.children && org.children.length > 0) {
      throw new ForbiddenException('Неможливо видалити організацію, яка має підгрупи. Спочатку видаліть або перенесіть їх.');
    }
    
    await this.orgRepo.remove(org);
  }

  async leave(orgId: string, user: User): Promise<void> {
    const membership = await this.getMember(orgId, user.id);
    if (!membership) throw new NotFoundException('Ви не є учасником цієї організації');
    
    if (membership.orgRole === OrgRole.LEADER) {
      const leaders = await this.memberRepo.count({
        where: { organizationId: orgId, orgRole: OrgRole.LEADER }
      });
      if (leaders <= 1) {
        throw new ForbiddenException('Ви останній лідер. Передайте права або видаліть організацію.');
      }
    }
    
    await this.memberRepo.remove(membership);
  }

  async getSettings(orgId: string): Promise<OrganizationSettings> {
    let settings = await this.settingsRepo.findOne({ where: { organizationId: orgId } });
    if (!settings) {
      // Lazy-initialization для старих організацій
      settings = await this.settingsRepo.save(
        this.settingsRepo.create({ organizationId: orgId }),
      );
    }
    return settings;
  }

  async updateSettings(orgId: string, dto: Partial<OrganizationSettings>): Promise<OrganizationSettings> {
    const settings = await this.getSettings(orgId);
    Object.assign(settings, dto);
    return this.settingsRepo.save(settings);
  }

  // ─── Дерево ієрархії ──────────────────────────────────────────────────────

  /**
   * Повертає дерево організацій від кореня.
   * Використовує рекурсивний CTE (Common Table Expression) PostgreSQL.
   */
  async getHierarchyTree(rootOrgId?: string): Promise<Organization[]> {
    const qb = this.orgRepo
      .createQueryBuilder('org')
      .leftJoinAndSelect('org.children', 'children')
      .leftJoinAndSelect('org.members', 'members')
      .leftJoinAndSelect('members.user', 'user');

    if (rootOrgId) {
      qb.where('org.id = :rootOrgId', { rootOrgId });
    } else {
      // Лише кореневі організації (без батька)
      qb.where('org.parent_org_id IS NULL');
    }

    return qb.getMany();
  }

  async findById(id: string): Promise<Organization> {
    const org = await this.orgRepo.findOne({
      where: { id },
      relations: ['members', 'members.user', 'children', 'hubs', 'settings', 'parent'],
    });
    if (!org) throw new NotFoundException('Організацію не знайдено');
    (org as any).parentOrg = org.parent
      ? { id: org.parent.id, name: org.parent.name, parentOrgId: org.parent.parentOrgId }
      : undefined;
    (org as any).ancestors = await this.getAncestors(org.parentOrgId);
    return org;
  }

  private async getAncestors(parentOrgId?: string | null): Promise<Array<{ id: string; name: string; parentOrgId?: string }>> {
    const ancestors: Array<{ id: string; name: string; parentOrgId?: string }> = [];
    let currentParentId = parentOrgId;

    while (currentParentId) {
      const parent = await this.orgRepo.findOne({
        where: { id: currentParentId },
        select: ['id', 'name', 'parentOrgId'],
      });
      if (!parent) break;

      ancestors.unshift({
        id: parent.id,
        name: parent.name,
        parentOrgId: parent.parentOrgId,
      });
      currentParentId = parent.parentOrgId;
    }

    return ancestors;
  }

  // ─── Управління учасниками ────────────────────────────────────────────────

  async addMember(
    orgId: string,
    targetUserId: string,
    role: OrgRole,
    requester: User,
  ): Promise<OrganizationMember> {
    await this.checkLeaderOrAdmin(orgId, requester);

    const existing = await this.memberRepo.findOne({
      where: { organizationId: orgId, userId: targetUserId },
    });
    if (existing) {
      throw new ConflictException('Користувач вже є учасником цієї організації');
    }

    return this.memberRepo.save({
      organizationId: orgId,
      userId: targetUserId,
      orgRole: role,
    });
  }

  async removeMember(orgId: string, targetUserId: string, requester: User): Promise<void> {
    await this.checkLeaderOrAdmin(orgId, requester);
    await this.memberRepo.delete({ organizationId: orgId, userId: targetUserId });
  }

  async getMember(orgId: string, userId: string): Promise<OrganizationMember | null> {
    return this.memberRepo.findOne({
      where: { organizationId: orgId, userId },
    });
  }

  async updateMemberRole(orgId: string, userId: string, role: OrgRole, isDeputy?: boolean): Promise<OrganizationMember> {
    const member = await this.getMember(orgId, userId);
    if (!member) throw new NotFoundException('Учасника не знайдено');
    member.orgRole = role;
    if (isDeputy !== undefined) {
      member.isDeputy = isDeputy;
    }
    // Якщо роль — лідер, deputy скидається
    if (role === OrgRole.LEADER) {
      member.isDeputy = false;
    }
    console.log('Updating member in DB:', { orgId, userId, role, isDeputy: member.isDeputy });
    return this.memberRepo.save(member);
  }

  async getMembers(orgId: string): Promise<OrganizationMember[]> {
    return this.memberRepo.find({
      where: { organizationId: orgId, isActive: true },
      relations: ['user'],
    });
  }

  async getOrganizationTasks(orgId: string, user: User): Promise<Task[]> {
    await this.ensureMemberOrAdmin(orgId, user);
    const delegations = await this.taskDelegationRepo.find({
      where: { organizationId: orgId },
      relations: ['task', 'task.request', 'task.assignments', 'task.delegations'],
      order: { createdAt: 'DESC' },
    });
    return delegations
      .filter((delegation) => delegation.task)
      .map((delegation) => ({
        ...delegation.task,
        delegations: [delegation],
      }))
      .filter(Boolean) as Task[];
  }

  async getOrganizationRequests(orgId: string, user: User): Promise<Request[]> {
    await this.ensureMemberOrAdmin(orgId, user);
    const [managedRequests, delegatedTasks] = await Promise.all([
      this.requestRepo.find({
        where: { managingOrganizationId: orgId },
        relations: ['tasks'],
        order: { createdAt: 'DESC' },
      }),
      this.getOrganizationTasks(orgId, user),
    ]);

    const byId = new Map<string, Request>();
    for (const request of managedRequests) byId.set(request.id, request);
    for (const task of delegatedTasks) {
      if ((task as any).request) byId.set((task as any).request.id, (task as any).request);
    }
    return Array.from(byId.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getMemberPrivileges(orgId: string, userId: string) {
    const member = await this.getMember(orgId, userId);
    const isLeader = member?.orgRole === OrgRole.LEADER;
    const isCoordinator = member?.orgRole === OrgRole.COORDINATOR;
    const isDeputy = member?.isDeputy ?? false;
    
    return {
      canEdit: isLeader || isCoordinator || isDeputy,
      canDelete: isLeader,
      canManageMembers: isLeader || isCoordinator || isDeputy,
      canManageHubs: isLeader || isCoordinator || isDeputy,
      isLeader,
      isCoordinator,
      isDeputy,
    };
  }

  // ─── Запити на вступ ───────────────────────────────────────────────────────

  async createJoinRequest(orgId: string, user: User, message?: string): Promise<OrganizationJoinRequest> {
    const org = await this.findById(orgId);
    const existing = await this.getMember(orgId, user.id);
    if (existing) throw new ConflictException('Ви вже є учасником цієї організації');

    const pending = await this.joinRequestRepo.findOne({
      where: { organizationId: orgId, userId: user.id, status: 'pending' as any },
    });
    if (pending) throw new ConflictException('Ви вже надіслали запит на вступ');

    return this.joinRequestRepo.save(
      this.joinRequestRepo.create({
        organizationId: orgId,
        userId: user.id,
        message,
      }),
    );
  }

  async getJoinRequests(orgId: string): Promise<OrganizationJoinRequest[]> {
    return this.joinRequestRepo.find({
      where: { organizationId: orgId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  async handleJoinRequest(
    requestId: string,
    approve: boolean,
    reviewer: User,
    comment?: string,
  ): Promise<void> {
    const request = await this.joinRequestRepo.findOne({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Запит не знайдено');
    if (request.status !== ('pending' as any)) throw new ConflictException('Запит вже оброблено');

    request.status = approve ? ('approved' as any) : ('rejected' as any);
    request.reviewedBy = reviewer;
    request.reviewComment = comment;
    request.reviewedAt = new Date();

    await this.joinRequestRepo.save(request);

    if (approve) {
      await this.memberRepo.save({
        organizationId: request.organizationId,
        userId: request.userId,
        orgRole: OrgRole.MEMBER,
      });
    }
  }

  // ─── Хаби / Склади ───────────────────────────────────────────────────────

  async createHub(
    orgId: string,
    dto: { name: string; description?: string; latitude?: number; longitude?: number; address?: string; isPublic?: boolean },
    creator: User,
  ): Promise<Hub> {
    await this.checkLeaderOrAdmin(orgId, creator);

    return this.hubRepo.save(
      this.hubRepo.create({
        ...dto,
        organizationId: orgId,
        ownerUserId: creator.id,
      }),
    );
  }

  async getHubs(orgId: string): Promise<Hub[]> {
    return this.hubRepo.find({ where: { organizationId: orgId }, order: { createdAt: 'DESC' } });
  }

  async updateHub(
    orgId: string,
    hubId: string,
    dto: Partial<{ name: string; description: string | null; latitude: number | null; longitude: number | null; address: string | null; isPublic: boolean; mediaUrl: string | null }>,
    requester: User,
  ): Promise<Hub> {
    await this.checkLeaderOrAdmin(orgId, requester);
    const hub = await this.hubRepo.findOne({ where: { id: hubId, organizationId: orgId } });
    if (!hub) throw new NotFoundException('Хаб не знайдено в цій організації');

    Object.assign(hub, dto);
    return this.hubRepo.save(hub);
  }

  async deleteHub(orgId: string, hubId: string, requester: User): Promise<void> {
    await this.checkLeaderOrAdmin(orgId, requester);
    const hub = await this.hubRepo.findOne({ where: { id: hubId, organizationId: orgId } });
    if (!hub) throw new NotFoundException('Хаб не знайдено в цій організації');
    await this.hubRepo.remove(hub);
  }

  /** Створити чат для існуючої організації (якщо його ще немає) */
  async createOrgChat(orgId: string, requester: User): Promise<Organization> {
    await this.checkLeaderOrAdmin(orgId, requester);
    const org = await this.findById(orgId);

    if (org.chatId) {
      throw new ConflictException('Чат для цієї організації вже існує');
    }

    const members = await this.memberRepo.find({
      where: { organizationId: orgId, isActive: true },
    });
    const participantIds = members.map((m) => m.userId);

    if (participantIds.length === 0) {
      // Якщо учасників немає — додаємо хоча б ініціатора
      participantIds.push(requester.id);
    }

    try {
      const chat = await this.chatService.createGroupChat(
        `Чат: ${org.name}`,
        participantIds,
        ChatType.ORG_CHAT,
        org.id,
      );
      org.chatId = chat.id;
      await this.orgRepo.save(org);
    } catch (e) {
      console.error(`[OrganizationsService] Failed to create org chat for ${orgId}:`, e);
      throw new InternalServerErrorException('Не вдалося створити чат організації');
    }

    return this.findById(orgId);
  }

  private async checkLeaderOrAdmin(orgId: string, user: User): Promise<void> {
    if (user.systemRole === SystemRole.ADMIN) return;

    const membership = await this.memberRepo.findOne({
      where: { organizationId: orgId, userId: user.id },
    });

    if (
      !membership ||
      (membership.orgRole !== OrgRole.LEADER &&
        membership.orgRole !== OrgRole.COORDINATOR)
    ) {
      throw new ForbiddenException(
        'Потрібні права лідера або координатора організації',
      );
    }
  }

  private async ensureMemberOrAdmin(orgId: string, user: User): Promise<void> {
    if (user.systemRole === SystemRole.ADMIN) return;
    const membership = await this.memberRepo.findOne({
      where: { organizationId: orgId, userId: user.id, isActive: true },
    });
    if (!membership) {
      throw new ForbiddenException('Потрібно бути учасником організації');
    }
  }
}
