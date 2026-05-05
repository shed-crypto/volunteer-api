import {
  Controller, Get, Post, Delete, Patch,
  Body, Param, UseGuards, Query,
  ParseUUIDPipe, HttpCode, HttpStatus,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
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

function ensureUploadDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
  return path;
}

function randomFileName(originalName: string) {
  const randomName = Array(32).fill(null).map(() => (Math.round(Math.random() * 16)).toString(16)).join('');
  return `${randomName}${extname(originalName)}`;
}

function imageFileFilter(req: unknown, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) {
  if (!file.mimetype?.startsWith('image/')) {
    cb(new BadRequestException('Можна завантажувати тільки зображення'), false);
    return;
  }
  cb(null, true);
}

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
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-90) @Max(90) @Type(() => Number) latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-180) @Max(180) @Type(() => Number) longitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublic?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() mediaUrl?: string | null;
}

class UpdateHubDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-90) @Max(90) @Type(() => Number) latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-180) @Max(180) @Type(() => Number) longitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublic?: boolean;
}

class UpdateOrgDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() logoUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() bannerUrl?: string | null;
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

  @Get(':id/members/me/privileges')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Отримати мої права в організації' })
  getMyPrivileges(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.orgsService.getMemberPrivileges(id, user.id);
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

  @Patch(':id/members/:userId/role')
  @UseGuards(OrganizationRoleGuard)
  @Roles(OrgRole.LEADER)
  @ApiOperation({ summary: 'Змінити роль учасника' })
  updateMemberRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body('role') role: OrgRole,
    @Body('isDeputy') isDeputy: boolean,
  ) {
    return this.orgsService.updateMemberRole(id, userId, role, isDeputy);
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

  @Patch(':id/hubs/:hubId')
  @UseGuards(OrganizationRoleGuard)
  @Roles(OrgRole.LEADER, OrgRole.COORDINATOR)
  @ApiOperation({ summary: 'Р РµРґР°РіСѓРІР°С‚Рё СЃРєР»Р°Рґ/С…Р°Р±' })
  updateHub(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('hubId', ParseUUIDPipe) hubId: string,
    @Body() dto: UpdateHubDto,
    @CurrentUser() user: User,
  ): Promise<Hub> {
    return this.orgsService.updateHub(id, hubId, dto, user);
  }

  @Post(':id/hubs/:hubId/upload-media')
  @UseGuards(OrganizationRoleGuard)
  @Roles(OrgRole.LEADER, OrgRole.COORDINATOR)
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (req, file, cb) => cb(null, ensureUploadDir('./uploads/hubs')),
      filename: (req, file, cb) => cb(null, randomFileName(file.originalname)),
    }),
    fileFilter: imageFileFilter,
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  async uploadHubMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('hubId', ParseUUIDPipe) hubId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
  ) {
    if (!file) throw new BadRequestException('Файл не передано');
    const url = `/uploads/hubs/${file.filename}`;
    await this.orgsService.updateHub(id, hubId, { mediaUrl: url }, user);
    return { url };
  }

  @Delete(':id/hubs/:hubId')
  @UseGuards(OrganizationRoleGuard)
  @Roles(OrgRole.LEADER, OrgRole.COORDINATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Видалити склад/хаб' })
  deleteHub(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('hubId', ParseUUIDPipe) hubId: string,
    @CurrentUser() user: User,
  ) {
    return this.orgsService.deleteHub(id, hubId, user);
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

  @Delete(':id')
  @UseGuards(OrganizationRoleGuard)
  @Roles(OrgRole.LEADER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Видалити організацію' })
  delete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.orgsService.delete(id, user);
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Покинути організацію' })
  leave(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.orgsService.leave(id, user);
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
  async updateSettings(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrgSettingsDto) {
    console.log(`[OrganizationsController] Updating settings for ${id}, data:`, JSON.stringify(dto));
    try {
      return await this.orgsService.updateSettings(id, dto);
    } catch (e) {
      console.error(`[OrganizationsController] Error updating settings:`, e);
      throw e;
    }
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

  @Post(':id/upload-logo')
  @UseGuards(OrganizationRoleGuard)
  @Roles(OrgRole.LEADER)
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (req, file, cb) => cb(null, ensureUploadDir('./uploads/organizations')),
      filename: (req, file, cb) => cb(null, randomFileName(file.originalname)),
    }),
    fileFilter: imageFileFilter,
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  async uploadLogo(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Файл не передано');
    const url = `/uploads/organizations/${file.filename}`;
    await this.orgsService.update(id, { logoUrl: url });
    return { url };
  }

  @Post(':id/upload-banner')
  @UseGuards(OrganizationRoleGuard)
  @Roles(OrgRole.LEADER)
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (req, file, cb) => cb(null, ensureUploadDir('./uploads/organizations')),
      filename: (req, file, cb) => cb(null, randomFileName(file.originalname)),
    }),
    fileFilter: imageFileFilter,
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  async uploadBanner(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Файл не передано');
    const url = `/uploads/organizations/${file.filename}`;
    await this.orgsService.update(id, { bannerUrl: url });
    return { url };
  }
}
