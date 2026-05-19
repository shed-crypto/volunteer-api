import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Request } from './entities/request.entity';
import { SavedRequest } from './entities/saved-request.entity';
import { AccessLog, AccessAction } from './entities/access-log.entity';
import { User } from '@modules/users/entities/user.entity';
import {
  RequestStatus,
  ClearanceLevel,
  SystemRole,
  AssignmentStatus,
} from '@common/enums';
import { CreateRequestDto, AddInfoRequestDto } from './dto/create-request.dto';
import { UpdateRequestDto } from './dto/update-request.dto';
import { FindRequestsDto } from './dto/find-requests.dto';

/** Радіус обфускування координат у метрах (з env або 3 км за замовчуванням) */
const OBFUSCATION_RADIUS_M = parseInt(
  process.env.LOCATION_OBFUSCATION_RADIUS_M || '3000',
  10,
);

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  '#Медицина': ['медик', 'лікар', 'аптека', 'ліки', 'перев\'язка', 'медична'],
  '#Евакуація': ['евакуація', 'евакуювати', 'вивезти', 'виїхати', 'перевезти'],
  '#Термінова': ['терміново', 'критично', 'негайно'],
  '#Продовольство': ['їжа', 'продукти', 'харчування', 'вода'],
  '#Логістика': ['доставка', 'перевезення', 'транспорт'],
  '#Військо': ['армія', 'зсу', 'підрозділ', 'бойовий', 'фронт'],
};

@Injectable()
export class RequestsService {
  constructor(
    @InjectRepository(Request)
    private readonly requestRepository: Repository<Request>,
    @InjectRepository(SavedRequest)
    private readonly savedRequestRepository: Repository<SavedRequest>,
    @InjectRepository(AccessLog)
    private readonly accessLogRepository: Repository<AccessLog>,
  ) {}

  // ─── Створення заявки ─────────────────────────────────────────────────────

  async create(dto: CreateRequestDto, creator: User): Promise<Request> {
    const tags = this.autoCategorizeTags(dto.title + ' ' + (dto.description || ''));

    const request = this.requestRepository.create({
      ...dto,
      creatorId: creator.id,
      tags,
    });

    const saved = await this.requestRepository.save(request);

    if (dto.latitude != null && dto.longitude != null) {
      await this.requestRepository.query(
        `UPDATE requests
         SET exact_location = ST_SetSRID(ST_MakePoint($1, $2), 4326)
         WHERE id = $3`,
        [dto.longitude, dto.latitude, saved.id],
      );
    }

    return saved;
  }

  // ─── Список заявок ────────────────────────────────────────────────────────

  async findAll(dto: FindRequestsDto, requester: User): Promise<(Request & { isSaved?: boolean })[]> {
    const qb = this.requestRepository
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.creator', 'creator')
      .leftJoinAndSelect('request.tasks', 'tasks')
      .where('request.deleted_at IS NULL');

    if (dto.status)    qb.andWhere('request.status = :status',     { status: dto.status });
    if (dto.category)  qb.andWhere('request.category = :category', { category: dto.category });
    if (dto.urgency)   qb.andWhere('request.urgency = :urgency',   { urgency: dto.urgency });
    if (dto.creatorId) qb.andWhere('request.creatorId = :creatorId', { creatorId: dto.creatorId });
    if (dto.excludeCreatorId) {
      qb.andWhere('request.creatorId != :excludeCreatorId', { excludeCreatorId: dto.excludeCreatorId });
    }

    if (dto.search) {
      qb.andWhere(
        '(request.title ILIKE :search OR request.description ILIKE :search)',
        { search: `%${dto.search}%` },
      );
    }

    const userClearanceRank = this.getClearanceRank(requester.clearanceLevel);
    if (requester.systemRole !== SystemRole.ADMIN) {
      qb.andWhere(
        `CASE request.required_clearance
          WHEN 'local' THEN 0
          WHEN 'international' THEN 1
          WHEN 'frontline' THEN 2
         END <= :userRank`,
        { userRank: userClearanceRank },
      );
    }

    if (dto.latitude != null && dto.longitude != null && dto.radiusKm) {
      const radiusM = dto.radiusKm * 1000;
      qb.andWhere(
        `request.exact_location IS NOT NULL AND
         ST_DWithin(
           request.exact_location::geography,
           ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
           :radius
         )`,
        { lat: dto.latitude, lng: dto.longitude, radius: radiusM },
      );
      qb.orderBy(
        `ST_Distance(
          request.exact_location::geography,
          ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
        )`,
        'ASC',
      );
    } else {
      qb.orderBy('request.created_at', 'DESC');
    }

    qb.limit(dto.limit || 50).offset(dto.offset || 0);

    const requests = await qb.getMany();

    const savedRequestIds = new Set(
      (await this.savedRequestRepository.find({
        where: { userId: requester.id },
        select: ['requestId'],
      })).map(s => s.requestId)
    );

    return requests.map((r) => {
      const obfuscated = this.obfuscateLocation(r, requester);
      return { ...obfuscated, isSaved: savedRequestIds.has(r.id) };
    });
  }

