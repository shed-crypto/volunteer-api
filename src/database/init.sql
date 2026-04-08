-- Ініціалізація бази даних volunteer_help
-- Цей скрипт запускається автоматично при першому старті контейнера PostgreSQL

-- Активуємо розширення PostGIS для роботи з геопросторовими даними
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Додаткові розширення для текстового пошуку (категоризація заявок)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
