import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import { verifyPassword } from './auth.js';
import { config } from './config.js';

const run = promisify(execFile);
const unit = config.systemdUnit;
const startedAt = Math.round(Date.now() - process.uptime() * 1000);

// The installer grants the service user sudo rights for exactly these invocations
// (see packaging/sudoers), so the argument lists here must match that file.
const PRIVILEGED = {
  restart: ['--no-block', 'restart', unit],
  stop: ['--no-block', 'stop', unit],
  enable: ['enable', unit],
  disable: ['disable', unit],
};

const privileged = (action) => run('sudo', ['-n', config.systemctl, ...PRIVILEGED[action]]);

/** Whether the sudo rule is in place; checked once, without running anything. */
const canControl = unit
  ? run('sudo', ['-n', '-l', config.systemctl, ...PRIVILEGED.enable]).then(
      () => true,
      () => false,
    )
  : Promise.resolve(false);

async function status() {
  const base = { managed: Boolean(unit), unit, version: config.version, startedAt, canControl: await canControl };
  if (!unit) return { ...base, startOnBoot: null };
  const { stdout } = await run(config.systemctl, ['show', unit, '--property=UnitFileState', '--value']);
  return { ...base, startOnBoot: stdout.trim() === 'enabled' };
}

export const serviceRouter = express.Router();

serviceRouter.get('/', async (req, res) => res.json(await status()));

serviceRouter.use(async (req, res, next) => {
  if (await canControl) return next();
  res.status(409).json({ error: 'Service controls are only available when installed as a systemd service' });
});

// Restart and stop end this process, so they reply first and act a moment later.
function deferred(action) {
  setTimeout(() => privileged(action).catch((err) => console.error(`${action} failed:`, err.message)), 250);
}

serviceRouter.post('/restart', (req, res) => {
  res.json({ ok: true });
  deferred('restart');
});

serviceRouter.post('/stop', async (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || !(await verifyPassword(req.user.username, password))) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  res.json({ ok: true });
  deferred('stop');
});

serviceRouter.post('/boot', async (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' });
  await privileged(enabled ? 'enable' : 'disable');
  res.json(await status());
});
