import {
  Controller, Get, Post, Delete,
  Body, Param, UseGuards,
  ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsUUID, IsEnum,
  IsNumber, Min, Max, MaxLength,
} from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
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
}
