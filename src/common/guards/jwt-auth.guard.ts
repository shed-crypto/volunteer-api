import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { SystemRole, ClearanceLevel } from '@common/enums';

// ─── JWT Guard ───────────────────────────────────────────────────────────────

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

// ─── Roles Guard ─────────────────────────────────────────────────────────────

export const ROLES_KEY = 'roles';
export const Roles = (...roles: SystemRole[]) =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@nestjs/common').SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<SystemRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    const hasRole = requiredRoles.includes(user.systemRole);
    if (!hasRole) {
      throw new ForbiddenException(
        `Доступ заборонено. Потрібна роль: ${requiredRoles.join(' або ')}`,
      );
    }
    return true;
  }
}

// ─── Clearance Guard ──────────────────────────────────────────────────────────

export const CLEARANCE_KEY = 'clearance';
export const RequiredClearance = (level: ClearanceLevel) =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@nestjs/common').SetMetadata(CLEARANCE_KEY, level);

const CLEARANCE_RANK: Record<ClearanceLevel, number> = {
  [ClearanceLevel.LOCAL]: 0,
  [ClearanceLevel.INTERNATIONAL]: 1,
  [ClearanceLevel.FRONTLINE]: 2,
};

@Injectable()
export class ClearanceGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ClearanceLevel>(
      CLEARANCE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    const userRank = CLEARANCE_RANK[user.clearanceLevel] ?? 0;
    const requiredRank = CLEARANCE_RANK[required] ?? 0;

    if (userRank < requiredRank) {
      throw new ForbiddenException(
        `Недостатній рівень допуску. Потрібний: ${required}`,
      );
    }
    return true;
  }
}
