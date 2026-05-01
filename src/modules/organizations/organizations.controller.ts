import {
  Controller, Get, Post, Delete, Patch,
  Body, Param, UseGuards, Query,
  ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsUUID, IsEnum,
  IsNumber, Min, Max, MaxLength, IsBoolean,
} from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { OrganizationRoleGuard } from '@common/guards/organization-role.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { User } from '@modules/users/entities/user.entity';
import { Organization } from './entities/organization.entity';
import { OrganizationMember } from './entities/organization-member.entity';
import { Hub } from './entities/hub.entity';
import { OrgRole } from '@common/enums';

// ─── Вбудовані DTO (невеликі класи зберігаємо тут для лаконічності) ──────────

class CreateOrgDto {
  @ApiProperty() @IsString() @MaxLength(255) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentOrgId?: string;
}

class AddMemberDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiProperty({ enum: OrgRole }) @IsEnum(OrgRole) role: OrgRole;
}

class CreateHubDto {
  @ApiProperty() @IsString() @MaxLength(255) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiProperty() @IsNumber() @Min(-90) @Max(90) @Type(() => Number) latitude: number;
  @ApiProperty() @IsNumber() @Min(-180) @Max(180) @Type(() => Number) longitude: number;
}

class UpdateOrgDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}

class UpdateOrgSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowPublicJoin?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireJoinApproval?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() memberInviteAllowed?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() subgroupCreationAllowed?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() mediaUploadAllowed?: boolean;
}

// ─── Контролер ────────────────────────────────────────────────────────────────

@ApiTags('Організації')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgsService: OrganizationsService) {}

  @Post()
  @ApiOperation({ summary: 'Створити організацію або підгрупу' })
  create(
    @Body() dto: CreateOrgDto,
    @CurrentUser() user: User,
  ): Promise<Organization> {
    return this.orgsService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'Дерево кореневих організацій' })
  findAll(): Promise<Organization[]> {
    return this.orgsService.getHierarchyTree();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Деталі організації з учасниками та підгрупами' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Organization> {
    return this.orgsService.findById(id);
  }

  @Get(':id/tree')
  @ApiOperation({ summary: 'Повне дерево підгруп від заданої організації' })
  getTree(@Param('id', ParseUUIDPipe) id: string): Promise<Organization[]> {
    return this.orgsService.getHierarchyTree(id);
  }

  // ─── Учасники ─────────────────────────────────────────────────────────────

  @Get(':id/members')
  @ApiOperation({ summary: 'Учасники організації' })
  getMembers(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrganizationMember[]> {
    return this.orgsService.getMembers(id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Додати учасника до організації' })
  addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() user: User,
  ): Promise<OrganizationMember> {
    return this.orgsService.addMember(id, dto.userId, dto.role, user);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Видалити учасника з організації' })
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.orgsService.removeMember(id, userId, user);
  }

  // ─── Хаби / Склади ────────────────────────────────────────────────────────

  @Get(':id/hubs')
  @ApiOperation({ summary: 'Склади/хаби організації' })
  getHubs(@Param('id', ParseUUIDPipe) id: string): Promise<Hub[]> {
    return this.orgsService.getHubs(id);
  }

  @Post(':id/hubs')
  @ApiOperation({ summary: 'Додати склад/хаб до організації' })
  createHub(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateHubDto,
    @CurrentUser() user: User,
  ): Promise<Hub> {
    return this.orgsService.createHub(id, dto, user);
  }

  // ─── Нові ендпоінти ────────────────────────────────────────────────────────

  @Get('search/query')
  @ApiOperation({ summary: 'Пошук організацій' })
  search(@Query('q') q: string) {
    return this.orgsService.search(q);
  }

  @Patch(':id')
  @UseGuards(OrganizationRoleGuard)
  @Roles(OrgRole.LEADER)
  @ApiOperation({ summary: 'Редагувати організацію' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrgDto) {
    return this.orgsService.update(id, dto);
  }

  @Get(':id/settings')
  @UseGuards(OrganizationRoleGuard)
  @Roles(OrgRole.LEADER, OrgRole.COORDINATOR)
  getSettings(@Param('id', ParseUUIDPipe) id: string) {
    return this.orgsService.getSettings(id);
  }

  @Patch(':id/settings')
  @UseGuards(OrganizationRoleGuard)
  @Roles(OrgRole.LEADER)
  updateSettings(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrgSettingsDto) {
    return this.orgsService.updateSettings(id, dto);
  }

  @Post(':id/join')
  @ApiOperation({ summary: 'Запит на вступ' })
  join(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @Body('message') message?: string) {
    return this.orgsService.createJoinRequest(id, user, message);
  }

  @Get(':id/join-requests')
  @UseGuards(OrganizationRoleGuard)
  @Roles(OrgRole.LEADER, OrgRole.COORDINATOR)
  getRequests(@Param('id', ParseUUIDPipe) id: string) {
    return this.orgsService.getJoinRequests(id);
  }

  @Post(':id/join-requests/:requestId/approve')
  @UseGuards(OrganizationRoleGuard)
  @Roles(OrgRole.LEADER, OrgRole.COORDINATOR)
  approveRequest(@Param('id') id: string, @Param('requestId') reqId: string, @CurrentUser() user: User, @Body('comment') comment?: string) {
    return this.orgsService.handleJoinRequest(reqId, true, user, comment);
  }

  @Post(':id/join-requests/:requestId/reject')
  @UseGuards(OrganizationRoleGuard)
  @Roles(OrgRole.LEADER, OrgRole.COORDINATOR)
  rejectRequest(@Param('id') id: string, @Param('requestId') reqId: string, @CurrentUser() user: User, @Body('comment') comment?: string) {
    return this.orgsService.handleJoinRequest(reqId, false, user, comment);
  }
}
