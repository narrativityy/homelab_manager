import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { authRouter, getSessionUser, initSetupToken, purgeExpiredSessions, requireAuth } from './auth.js';
import { serviceRouter } from './service.js';
import { startCollector, statsRouter } from './stats.js';
import { setupStatsWs } from './statsWs.js';

const app = express();
const server = http.createServer(app);

app.disable('x-powered-by');
// Lets a reverse proxy on the same host report the original scheme and client address.
app.set('trust proxy', 'loopback');

/** True when a browser request comes from a page served by this dashboard. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // not a cross-site browser request
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) {
    return res.status(403).json({ error: 'Cross-origin request blocked' });
  }
  next();
});
app.use(express.json({ limit: '100kb' }));

app.use('/api/auth', authRouter);
app.use('/api/stats', requireAuth, statsRouter);
app.use('/api/service', requireAuth, serviceRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(config.clientDist, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const statsWss = new WebSocketServer({ noServer: true });
setupStatsWs(statsWss);

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname !== '/ws/stats' || !sameOrigin(req)) return socket.destroy();
  if (!getSessionUser(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  statsWss.handleUpgrade(req, socket, head, (ws) => statsWss.emit('connection', ws, req));
});

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 60 * 60 * 1000).unref();

server.on('error', (err) => {
  // Exits non-zero so systemd retries, e.g. when a VPN address is not up yet at boot.
  console.error(`Cannot listen on ${config.host}:${config.port}: ${err.message}`);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  // A wildcard address is not something a browser can open, so show the hostname instead.
  const shown = ['0.0.0.0', '::'].includes(config.host) ? os.hostname() : config.host;
  const url = `http://${shown.includes(':') ? `[${shown}]` : shown}:${config.port}`;
  console.log(`homelab_manager ${config.version} listening on ${url}`);
  const token = initSetupToken();
  if (token) console.log(`\nNo admin account yet. Finish setup at:\n  ${url}/?setup=${token}\n`);
  startCollector();
});
