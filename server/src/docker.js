import http from 'node:http';
import express from 'express';

const SOCKET = process.env.HLM_DOCKER_SOCKET || '/var/run/docker.sock';
const REQUEST_TIMEOUT_MS = 60 * 1000; // a stop waits out the container's grace period
const MAX_LOG_LINES = 1000;

// Why the Docker socket cannot be used, keyed by the connection error.
const UNAVAILABLE = {
  ENOENT: 'not-installed',
  ECONNREFUSED: 'not-running',
  EACCES: 'no-permission',
};

/** Calls the Docker Engine API over its Unix socket. Resolves to parsed JSON, or a Buffer when raw. */
function docker(method, path, { raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET, method, path }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode >= 400) {
          let message = body.toString();
          try { message = JSON.parse(message).message; } catch { /* plain-text error */ }
          const err = new Error(message || `Docker returned ${res.statusCode}`);
          err.status = res.statusCode;
          return reject(err);
        }
        resolve(raw ? body : body.length ? JSON.parse(body) : null);
      });
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Docker did not respond in time')));
    req.end();
  });
}

/** Published ports as "host→container/proto", without the duplicate IPv6 entries Docker reports. */
function publishedPorts(ports) {
  const seen = new Set();
  for (const p of ports) {
    if (!p.PublicPort) continue;
    const host = !p.IP || p.IP === '0.0.0.0' || p.IP === '::' ? '' : `${p.IP}:`;
    seen.add(`${host}${p.PublicPort}→${p.PrivatePort}/${p.Type}`);
  }
  return [...seen];
}

/**
 * Container logs arrive as frames with an 8-byte header (stream type, then payload length)
 * unless the container has a TTY, in which case they are plain text.
 */
function demux(buffer) {
  const parts = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset + 4);
    parts.push(buffer.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  return Buffer.concat(parts);
}

export const dockerRouter = express.Router();

dockerRouter.get('/', async (req, res) => {
  let list;
  try {
    list = await docker('GET', '/containers/json?all=1');
  } catch (err) {
    if (UNAVAILABLE[err.code]) return res.json({ available: false, reason: UNAVAILABLE[err.code], containers: [] });
    throw err;
  }
  const containers = list.map((c) => ({
    id: c.Id,
    name: (c.Names[0] || c.Id.slice(0, 12)).replace(/^\//, ''),
    image: c.Image,
    state: c.State,
    status: c.Status,
    ports: publishedPorts(c.Ports || []),
    project: c.Labels?.['com.docker.compose.project'] || null,
  }));
  containers.sort((a, b) => (a.project || '').localeCompare(b.project || '') || a.name.localeCompare(b.name));
  res.json({ available: true, containers });
});

dockerRouter.param('id', (req, res, next, id) => {
  if (/^[a-f0-9]{12,64}$/.test(id)) return next();
  res.status(400).json({ error: 'Invalid container id' });
});

dockerRouter.post('/containers/:id/:action', async (req, res) => {
  const { id, action } = req.params;
  if (!['start', 'stop', 'restart'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  await docker('POST', `/containers/${id}/${action}`);
  res.json({ ok: true });
});

dockerRouter.get('/containers/:id/logs', async (req, res) => {
  const { id } = req.params;
  const tail = Math.min(Math.max(parseInt(req.query.tail, 10) || 200, 1), MAX_LOG_LINES);
  const [info, raw] = await Promise.all([
    docker('GET', `/containers/${id}/json`),
    docker('GET', `/containers/${id}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}`, { raw: true }),
  ]);
  res.json({ logs: (info.Config.Tty ? raw : demux(raw)).toString('utf8') });
});

// Docker's own error text (for example "No such container") is safe and useful to show.
dockerRouter.use((err, req, res, next) => {
  if (UNAVAILABLE[err.code]) return res.status(503).json({ error: 'Docker is not available' });
  if (err.status) return res.status(err.status === 404 ? 404 : 502).json({ error: err.message });
  next(err);
});
