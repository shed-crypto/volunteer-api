import { SetMetadata } from '@nestjs/common';
import { OrgRole } from '@common/enums';

export const Roles = (...roles: OrgRole[]) => SetMetadata('roles', roles);