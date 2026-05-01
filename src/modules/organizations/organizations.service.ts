import {
  Injectable, NotFoundException,
  ForbiddenException, ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationMember } from './entities/organization-member.entity';
import { Hub } from './entities/hub.entity';
import { OrganizationSettings } from './entities/organization-settings.entity';
import { OrganizationJoinRequest } from './entities/organization-join-request.entity';
import { User } from '@modules/users/entities/user.entity';
import { OrgRole, SystemRole } from '@common/enums';

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
      relations: ['members', 'members.user', 'children', 'hubs', 'settings'],
    });
    if (!org) throw new NotFoundException('Організацію не знайдено');
    return org;
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

  async updateMemberRole(orgId: string, userId: string, role: OrgRole): Promise<OrganizationMember> {
    const member = await this.getMember(orgId, userId);
    if (!member) throw new NotFoundException('Учасника не знайдено');
    member.orgRole = role;
    return this.memberRepo.save(member);
  }

  async getMembers(orgId: string): Promise<OrganizationMember[]> {
    return this.memberRepo.find({
      where: { organizationId: orgId, isActive: true },
      relations: ['user'],
    });
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
    dto: { name: string; description?: string; latitude: number; longitude: number; address?: string },
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
    return this.hubRepo.find({ where: { organizationId: orgId } });
  }

  // ─── Перевірка прав ──────────────────────────────────────────────────────

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
}
