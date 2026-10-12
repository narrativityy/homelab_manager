import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import { config } from './config.js';
import { db } from './db.js';
import { UNAVAILABLE, docker } from './docker.js';

const run = promisify(execFile);

const COMPOSE_FILENAMES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
const PROJECT_NAME = /^[a-z0-9][a-z0-9_-]*$/;
const MAX_OUTPUT_BYTES = 256 * 1024;
const JOB_RETENTION_MS = 30 * 60 * 1000;

// Each action is one or more `docker compose` invocations. Those marked needsFiles read the
// compose file; the rest work from the project name alone, using the labels on its containers.
const ACTIONS = {
  up: { needsFiles: true, steps: [['up', '-d']] },
  pull: { needsFiles: true, steps: [['pull']] },
  update: { needsFiles: true, steps: [['pull'], ['up', '-d']] },
  restart: { needsFiles: false, steps: [['restart']] },
  stop: { needsFiles: false, steps: [['stop']] },
  down: { needsFiles: false, steps: [['down']] },
};

/** Resolves to the Compose version string, or null when the plugin is not installed. Checked once. */
const composeVersion = run('docker', ['compose', 'version', '--short']).then(
  ({ stdout }) => stdout.trim(),
  () => null,
);

function readable(file) {
  try {
    fs.accessSync(file, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** The project name Compose would use for a directory: a top-level `name:` if present, else the directory name. */
function projectName(dir, file) {
  let name = path.basename(dir);
  try {
    const match = fs.readFileSync(file, 'utf8').match(/^name:\s*["']?([^"'\s#]+)/m);
    if (match) name = match[1];
  } catch {
    // unreadable: fall back to the directory name
  }
  name = name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return PROJECT_NAME.test(name) ? name : null;
}

/** Stacks found as sub-directories of the configured stack directories. */
function scanDirectories() {
  const found = [];
  for (const base of config.stacksDirs) {
    let entries;
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(base, entry.name);
      const file = COMPOSE_FILENAMES.map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
      const name = file && projectName(dir, file);
      if (name) found.push({ name, dir, files: [file] });
    }
  }
  return found;
}

function stackState(containers) {
  if (containers.length === 0) return 'down';
  const running = containers.filter((c) => c.state === 'running').length;
  if (running === containers.length) return 'running';
  return running === 0 ? 'stopped' : 'partial';
}

/**
 * Every known stack: those with containers (from Compose's labels), those in the configured
 * directories, and those remembered from earlier, merged by project name.
 */
async function listStacks() {
  const stacks = new Map();
  const add = (name, dir, files) => {
    if (!stacks.has(name)) stacks.set(name, { name, dir, files, containers: [] });
    return stacks.get(name);
  };

  for (const c of await docker('GET', '/containers/json?all=1')) {
    const labels = c.Labels || {};
    const name = labels['com.docker.compose.project'];
    if (!name || !PROJECT_NAME.test(name)) continue;
    const files = (labels['com.docker.compose.project.config_files'] || '').split(',').filter(Boolean);
    add(name, labels['com.docker.compose.project.working_dir'] || null, files).containers.push({
      id: c.Id,
      name: (c.Names[0] || '').replace(/^\//, ''),
      service: labels['com.docker.compose.service'] || null,
      image: c.Image,
      state: c.State,
      status: c.Status,
    });
  }

  // Remember running stacks, so one that is brought down later does not vanish from the list.
  const remember = db.prepare('INSERT OR REPLACE INTO stacks (name, dir, files) VALUES (?, ?, ?)');
  for (const s of stacks.values()) if (s.dir && s.files.length) remember.run(s.name, s.dir, JSON.stringify(s.files));

  for (const s of scanDirectories()) add(s.name, s.dir, s.files);

  for (const row of db.prepare('SELECT name, dir, files FROM stacks').all()) {
    if (stacks.has(row.name)) continue;
    const files = JSON.parse(row.files);
    // Forget a stack whose directory was deleted. One we merely cannot read stays listed.
    if (!fs.existsSync(row.dir) && readable(path.dirname(row.dir))) {
      db.prepare('DELETE FROM stacks WHERE name = ?').run(row.name);
      continue;
    }
    add(row.name, row.dir, files);
  }

  return [...stacks.values()]
    .map((s) => ({
      ...s,
      containers: s.containers.sort((a, b) => a.name.localeCompare(b.name)),
      state: stackState(s.containers),
      filesReadable: s.files.length > 0 && s.files.every(readable),
      job: activeJob(s.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- jobs: one running compose command per stack, with its output kept for the browser ----

const jobs = new Map();

function activeJob(stack) {
  for (const job of jobs.values()) if (job.stack === stack && job.running) return { id: job.id, action: job.action };
  return null;
}

function emit(job, event, data) {
  for (const listener of job.listeners) listener(event, data);
}

function append(job, text) {
  job.output = (job.output + text).slice(-MAX_OUTPUT_BYTES);
  emit(job, 'output', text);
}

function runStep(job, base, step, cwd) {
  return new Promise((resolve) => {
    // The command line shown to the user leaves out the plumbing flags.
    append(job, `$ docker compose ${step.join(' ')}\n`);
    const child = spawn('docker', [...base, ...step], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => append(job, chunk.toString()));
    child.stderr.on('data', (chunk) => append(job, chunk.toString()));
    child.on('error', (err) => {
      append(job, `Could not run docker: ${err.message}\n`);
      resolve(127);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function startJob(stack, action) {
  const job = {
    id: crypto.randomBytes(8).toString('hex'),
    stack: stack.name,
    action,
    running: true,
    exitCode: null,
    output: '',
    listeners: new Set(),
  };
  jobs.set(job.id, job);

  const base = ['compose', '--ansi', 'never', '--progress', 'plain', '-p', stack.name];
  if (ACTIONS[action].needsFiles) {
    base.push('--project-directory', stack.dir);
    for (const file of stack.files) base.push('-f', file);
  }
  const cwd = stack.dir && readable(stack.dir) ? stack.dir : undefined;

  (async () => {
    let code = 0;
    for (const step of ACTIONS[action].steps) {
      code = await runStep(job, base, step, cwd);
      if (code !== 0) break;
    }
    job.running = false;
    job.exitCode = code;
    emit(job, 'done', { exitCode: code });
    setTimeout(() => jobs.delete(job.id), JOB_RETENTION_MS).unref();
  })();

  return job;
}

// ---- routes ----

export const stacksRouter = express.Router();

stacksRouter.get('/', async (req, res) => {
  const version = await composeVersion;
  let stacks;
  try {
    stacks = await listStacks();
  } catch (err) {
    if (UNAVAILABLE[err.code]) return res.json({ available: false, reason: UNAVAILABLE[err.code], stacks: [] });
    throw err;
  }
  if (!version) return res.json({ available: false, reason: 'no-compose', stacks: [] });
  res.json({ available: true, composeVersion: version, stacks });
});

stacksRouter.post('/:name/:action', async (req, res) => {
  const { name, action } = req.params;
  if (!ACTIONS[action]) return res.status(400).json({ error: 'Invalid action' });
  if (!(await composeVersion)) return res.status(503).json({ error: 'Docker Compose is not installed' });

  // The stack is looked up by name among those discovered; no path ever comes from the browser.
  const stack = (await listStacks()).find((s) => s.name === name);
  if (!stack) return res.status(404).json({ error: 'No such stack' });
  if (stack.job)
    return res.status(409).json({ error: `Another action (${stack.job.action}) is still running for this stack` });
  if (ACTIONS[action].needsFiles && !stack.filesReadable) {
    return res.status(409).json({ error: 'The dashboard cannot read this stack’s compose file' });
  }

  const job = startJob(stack, action);
  res.status(202).json({ jobId: job.id });
});

stacksRouter.get('/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'No such job' });
  res.json({
    id: job.id,
    stack: job.stack,
    action: job.action,
    running: job.running,
    exitCode: job.exitCode,
    output: job.output,
  });
});

/** Server-sent events: the output so far, then each new chunk, then a final "done". */
stacksRouter.get('/jobs/:id/stream', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'No such job' });

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (job.output) send('output', job.output);
  if (!job.running) {
    send('done', { exitCode: job.exitCode });
    return res.end();
  }

  const listener = (event, data) => {
    send(event, data);
    if (event === 'done') res.end();
  };
  job.listeners.add(listener);
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 20000);
  req.on('close', () => {
    clearInterval(heartbeat);
    job.listeners.delete(listener);
  });
});

stacksRouter.use((err, req, res, next) => {
  if (UNAVAILABLE[err.code]) return res.status(503).json({ error: 'Docker is not available' });
  next(err);
});