  // ─── Деталі заявки ────────────────────────────────────────────────────────

  async findOne(id: string, requester: User): Promise<Request & { isSaved?: boolean }> {
    const request = await this.requestRepository
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.creator', 'creator')
      .leftJoinAndSelect('request.tasks', 'tasks')
      .leftJoinAndSelect('tasks.assignments', 'assignments')
      .leftJoinAndSelect('assignments.user', 'assignmentUser')
      .where('request.id = :id', { id })
      .getOne();

    if (!request) throw new NotFoundException(`Заявку ${id} не знайдено`);

    this.checkClearanceAccess(request, requester);

    const obfuscated = this.obfuscateLocation(request, requester);

    const isSaved = await this.savedRequestRepository.exists({
      where: { requestId: id, userId: requester.id }
    });

    // Логування доступу для FRONTLINE заявок (крім власника)
    this.logAccess(request, requester, 'view_detail');

    return {
      ...obfuscated,
      isSaved,
    };
  }

  // ─── Оновлення ────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateRequestDto, requester: User): Promise<Request> {
    const request = await this.requestRepository.findOne({
      where: { id },
      relations: ['tasks', 'tasks.assignments'],
    });
    if (!request) throw new NotFoundException(`Заявку ${id} не знайдено`);

    if (request.creatorId !== requester.id && requester.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Немає прав для редагування цієї заявки');
    }

    const hasActiveAssignments = request.tasks?.some((task) =>
      task.assignments?.some((a) => a.status !== AssignmentStatus.WITHDRAWN),
    );

    if (hasActiveAssignments && requester.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException(
        'Не можна редагувати заявку, яку вже взяли в роботу волонтери.',
      );
    }

    if (dto.mediaUrls) {
      const existing = request.mediaUrls || [];
      const newUrls = ((dto as any).mediaUrls as typeof request.mediaUrls) || [];
      request.mediaUrls = [...existing, ...newUrls];
    }

    Object.assign(request, { ...dto, mediaUrls: request.mediaUrls });

    if (dto.title || dto.description) {
      request.tags = this.autoCategorizeTags(
        (dto.title || request.title) + ' ' + (dto.description || request.description || ''),
      );
    }

    const saved = await this.requestRepository.save(request);

    const lat = (dto as any).latitude ?? request.latitude;
    const lng = (dto as any).longitude ?? request.longitude;
    if (lat != null && lng != null) {
      await this.requestRepository.query(
        `UPDATE requests SET exact_location = ST_SetSRID(ST_MakePoint($1, $2), 4326) WHERE id = $3`,
        [lng, lat, id],
      );
    }

