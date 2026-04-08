/**
 * Спільні переліки (enums) для всієї системи.
 *
 * Зберігаються в одному файлі для консистентності та легкого розширення.
 * Щоб додати нове значення — просто дописати його в потрібний enum.
 * Міграція БД оновить тип автоматично при DB_SYNCHRONIZE=true або через migration.
 */

// ─── Користувачі ──────────────────────────────────────────────────────────────

/** Системна роль користувача (глобальна, незалежно від групи) */
export enum SystemRole {
  ADMIN = 'admin',
  COORDINATOR = 'coordinator',
  VOLUNTEER = 'volunteer',
  REQUESTER = 'requester',
}

/** Рівень допуску волонтера (розблокується через систему Поручителів) */
export enum ClearanceLevel {
  LOCAL = 'local',           // Локальні завдання (базовий рівень)
  INTERNATIONAL = 'international', // Завдання з перетином кордону
  FRONTLINE = 'frontline',   // Червона зона / прифронтові завдання
}

/** Тип транспортного засобу */
export enum VehicleType {
  PASSENGER = 'passenger',   // Легковий
  VAN = 'van',               // Мікроавтобус
  PICKUP = 'pickup',         // Пікап
  TRUCK = 'truck',           // Вантажівка
  ARMORED = 'armored',       // Бронеавтомобіль
  MOTORCYCLE = 'motorcycle', // Мотоцикл
}

/** Статус транспортного засобу */
export enum VehicleStatus {
  ACTIVE = 'active',
  UNDER_REPAIR = 'under_repair',
  UNAVAILABLE = 'unavailable',
}

// ─── Організації ──────────────────────────────────────────────────────────────

/** Роль учасника в організації */
export enum OrgRole {
  LEADER = 'leader',
  COORDINATOR = 'coordinator',
  MEMBER = 'member',
}

// ─── Заявки (Requests / Epics) ────────────────────────────────────────────────

/** Категорія заявки для автоматичної класифікації та фільтрації */
export enum RequestCategory {
  MEDICAL = 'medical',           // Медична допомога
  EVACUATION = 'evacuation',     // Евакуація
  LOGISTICS = 'logistics',       // Логістика / доставка
  MILITARY = 'military',         // Підтримка військових
  HUMANITARIAN = 'humanitarian', // Гуманітарна допомога
  SHELTER = 'shelter',           // Житло
  PSYCHOLOGICAL = 'psychological', // Психологічна підтримка
  OTHER = 'other',               // Інше
}

/** Рівень терміновості заявки */
export enum RequestUrgency {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/** Поточний статус заявки (Kanban lifecycle) */
export enum RequestStatus {
  OPEN = 'open',                  // Очікує волонтерів
  IN_PROGRESS = 'in_progress',   // Виконується
  PARTIALLY_DONE = 'partially_done', // Частково виконана
  PENDING_REVIEW = 'pending_review', // Очікує підтвердження від потребуючого
  COMPLETED = 'completed',        // Завершена
  CANCELLED = 'cancelled',        // Скасована
}

// ─── Підзадачі (Tasks) ────────────────────────────────────────────────────────

/** Статус підзадачі на Kanban-дошці */
export enum TaskStatus {
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  PENDING_REVIEW = 'pending_review',
  DONE = 'done',
  CANCELLED = 'cancelled',
}

/** Статус волонтера, призначеного на підзадачу */
export enum AssignmentStatus {
  ASSIGNED = 'assigned',
  EN_ROUTE = 'en_route',
  ON_SITE = 'on_site',
  COMPLETED = 'completed',
  WITHDRAWN = 'withdrawn',
}

// ─── Чати ─────────────────────────────────────────────────────────────────────

/** Тип чату */
export enum ChatType {
  TASK_CHAT = 'task_chat',   // Чат, пов'язаний із підзадачею
  ORG_CHAT = 'org_chat',     // Чат організації
  DIRECT = 'direct',         // Приватне повідомлення між двома користувачами
}
