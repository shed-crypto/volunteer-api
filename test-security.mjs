import http from 'http';

const API = 'localhost';
const PORT = 3000;

function post(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request({
      hostname: API,
      port: PORT,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function get(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: API,
      port: PORT,
      path: path,
      method: 'GET',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('=== Security Test Suite ===\n');
  let token = null;

  // 1. Register new user
  const email = `testapi_${Date.now()}@test.com`;
  console.log('1. Register new user...');
  const regRes = await post('/api/auth/register', {
    email,
    password: 'Test1234!',
    fullName: 'API Test User',
  });
  console.log('   Register:', regRes.statusCode ? `FAIL (${regRes.message})` : 'OK');
  
  if (!regRes.statusCode) {
    // Auto-login the new user
    console.log('2. Login...');
    const loginRes = await post('/api/auth/login', {
      email,
      password: 'Test1234!',
    });
    console.log('   Login:', loginRes.access_token ? 'OK' : `FAIL (${loginRes.message})`);
    token = loginRes.access_token;
  }

  if (!token) {
    console.log('   Cannot proceed without auth token.');
    return;
  }

  // 3. Get requests list
  console.log('\n3. Get requests list...');
  const list = await get('/api/requests', token);
  console.log('   Status:', Array.isArray(list) ? `OK (${list.length} items)` : `FAIL (${list.message})`);

  // 4. Get a specific request (triggers AccessLog for FRONTLINE)
  console.log('\n4. Get specific request (triggers AccessLog if FRONTLINE)...');
  const firstId = list[0]?.id;
  if (firstId) {
    const reqDetail = await get('/api/requests/' + firstId, token);
    console.log('   Status:', reqDetail.statusCode ? `FAIL (${reqDetail.message})` : 'OK');
  } else {
    console.log('   Skip: no requests available');
  }

  // 5. Check if we can see the log in docker output
  console.log('\n5. Done - verify docker logs for [AccessLog] entries');
}

main().catch(console.error);