    return saved;
  }

  async addInfo(id: string, dto: AddInfoRequestDto, requester: User): Promise<Request> {
    const request = await this.requestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`Заявку ${id} не знайдено`);

    if (request.creatorId !== requester.id && requester.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Тільки власник або адміністратор може доповнювати інформацію');
    }

    if (!request.additionalInfo) request.additionalInfo = [];
    request.additionalInfo.push({
      id: uuidv4(),
      text: dto.text,
      attachments: dto.attachments || [],
      createdAt: new Date(),
    });

    return await this.requestRepository.save(request);
  }

  async updateAdditionalInfo(
    id: string,
    infoId: string,
    dto: AddInfoRequestDto,
    requester: User,
  ): Promise<Request> {
    const request = await this.requestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`Заявку ${id} не знайдено`);

    if (request.creatorId !== requester.id && requester.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Тільки власник або адміністратор може редагувати доповнення');
    }

    const infoIndex = request.additionalInfo.findIndex((info) => info.id === infoId);
    if (infoIndex === -1) throw new NotFoundException(`Доповнення не знайдено`);

    const info = request.additionalInfo[infoIndex];

    if (requester.systemRole !== SystemRole.ADMIN) {
      const now = new Date();
      const createdAt = new Date(info.createdAt);
      const diffMs = now.getTime() - createdAt.getTime();
      const diffMins = diffMs / (1000 * 60);

      if (diffMins > 30) {
        throw new ForbiddenException('Редагування можливе лише протягом 30 хвилин після створення');
      }
    }

    const keptAttachments = dto.removedAttachments?.length
      ? (info.attachments || []).filter((a: any) => !dto.removedAttachments!.includes(a.url))
      : info.attachments || [];
    request.additionalInfo[infoIndex] = {
      ...info,
      text: dto.text,
      attachments: dto.attachments?.length ? [...keptAttachments, ...dto.attachments] : keptAttachments,
      updatedAt: new Date(),
    };

    return await this.requestRepository.save(request);
  }

  async removeAdditionalInfo(id: string, infoId: string, requester: User): Promise<Request> {
    const request = await this.requestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`Заявку ${id} не знайдено`);

    if (request.creatorId !== requester.id && requester.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Тільки власник або адміністратор може видаляти доповнення');
    }

    const infoIndex = request.additionalInfo.findIndex((info) => info.id === infoId);
    if (infoIndex === -1) throw new NotFoundException(`Доповнення не знайдено`);

    const info = request.additionalInfo[infoIndex];

    if (requester.systemRole !== SystemRole.ADMIN) {
      const now = new Date();
      const createdAt = new Date(info.createdAt);
      const diffMs = now.getTime() - createdAt.getTime();
      const diffMins = diffMs / (1000 * 60);

      if (diffMins > 30) {
        throw new ForbiddenException('Видалення можливе лише протягом 30 хвилин після створення');
      }
    }

    request.additionalInfo.splice(infoIndex, 1);
    return await this.requestRepository.save(request);
  }

  // ─── Видалення ────────────────────────────────────────────────────────────

  async remove(id: string, requester: User): Promise<void> {
    const request = await this.requestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`Заявку ${id} не знайдено`);

    if (request.creatorId !== requester.id && requester.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Немає прав для видалення цієї заявки');
    }

    await this.requestRepository.softDelete(id);
  }

  // ─── Saved Requests ────────────────────────────────────────────────────────
  async saveRequest(requestId: string, userId: string): Promise<void> {
    const exists = await this.savedRequestRepository.findOne({ where: { requestId, userId } });
    if (!exists) {
      const saved = this.savedRequestRepository.create({ requestId, userId });
      await this.savedRequestRepository.save(saved);
    }
  }

  async unsaveRequest(requestId: string, userId: string): Promise<void> {
    await this.savedRequestRepository.delete({ requestId, userId });
  }

  async getSavedRequests(userId: string, limit: number = 50, offset: number = 0): Promise<Request[]> {
    const saved = await this.savedRequestRepository.find({
      where: { userId },
      relations: ['request'],
      take: limit,
      skip: offset,
      order: { savedAt: 'DESC' },
    });
    return saved.map((s) => ({
      ...s.request,
      isSaved: true,
    }));
  }

  async getSavedRequestIds(userId: string): Promise<string[]> {
    const savedRequests = await this.savedRequestRepository.find({
      where: { userId },
      select: ['requestId'],
    });
    return savedRequests.map((r) => r.requestId);
  }

  async getMyRequests(
    creatorId: string,
    options: { limit: number; offset: number },
  ): Promise<any[]> {
    const [requests, total] = await this.requestRepository.findAndCount({
      where: { creatorId },
      order: { createdAt: 'DESC' },
      skip: options.offset,
      take: options.limit,
      relations: ['subTasks'],
    });

    return requests.map((r) => {
      return {
        ...r,
        _meta: { total },
      };
    });
  }

  async getRequestsWithPriority(params: {
    userId?: string;
    userLat?: number;
    userLng?: number;
    limit?: number;
    offset?: number;
    search?: string;
    status?: string;
    urgency?: string;
    category?: string;
    excludeCreatorId?: string;
  }): Promise<any[]> {
    const { userId, userLat, userLng, limit = 20, offset = 0, search, status, urgency, category, excludeCreatorId } = params;

    const query = this.requestRepository
      .createQueryBuilder('req')
      .leftJoinAndSelect('req.creator', 'creator')
      .where('req.deleted_at IS NULL');

    if (status)       query.andWhere('req.status = :status', { status });
    if (urgency)      query.andWhere('req.urgency = :urgency', { urgency });
    if (category)     query.andWhere('req.category = :category', { category });
    if (excludeCreatorId) query.andWhere('req.creatorId != :excludeCreatorId', { excludeCreatorId });

    if (search) {
      query.andWhere(
        '(req.title ILIKE :search OR req.description ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (userLat != null && userLng != null) {
      query.addSelect(
        `ST_Distance(
          req.exact_location::geography,
          ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
        )`,
        'distance',
      );
      query.setParameter('lat', userLat);
      query.setParameter('lng', userLng);
      query.orderBy('distance', 'ASC');
    } else {
      query.orderBy('req.created_at', 'DESC');
    }

    query.skip(offset).take(limit);

    return query.getMany();
  }

  // ─── Статусні операції ─────────────────────────────────────────────────

  async markAsPendingReview(id: string, user: User): Promise<Request> {
    const request = await this.requestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`Заявку ${id} не знайдено`);

    if (request.creatorId !== user.id && user.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Тільки власник або адмін може змінити статус');
    }

    request.status = RequestStatus.PENDING_REVIEW;
    return this.requestRepository.save(request);
  }

  async confirmCompletion(id: string, user: User): Promise<Request> {
    const request = await this.requestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`Заявку ${id} не знайдено`);

    if (request.creatorId !== user.id && user.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Тільки власник або адмін може підтвердити виконання');
    }

    request.status = RequestStatus.COMPLETED;
    return this.requestRepository.save(request);
  }

  async returnToProgress(id: string, user: User): Promise<Request> {
    const request = await this.requestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`Заявку ${id} не знайдено`);

    if (request.creatorId !== user.id && user.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Тільки власник або адмін може повернути в роботу');
    }

    request.status = RequestStatus.IN_PROGRESS;
    return this.requestRepository.save(request);
  }

  // ─── Приватні методи ────────────────────────────────────────────────────

  private autoCategorizeTags(text: string): string[] {
    const lower = text.toLowerCase();
    const tags: string[] = [];

    for (const [tag, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some((kw) => lower.includes(kw))) {
        tags.push(tag);
      }
    }

    return tags;
  }

  private getClearanceRank(level: ClearanceLevel): number {
    switch (level) {
      case ClearanceLevel.LOCAL:        return 0;
      case ClearanceLevel.INTERNATIONAL: return 1;
      case ClearanceLevel.FRONTLINE:    return 2;
      default:                          return 0;
    }
  }

  private obfuscateLocation(request: Request, viewer: User): Request {
    if (viewer.clearanceLevel === ClearanceLevel.FRONTLINE || viewer.systemRole === SystemRole.ADMIN) {
      return request; // без обфускації
    }

    if (!request.latitude || !request.longitude) return request;

    // Додаємо випадкове зміщення в межах OBFUSCATION_RADIUS_M
    const angle = Math.random() * 2 * Math.PI;
    const offsetMeters = Math.random() * OBFUSCATION_RADIUS_M;
    const earthRadius = 6371000;

    const latOffset = (offsetMeters / earthRadius) * (180 / Math.PI);
    const lngOffset =
      (offsetMeters / earthRadius) * (180 / Math.PI) / Math.cos((request.latitude * Math.PI) / 180);

    return {
      ...request,
      latitude: request.latitude + Math.cos(angle) * latOffset,
      longitude: request.longitude + Math.sin(angle) * lngOffset,
    };
  }

  private checkClearanceAccess(request: Request, user: User): void {
    const clearanceRank = this.getClearanceRank(user.clearanceLevel);
    const requiredRank = this.getClearanceRank(
      (request as any).requiredClearance || ClearanceLevel.LOCAL,
    );

    if (
      user.systemRole !== SystemRole.ADMIN &&
      user.systemRole !== SystemRole.COORDINATOR &&
      clearanceRank < requiredRank
    ) {
      throw new ForbiddenException('Недостатній рівень допуску для перегляду цієї заявки');
    }
  }

  private async logAccess(
    request: Request,
    user: User,
    action: AccessAction,
  ): Promise<void> {
    // Логуємо тільки FRONTLINE заявки, і тільки коли користувач не є власником
    const requiredClearance = (request as any).requiredClearance;
    if (requiredClearance !== ClearanceLevel.FRONTLINE) return;
    if (request.creatorId === user.id) return;

    try {
      await this.accessLogRepository.save({
        userId: user.id,
        requestId: request.id,
        action,
        clearanceAtAccess: user.clearanceLevel,
      });
    } catch (err) {
      // Логування не повинно блокувати основний запит
      console.error('[AccessLog] Failed to log access:', err);
    }
  }
}
