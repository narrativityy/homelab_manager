// End-to-end API tests: starts a real server on a free port with a throwaway data directory.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD = 'correct horse battery';

let server;
let dataDir;
let base;
let setupToken;
let cookie = '';

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function call(method, url, { body, headers = {}, auth = true } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth && cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && setCookie.startsWith('hlm_session=')) cookie = setCookie.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => null), setCookie };
}

function openSocket(headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws/stats', { headers });
    ws.on('message', (message) => {
      ws.close();
      resolve({ ok: true, sample: JSON.parse(message) });
    });
    ws.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hlm-test-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(root, 'server/src/index.js')], {
    env: { ...process.env, HLM_HOST: '127.0.0.1', HLM_PORT: String(port), HLM_DATA_DIR: dataDir, HLM_SYSTEMD_UNIT: '' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  setupToken = await new Promise((resolve, reject) => {
    let output = '';
    server.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/\?setup=(\S+)/);
      if (match) resolve(match[1]);
    });
    server.on('exit', (code) => reject(new Error(`server exited early with code ${code}`)));
    setTimeout(() => reject(new Error('server did not print a setup link in time')), 10000).unref();
  });
});

after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a fresh install reports that setup is required', async () => {
  const { data } = await call('GET', '/api/auth/status');
  assert.deepEqual(data, { setupRequired: true, username: null });
});

test('protected endpoints reject requests without a session', async () => {
  for (const url of ['/api/stats/system', '/api/service', '/api/docker']) {
    assert.equal((await call('GET', url)).status, 401, url);
  }
});

test('setup rejects a wrong token and a short password', async () => {
  const wrong = await call('POST', '/api/auth/setup', {
    body: { token: 'nope', username: 'admin', password: PASSWORD },
  });
  assert.equal(wrong.status, 403);
  const short = await call('POST', '/api/auth/setup', {
    body: { token: setupToken, username: 'admin', password: 'short' },
  });
  assert.equal(short.status, 400);
});

test('setup creates the admin account and signs in', async () => {
  const res = await call('POST', '/api/auth/setup', {
    body: { token: setupToken, username: 'admin', password: PASSWORD },
  });
  assert.equal(res.status, 200);
  assert.match(res.setCookie, /HttpOnly/);
  assert.match(res.setCookie, /SameSite=Strict/);
  assert.deepEqual((await call('GET', '/api/auth/status')).data, { setupRequired: false, username: 'admin' });
});

test('setup cannot be run a second time', async () => {
  const res = await call('POST', '/api/auth/setup', {
    body: { token: setupToken, username: 'other', password: PASSWORD },
  });
  assert.equal(res.status, 409);
});

test('cross-origin state-changing requests are blocked', async () => {
  const res = await call('POST', '/api/auth/logout', { headers: { Origin: 'http://evil.example' } });
  assert.equal(res.status, 403);
  assert.equal((await call('GET', '/api/auth/status')).data.username, 'admin');
});

test('responses carry security headers', async () => {
  const res = await fetch(base + '/api/auth/status');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
});

test('system info and history are available when signed in', async () => {
  const system = await call('GET', '/api/stats/system');
  assert.equal(system.status, 200);
  assert.equal(typeof system.data.hostname, 'string');
  const history = await call('GET', '/api/stats/history?range=bogus');
  assert.equal(history.data.range, '1h');
  assert.ok(Array.isArray(history.data.points));
});

test('service controls are refused outside systemd', async () => {
  const status = await call('GET', '/api/service');
  assert.equal(status.data.managed, false);
  assert.equal(status.data.canControl, false);
  for (const action of ['restart', 'stop', 'boot']) {
    assert.equal(
      (await call('POST', `/api/service/${action}`, { body: { enabled: false, password: PASSWORD } })).status,
      409,
      action,
    );
  }
});

test('the Docker endpoint answers whether or not Docker is present', async () => {
  const { status, data } = await call('GET', '/api/docker');
  assert.equal(status, 200);
  assert.equal(typeof data.available, 'boolean');
  assert.ok(Array.isArray(data.containers));
});

test('container routes validate the id and the action', async () => {
  assert.equal((await call('POST', '/api/docker/containers/not-an-id/stop')).status, 400);
  assert.equal((await call('POST', `/api/docker/containers/${'a'.repeat(64)}/remove`)).status, 400);
});

test('the stats WebSocket requires a session and a same-origin request', async () => {
  assert.equal((await openSocket({})).ok, false);
  assert.equal((await openSocket({ Cookie: cookie, Origin: 'http://evil.example' })).ok, false);
  const live = await openSocket({ Cookie: cookie });
  assert.equal(live.ok, true);
  assert.equal(typeof live.sample.cpu.percent, 'number');
  assert.ok(live.sample.mem.total > 0);
});

test('logging out ends the session', async () => {
  const old = cookie;
  assert.equal((await call('POST', '/api/auth/logout')).status, 200);
  cookie = old;
  assert.equal((await call('GET', '/api/stats/system')).status, 401);
  cookie = '';
});

test('login works with the right password', async () => {
  assert.equal(
    (await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong password' } })).status,
    401,
  );
  assert.equal(
    (await call('POST', '/api/auth/login', { body: { username: 'admin', password: PASSWORD } })).status,
    200,
  );
  assert.equal((await call('GET', '/api/auth/status')).data.username, 'admin');
});

// Last, because it locks this client out for the rest of the run.
test('repeated failed logins are rate limited', async () => {
  const statuses = [];
  for (let i = 0; i < 6; i += 1) {
    statuses.push(
      (await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong password' }, auth: false }))
        .status,
    );
  }
  assert.ok(statuses.includes(429), `expected a 429 in ${statuses}`);
  const locked = await call('POST', '/api/auth/login', {
    body: { username: 'admin', password: PASSWORD },
    auth: false,
  });
  assert.equal(locked.status, 429);
});
