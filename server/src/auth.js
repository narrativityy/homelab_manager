import crypto from 'node:crypto';
import { promisify } from 'node:util';
import express from 'express';
import { db } from './db.js';

const scrypt = promisify(crypto.scrypt);

const COOKIE_NAME = 'hlm_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 10;
const SCRYPT_COST = 15; // N = 2^15
const SCRYPT_OPTS = { N: 2 ** SCRYPT_COST, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// ---- passwords ----

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT_OPTS);
  return `scrypt$${SCRYPT_COST}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function checkHash(password, stored) {
  const [scheme, cost, salt, key] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    ...SCRYPT_OPTS,
    N: 2 ** Number(cost),
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Hashed once so a login for an unknown username takes as long as a real one.
const dummyHash = hashPassword(crypto.randomBytes(16).toString('hex'));

/** Resolves to the user row when the credentials are valid, otherwise null. */
export async function verifyPassword(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const ok = await checkHash(password, user ? user.password_hash : await dummyHash);
  return user && ok ? user : null;
}

// ---- first-run setup ----

let setupToken = null;

function hasUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
}

/**
 * Until an admin account exists, creating one requires a token that is only
 * printed to the server log, so whoever reaches the port first cannot claim
 * the dashboard. Returns the token, or null when setup is already done.
 */
export function initSetupToken() {
  setupToken = hasUsers() ? null : crypto.randomBytes(18).toString('base64url');
  return setupToken;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---- rate limiting ----

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map();

function retryAfter(ip) {
  const entry = failures.get(ip);
  if (!entry) return 0;
  if (Date.now() > entry.reset) {
    failures.delete(ip);
    return 0;
  }
  return entry.count >= MAX_FAILURES ? Math.ceil((entry.reset - Date.now()) / 1000) : 0;
}

function recordFailure(ip) {
  const entry = failures.get(ip);
  if (entry && Date.now() <= entry.reset) entry.count += 1;
  else failures.set(ip, { count: 1, reset: Date.now() + WINDOW_MS });
}

function rateLimit(req, res, next) {
  const wait = retryAfter(req.ip);
  if (!wait) return next();
  res.set('Retry-After', String(wait));
  res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.` });
}

// ---- sessions ----

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function startSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), user.id, now, now + SESSION_TTL_MS);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

/** Looks up the logged-in user from a request's cookie header (HTTP or WebSocket upgrade). */
export function getSessionUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  const row = db.prepare(`
    SELECT users.id, users.username FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), Date.now());
  return row || null;
}

export function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
}

export function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

// ---- routes ----

export const authRouter = express.Router();

authRouter.get('/status', (req, res) => {
  const user = getSessionUser(req);
  res.json({ setupRequired: !hasUsers(), username: user ? user.username : null });
});

authRouter.post('/setup', rateLimit, async (req, res) => {
  if (hasUsers() || !setupToken) return res.status(409).json({ error: 'Setup is already complete' });

  const { token, username, password } = req.body || {};
  if (!safeEqual(token || '', setupToken)) {
    recordFailure(req.ip);
    return res.status(403).json({ error: 'Setup token is not valid. Check the server log for the current one.' });
  }
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{2,32}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 2–32 letters, digits, dots, dashes or underscores' });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const hash = await hashPassword(password);
  // Re-checked after the await so two simultaneous setups cannot both succeed.
  if (hasUsers()) return res.status(409).json({ error: 'Setup is already complete' });
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, hash, Date.now());
  setupToken = null;

  startSession(req, res, { id: Number(lastInsertRowid) });
  res.json({ ok: true, username });
});

authRouter.post('/login', rateLimit, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const user = await verifyPassword(username, password);
  if (!user) {
    recordFailure(req.ip);
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  failures.delete(req.ip);
  startSession(req, res, user);
  res.json({ ok: true, username: user.username });
});

authRouter.post('/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});
