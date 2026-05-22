import http from 'k6/http';
import { check, sleep, group } from 'k6';

export const options = {
  // Ціль: 1000 одночасних сесій, час відгуку геопошуку ≤ 1.5 с (NFR-01)
  stages: [
    { duration: '30s', target: 50 },   // розігрів
    { duration: '1m', target: 200 },   // помірне навантаження
    { duration: '2m', target: 500 },   // високе навантаження
    { duration: '3m', target: 1000 },  // пікове навантаження
    { duration: '2m', target: 200 },   // охолодження
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration{name:geo-search}': ['p95<1500'], // NFR-01: 1.5 с для 95-го перцентиля
    'http_req_duration{name:auth-login}': ['p95<500'],   // автентифікація має бути швидкою
    'http_req_duration{name:create-request}': ['p95<1000'],
    'http_req_failed': ['rate<0.05'],                     // < 5% помилок
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// -------------------------------------------------------------------
// Допоміжні функції
// -------------------------------------------------------------------

function generateEmail(vuId) {
  return `loadtest_${vuId}_${Date.now()}@example.com`;
}

function registerAndLogin(vuId) {
  const email = generateEmail(vuId);
  const password = 'Test1234!';

  // Реєстрація
  const regRes = http.post(`${BASE_URL}/auth/register`, JSON.stringify({
    email,
    password,
    fullName: `Load Tester ${vuId}`,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  if (regRes.status !== 201) {
    // Можливо, користувач уже існує — логінимось
    const loginRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify({
      email: 'loadtest_1_1000000000000@example.com', // фолбек
      password: 'Test1234!',
    }), {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'auth-login' },
    });

    if (loginRes.status === 201 || loginRes.status === 200) {
      return { token: JSON.parse(loginRes.body).accessToken, email };
    }
    return null;
  }

  const token = JSON.parse(regRes.body).accessToken;
  return { token, email };
}

// -------------------------------------------------------------------
// Тестові сценарії
// -------------------------------------------------------------------

export default function () {
  const vuId = __VU; // Virtual User ID

  group('Auth + Sessions', () => {
    const auth = registerAndLogin(vuId);
    if (!auth) {
      console.error(`VU ${vuId}: Auth failed`);
      return;
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    };

    // ─── Геопошук (NFR-01): ключовий сценарій ──────────────────────
    group('Geo Search', () => {
      // Випадкові координати в межах України
      const lat = 48.0 + (Math.random() * 5);   // 48° - 53° N
      const lng = 22.0 + (Math.random() * 18);   // 22° - 40° E
      const radius = 5000 + Math.random() * 25000; // 5 - 30 км

      const res = http.get(
        `${BASE_URL}/requests?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&radius=${Math.round(radius)}`,
        {
          headers,
          tags: { name: 'geo-search' },
        },
      );

      check(res, {
        'geo-search status 200': (r) => r.status === 200,
        'geo-search returns array': (r) => Array.isArray(JSON.parse(r.body)),
      });
    });

    // ─── Створення заявки ──────────────────────────────────────────
    group('Create Request', () => {
      const payload = JSON.stringify({
        title: `Load Test #${vuId}`,
        description: 'Тестова заявка для навантажувального тестування',
        category: 'medical',
        urgency: 3,
        latitude: 50.45,
        longitude: 30.52,
        neededPeopleCount: 3,
      });

      const res = http.post(`${BASE_URL}/requests`, payload, {
        headers,
        tags: { name: 'create-request' },
      });

      check(res, {
        'create request status 2xx': (r) => r.status === 201 || r.status === 200,
      });
    });

    // ─── Список заявок ─────────────────────────────────────────────
    group('List Requests', () => {
      const res = http.get(`${BASE_URL}/requests`, {
        headers,
        tags: { name: 'list-requests' },
      });

      check(res, {
        'list requests status 200': (r) => r.status === 200,
      });
    });

    // ─── Профіль користувача ─────────────────────────────────────
    group('User Profile', () => {
      const res = http.get(`${BASE_URL}/users/me`, {
        headers,
        tags: { name: 'user-profile' },
      });

      check(res, {
        'profile status 200': (r) => r.status === 200 || r.status === 404,
      });
    });

    sleep(1);
  });
}