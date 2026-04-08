import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions, ILike } from 'typeorm';
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

/** Ключові слова для автоматичної категоризації (FR автокатегоризація) */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  '#Медицина': ['медик', 'лікар', 'аптека', 'ліки', 'перев\'язка', 'медична'],
  '#Евакуація': ['евакуація', 'евакуювати', 'вивезти', 'виїхати', 'перевезти'],
  '#Термінова': ['терміново', 'критично', 'негайно', 'srochno'],
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

  async create(dto: CreateRequestDto, creator: User): Promise<Request> {
    const tags = this.autoCategorizeTags(dto.title + ' ' + (dto.description || ''));

    const request = this.requestRepository.create({
      ...dto,
      creatorId: creator.id,
      tags,
    });

    return this.requestRepository.save(request);
  }

  // ─── Список заявок ────────────────────────────────────────────────────────

  async findAll(dto: FindRequestsDto, requester: User): Promise<Request[]> {
    const qb = this.requestRepository
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.creator', 'creator')
      .leftJoinAndSelect('request.tasks', 'tasks')
      .where('request.deleted_at IS NULL');

    // Фільтр за статусом
    if (dto.status) {
      qb.andWhere('request.status = :status', { status: dto.status });
    }

    // Фільтр за категорією
    if (dto.category) {
      qb.andWhere('request.category = :category', { category: dto.category });
    }

    // Фільтр за терміновістю
    if (dto.urgency) {
      qb.andWhere('request.urgency = :urgency', { urgency: dto.urgency });
    }

    // Повнотекстовий пошук
    if (dto.search) {
      qb.andWhere(
        '(request.title ILIKE :search OR request.description ILIKE :search)',
        { search: `%${dto.search}%` },
      );
    }

    // FR-08: приховуємо заявки з підвищеним рівнем допуску
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

    // Геопошук у радіусі (PostGIS)
    if (dto.latitude && dto.longitude && dto.radiusKm) {
      const radiusM = dto.radiusKm * 1000;
      qb.andWhere(
        `ST_DWithin(
          request.exact_location::geography,
          ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
          :radius
        )`,
        { lat: dto.latitude, lng: dto.longitude, radius: radiusM },
      );
      // Сортування за відстанню
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

    // Обфускуємо координати для приихованих заявок (FR-08)
    return requests.map((r) => this.obfuscateLocation(r, requester));
  }

  // ─── Деталі заявки ────────────────────────────────────────────────────────

  async findOne(id: string, requester: User): Promise<Request> {
    const request = await this.requestRepository.findOne({
      where: { id },
      relations: ['creator', 'tasks', 'tasks.assignments', 'tasks.assignments.user'],
    });

    if (!request) {
      throw new NotFoundException(`Заявку ${id} не знайдено`);
    }

    this.checkClearanceAccess(request, requester);

    return this.obfuscateLocation(request, requester);
  }

  // ─── Оновлення статусу заявки ─────────────────────────────────────────────

  async update(id: string, dto: UpdateRequestDto, requester: User): Promise<Request> {
    const request = await this.requestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`Заявку ${id} не знайдено`);

    // Лише автор або адмін може оновлювати заявку
    if (request.creatorId !== requester.id && requester.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Немає прав для редагування цієї заявки');
    }

    Object.assign(request, dto);

    // Перерахуємо теги якщо текст змінився
    if (dto.title || dto.description) {
      request.tags = this.autoCategorizeTags(
        (dto.title || request.title) + ' ' + (dto.description || request.description || ''),
      );
    }

    return this.requestRepository.save(request);
  }

  // ─── Видалення (soft delete) ──────────────────────────────────────────────

  async remove(id: string, requester: User): Promise<void> {
    const request = await this.requestRepository.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`Заявку ${id} не знайдено`);

    if (request.creatorId !== requester.id && requester.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Немає прав для видалення цієї заявки');
    }

    await this.requestRepository.softDelete(id);
  }

  // ─── Приватні допоміжні методи ─────────────────────────────────────────────

  /**
   * FR-08: Якщо заявка прихована і користувач ще не отримав доступ —
   * замінюємо точні координати на обфусковані (зсуваємо випадково в радіусі N км).
   */
  private obfuscateLocation(request: Request, user: User): Request {
    if (!request.isLocationHidden) return request;

    const hasAccess =
      user.systemRole === SystemRole.ADMIN ||
      this.getClearanceRank(user.clearanceLevel) >=
        this.getClearanceRank(request.requiredClearance);

    if (!hasAccess && request.latitude && request.longitude) {
      // Псевдовипадковий зсув у межах радіусу обфускування
      const seed = parseInt(request.id.replace(/-/g, '').substring(0, 8), 16);
      const angle = (seed % 360) * (Math.PI / 180);
      const distanceDeg = OBFUSCATION_RADIUS_M / 111320; // ~1 градус = 111.32 км
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

  /** Аналіз тексту для авто-тегування (FR — автоматична категоризація) */
  private autoCategorizeTags(text: string): string[] {
    const lowerText = text.toLowerCase();
    const tags: string[] = [];

    for (const [tag, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some((kw) => lowerText.includes(kw))) {
        tags.push(tag);
      }
    }

    return tags;
  }
}
