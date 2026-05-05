import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationsService } from '@modules/organizations/organizations.service';
import { OrgRole, SystemRole } from '@common/enums';

@Injectable()
export class OrganizationRoleGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private orgsService: OrganizationsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const orgId = request.params.id;

    if (!user || !orgId) return false;
    if (user.systemRole === SystemRole.ADMIN) return true;

    const membership = await this.orgsService.getMember(orgId, user.id);
    if (!membership) throw new ForbiddenException('Ви не є учасником цієї організації');

    const requiredRoles = this.reflector.get<OrgRole[]>('roles', context.getHandler());
    
    // Якщо вимагається роль ЛІДЕРА, дозволяємо також заступникам (якщо це не видалення/передача лідерства)
    if (requiredRoles?.includes(OrgRole.LEADER) && membership.isDeputy) {
      // Додаткова логіка: заступники не можуть видаляти організацію або передавати лідерство
      const path = request.route.path;
      if (!path.includes('delete') && !path.includes('transfer')) {
        return true;
      }
    }

    if (requiredRoles && !requiredRoles.includes(membership.orgRole)) {
      throw new ForbiddenException('Недостатньо прав для виконання цієї дії');
    }

    return true;
  }
}