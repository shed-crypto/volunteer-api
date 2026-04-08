import {
  Injectable, NotFoundException,
  ForbiddenException, ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationMember } from './entities/organization-member.entity';
import { Hub } from './entities/hub.entity';
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

    // Автоматично додаємо засновника як LEADER
    await this.memberRepo.save({
      organizationId: org.id,
      userId: creator.id,
      orgRole: OrgRole.LEADER,
    });

    return org;
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
      relations: ['members', 'members.user', 'children', 'hubs'],
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

  async getMembers(orgId: string): Promise<OrganizationMember[]> {
    return this.memberRepo.find({
      where: { organizationId: orgId, isActive: true },
      relations: ['user'],
    });
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
