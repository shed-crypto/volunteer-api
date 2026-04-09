import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from './entities/request.entity';
import { User } from '@modules/users/entities/user.entity';
import {
  RequestStatus,
  ClearanceLevel,
  SystemRole,
} from '@common/enums';
import { CreateRequestDto } from './dto/create-request.dto';
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

    if (dto.status)   qb.andWhere('request.status = :status',     { status: dto.status });
    if (dto.category) qb.andWhere('request.category = :category', { category: dto.category });
    if (dto.urgency)  qb.andWhere('request.urgency = :urgency',   { urgency: dto.urgency });

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
    const request = await this.requestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`Заявку ${id} не знайдено`);

    if (request.creatorId !== requester.id && requester.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Немає прав для редагування цієї заявки');
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

  // ─── Видалення ────────────────────────────────────────────────────────────

  async remove(id: string, requester: User): Promise<void> {
    const request = await this.requestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`Заявку ${id} не знайдено`);

    if (request.creatorId !== requester.id && requester.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Немає прав для видалення цієї заявки');
    }

    await this.requestRepository.softDelete(id);
  }

  // ─── Приватні методи ──────────────────────────────────────────────────────

  private obfuscateLocation(request: Request, user: User): Request {
    if (!request.isLocationHidden) return request;

    const hasAccess =
      user.systemRole === SystemRole.ADMIN ||
      this.getClearanceRank(user.clearanceLevel) >=
        this.getClearanceRank(request.requiredClearance);

    if (!hasAccess && request.latitude && request.longitude) {
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
