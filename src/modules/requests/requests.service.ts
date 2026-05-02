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
  ) {}

  // ─── Створення заявки ─────────────────────────────────────────────────────
  //
  // БАГ-ФІКс: exactLocation (PostGIS geometry) ніколи не встановлювалось.
  // TypeORM не вміє автоматично конвертувати latitude/longitude у PostGIS Point.
  // Рішення: зберігаємо заявку, потім окремим raw-запитом встановлюємо exactLocation.
  // Це потрібно щоб ST_DWithin геопошук на карті працював коректно.

  async create(dto: CreateRequestDto, creator: User): Promise<Request> {
    const tags = this.autoCategorizeTags(dto.title + ' ' + (dto.description || ''));

    const request = this.requestRepository.create({
      ...dto,
      creatorId: creator.id,
      tags,
    });

    const saved = await this.requestRepository.save(request);

    // БАГ-ФІКс: встановити PostGIS поле exactLocation через raw SQL
    // TypeORM не підтримує geometry insert безпосередньо через create()
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

  async findAll(dto: FindRequestsDto, requester: User): Promise<Request[]> {
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

    // FR-08: фільтр за clearance
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

    // Геопошук — тільки якщо exact_location встановлено (не null)
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
    return requests.map((r) => this.obfuscateLocation(r, requester));
  }

  // ─── Деталі заявки ────────────────────────────────────────────────────────

  async findOne(id: string, requester: User): Promise<Request> {
    const request = await this.requestRepository.findOne({
      where: { id },
      relations: ['creator', 'tasks', 'tasks.assignments', 'tasks.assignments.user'],
    });

    if (!request) throw new NotFoundException(`Заявку ${id} не знайдено`);

    this.checkClearanceAccess(request, requester);
    return this.obfuscateLocation(request, requester);
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

    // FR-09: обмеження редагування — не можна редагувати якщо хтось уже взяв у роботу
    const hasActiveAssignments = request.tasks?.some((task) =>
      task.assignments?.some((a) => a.status !== AssignmentStatus.WITHDRAWN),
    );

    if (hasActiveAssignments && requester.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException(
        'Не можна редагувати заявку, яку вже взяли в роботу волонтери. Додайте інформацію через коментарі або чат.',
      );
    }

    Object.assign(request, dto);

    if (dto.title || dto.description) {
      request.tags = this.autoCategorizeTags(
        (dto.title || request.title) + ' ' + (dto.description || request.description || ''),
      );
    }

    const saved = await this.requestRepository.save(request);

    // Оновлення PostGIS точки якщо координати змінились
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

    // Перевірка 30 хвилин для не-адмінів
    if (requester.systemRole !== SystemRole.ADMIN) {
      const now = new Date();
      const createdAt = new Date(info.createdAt);
      const diffMs = now.getTime() - createdAt.getTime();
      const diffMins = diffMs / (1000 * 60);

      if (diffMins > 30) {
        throw new ForbiddenException('Редагування можливе лише протягом 30 хвилин після створення');
      }
    }

    request.additionalInfo[infoIndex] = {
      ...info,
      text: dto.text,
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

    // Перевірка 30 хвилин для не-адмінів
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
    return saved.map((s) => s.request);
  }

  // ─── Життєвий цикл (Request Lifecycle) ──────────────────────────────────────

  async markAsPendingReview(id: string, requester: User): Promise<Request> {
    const request = await this.requestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`Заявку ${id} не знайдено`);

    // Будь-який волонтер, що працює над заявкою (чи власник), може відправити на перевірку
    request.status = RequestStatus.PENDING_REVIEW;
    return await this.requestRepository.save(request);
  }

  async confirmCompletion(id: string, requester: User): Promise<Request> {
    const request = await this.requestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`Заявку ${id} не знайдено`);

    if (request.creatorId !== requester.id && requester.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Тільки власник або адміністратор може підтвердити виконання');
    }

    request.status = RequestStatus.COMPLETED;
    return await this.requestRepository.save(request);
  }

  async returnToProgress(id: string, requester: User): Promise<Request> {
    if (requester.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Тільки адміністратор може скасувати перевірку');
    }

    const request = await this.requestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`Заявку ${id} не знайдено`);

    request.status = RequestStatus.IN_PROGRESS;
    return await this.requestRepository.save(request);
  }

  // ─── Приватні методи ──────────────────────────────────────────────────────

  private obfuscateLocation(request: Request, user: User): Request {
    if (!request.isLocationHidden) return request;

    const hasAccess =
      user.systemRole === SystemRole.ADMIN ||
      this.getClearanceRank(user.clearanceLevel) >=
        this.getClearanceRank(request.requiredClearance);

    if (!hasAccess && request.latitude != null && request.longitude != null) {
      const seed = parseInt(request.id.replace(/-/g, '').substring(0, 8), 16);
      const angle = (seed % 360) * (Math.PI / 180);
      const distanceDeg = OBFUSCATION_RADIUS_M / 111320;
      request.latitude = parseFloat(
        (request.latitude + distanceDeg * Math.sin(angle)).toFixed(6),
      );
      request.longitude = parseFloat(
        (request.longitude + distanceDeg * Math.cos(angle)).toFixed(6),
      );
    }

    return request;
  }

  private checkClearanceAccess(request: Request, user: User): void {
    if (user.systemRole === SystemRole.ADMIN) return;

    const userRank = this.getClearanceRank(user.clearanceLevel);
    const requiredRank = this.getClearanceRank(request.requiredClearance);

    if (userRank < requiredRank) {
      throw new ForbiddenException(
        `Недостатній рівень допуску. Потрібний: ${request.requiredClearance}`,
      );
    }
  }

  private getClearanceRank(level: ClearanceLevel): number {
    const ranks: Record<ClearanceLevel, number> = {
      [ClearanceLevel.LOCAL]: 0,
      [ClearanceLevel.INTERNATIONAL]: 1,
      [ClearanceLevel.FRONTLINE]: 2,
    };
    return ranks[level] ?? 0;
  }

  private autoCategorizeTags(text: string): string[] {
    const lowerText = text.toLowerCase();
    const tags: string[] = [];
    for (const [tag, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some((kw) => lowerText.includes(kw))) tags.push(tag);
    }
    return tags;
  }
}
