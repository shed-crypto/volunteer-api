# Волонтерська допомога — Backend API

REST API та WebSocket шлюз для системи координації волонтерської допомоги.  
Стек: **NestJS 10 · TypeORM · PostgreSQL/PostGIS · Socket.IO · Argon2 · JWT**

---

## Зміст

- [Вимоги](#вимоги)
- [Швидкий старт (Docker)](#швидкий-старт-docker)
- [Ручний запуск (без Docker)](#ручний-запуск-без-docker)
- [Змінні середовища](#змінні-середовища)
- [API Документація](#api-документація)
- [Структура проекту](#структура-проекту)
- [Ролі та права доступу](#ролі-та-права-доступу)
- [WebSocket](#websocket)
- [Запуск тестів](#запуск-тестів)

---

## Вимоги

| Інструмент | Мінімальна версія |
|-----------|-------------------|
| Node.js   | 20 LTS            |
| npm       | 10+               |
| PostgreSQL| 15+ з PostGIS 3.3 |
| Docker    | 24+ (опційно)     |
| Docker Compose | v2+          |

---

## Швидкий старт (Docker)

```bash
# 1. Клонувати / розпакувати проект
cd backend/

# 2. Скопіювати та заповнити змінні середовища
cp .env.example .env
# Відкрити .env і замінити JWT_SECRET та JWT_REFRESH_SECRET на випадкові рядки!
# Для генерації: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Запустити PostgreSQL + Redis + API одним командою
docker compose up -d

# 4. Перевірити що сервер запустився
curl http://localhost:3000/api
# Очікувана відповідь: 404 (тобто сервер відповідає)

# Swagger UI (документація API):
# http://localhost:3000/api/docs
```

**Зупинити:**
```bash
docker compose down
# Зупинити і видалити дані БД:
docker compose down -v
```

---

## Ручний запуск (без Docker)

### 1. Встановити залежності
```bash
npm install
```

### 2. Налаштувати PostgreSQL
```bash
# Створити БД та користувача
psql -U postgres -c "CREATE USER volunteer WITH PASSWORD 'volunteer_pass';"
psql -U postgres -c "CREATE DATABASE volunteer_help OWNER volunteer;"

# Увімкнути PostGIS
psql -U postgres -d volunteer_help -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql -U postgres -d volunteer_help -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
psql -U postgres -d volunteer_help -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
psql -U postgres -d volunteer_help -c "CREATE EXTENSION IF NOT EXISTS unaccent;"
```

### 3. Заповнити .env
```bash
cp .env.example .env
# Відредагувати .env: вписати реальні JWT_SECRET, JWT_REFRESH_SECRET
```

### 4. Запустити в режимі розробки
```bash
npm run start:dev
# Сервер запуститься на http://localhost:3000/api
# Swagger: http://localhost:3000/api/docs
```

### 5. Заповнити тестовими даними (опційно)
```bash
npm run seed
# Створює адміна (admin@test.com / Admin1234!),
# волонтерів, організації, тестові заявки
```

---

## Змінні середовища

Скопіювати `.env.example` → `.env` та заповнити:

| Змінна | Опис | Обов'язкова |
|--------|------|-------------|
| `DB_HOST` | Хост PostgreSQL | Так |
| `DB_PASSWORD` | Пароль БД | Так |
| `JWT_SECRET` | Секрет для access token (мін. 32 символи) | **Так!** |
| `JWT_REFRESH_SECRET` | Секрет для refresh token | **Так!** |
| `SMTP_HOST` | SMTP сервер для листів | Ні (логує в консоль) |
| `SMTP_USER` / `SMTP_PASS` | Логін/пароль SMTP | Ні |
| `APP_URL` | Публічний URL сервера (для посилань у листах) | Ні |
| `TELEGRAM_BOT_TOKEN` | Токен Telegram бота | Ні |

---

## API Документація

Swagger UI доступний за адресою:  
`http://localhost:3000/api/docs` (тільки в режимі `NODE_ENV !== production`)

Приклади запитів також є у файлі `api-examples.http`  
(відкрити у VS Code з розширенням REST Client або JetBrains HTTP Client).

### Основні endpoint-и

```
POST   /api/auth/register          Реєстрація
POST   /api/auth/login             Вхід → accessToken + refreshToken
POST   /api/auth/refresh           Оновити токени
POST   /api/auth/logout            Вихід
GET    /api/auth/verify-email      Підтвердити email (посилання з листа)
POST   /api/auth/resend-verification  Повторно надіслати лист

GET    /api/users/me               Мій профіль
PATCH  /api/users/me               Оновити профіль
GET    /api/users/:id              Профіль іншого користувача
POST   /api/users/:id/vouch        Поручитися за волонтера
GET    /api/users/me/vehicles      Мої транспортні засоби
POST   /api/users/me/vehicles      Додати транспорт

GET    /api/organizations          Список організацій
POST   /api/organizations          Створити організацію
GET    /api/organizations/:id      Деталі організації
POST   /api/organizations/:id/join Вступити в організацію

GET    /api/requests               Список заявок (з фільтрацією)
POST   /api/requests               Створити заявку
GET    /api/requests/:id           Деталі заявки
PATCH  /api/requests/:id           Оновити заявку
GET    /api/requests/:id/tasks     Задачі (Kanban) заявки

GET    /api/tasks                  Мої задачі
POST   /api/tasks                  Створити задачу
PATCH  /api/tasks/:id/status       Змінити статус задачі
POST   /api/tasks/:id/assign       Призначити волонтера
POST   /api/tasks/:id/delegate     Делегувати задачу

GET    /api/chat                   Мої чати
POST   /api/chat                   Створити чат
GET    /api/chat/:id/messages      Повідомлення чату
```

---

## Структура проекту

```
src/
├── app.module.ts              Кореневий модуль
├── main.ts                    Точка входу (bootstrap)
├── common/
│   ├── decorators/            @CurrentUser() декоратор
│   ├── entities/              BaseEntity (id, createdAt, updatedAt)
│   ├── enums/                 SystemRole, ClearanceLevel, TaskStatus тощо
│   ├── filters/               GlobalExceptionFilter
│   └── guards/                JwtAuthGuard
├── config/
│   └── database.config.ts     TypeORM конфігурація
├── database/
│   ├── init.sql               PostGIS та UUID розширення
│   └── seeds/run-seeds.ts     Тестові дані
└── modules/
    ├── auth/                  Реєстрація, вхід, JWT, email-верифікація
    ├── chat/                  WebSocket чати, повідомлення
    ├── email/                 SMTP / graceful fallback
    ├── notifications/         Сповіщення (Telegram, in-app)
    ├── organizations/         Організації та хаби
    ├── requests/              Заявки на допомогу (епіки)
    ├── tasks/                 Підзадачі (Kanban), призначення, делегування
    └── users/                 Профіль, транспорт, поруки (trust vouches)
```

---

## Ролі та права доступу

| Роль | Опис |
|------|------|
| `VOLUNTEER` | Бере задачі, виконує доручення |
| `REQUESTER` | Створює заявки на допомогу |
| `COORDINATOR` | Керує задачами, призначає волонтерів |
| `ADMIN` | Повний доступ, блокування користувачів |

**Рівні допуску (ClearanceLevel):**
- `LOCAL` — звичайні задачі
- `REGIONAL` — регіональні операції
- `FRONTLINE` — задачі у зоні ризику (потребує 3 поруки від перевірених волонтерів)

---

## WebSocket

Підключення до `/chat` namespace:
```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/chat', {
  auth: { token: 'Bearer <accessToken>' }
});

// Події:
socket.emit('joinRoom', { chatId: 'uuid' });
socket.emit('sendMessage', { chatId: 'uuid', content: 'Привіт!' });
socket.on('newMessage', (msg) => console.log(msg));
```

---

## Запуск тестів

```bash
# Unit тести
npm test

# З покриттям
npm run test:cov

# Інтеграційні тести (потребує запущеної БД)
npm run test:e2e
```

---

## Production деплой

```bash
# Зібрати продакшн образ
docker compose -f docker-compose.yml build

# ВАЖЛИВО перед деплоєм:
# 1. Встановити DB_SYNCHRONIZE=false
# 2. Запустити міграції: npm run migration:run
# 3. Змінити JWT_SECRET та JWT_REFRESH_SECRET на надійні значення
# 4. Налаштувати SMTP для надсилання листів
# 5. Встановити NODE_ENV=production
```
