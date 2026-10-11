import express from 'express';
import si from 'systeminformation';
import { db } from './db.js';

const COLLECT_INTERVAL_MS = 60 * 1000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Pseudo and container-layer filesystems that would only add noise to the disk list.
const IGNORED_FS = /^(tmpfs|devtmpfs|overlay|squashfs|efivarfs|ramfs)$/;

const pct = (used, total) => (total > 0 ? (used / total) * 100 : 0);

let defaultIface;

/** One snapshot of the machine. CPU load and network rates are measured since the previous call. */
export async function sample() {
  defaultIface ??= await si.networkInterfaceDefault();
  const [load, mem, fs, temp, net, battery] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.cpuTemperature(),
    si.networkStats(defaultIface),
    si.battery(),
  ]);

  const disks = fs
    .filter((d) => !IGNORED_FS.test(d.type) && d.size > 0)
    .map((d) => ({ mount: d.mount, fs: d.fs, type: d.type, used: d.used, size: d.size, percent: pct(d.used, d.size) }));
  const root = disks.find((d) => d.mount === '/') || disks[0] || null;
  const memUsed = mem.total - mem.available;
  const iface = net[0];

  return {
    ts: Date.now(),
    cpu: { percent: load.currentLoad, cores: load.cpus.length, loadAvg: load.avgLoad },
    mem: { used: memUsed, total: mem.total, percent: pct(memUsed, mem.total), swapUsed: mem.swapused, swapTotal: mem.swaptotal },
    disk: root,
    disks,
    temp: Number.isFinite(temp.main) ? temp.main : null,
    net: {
      iface: defaultIface,
      // Rates are null on the first call, before there is a previous reading to diff against.
      rx: iface && iface.rx_sec >= 0 ? iface.rx_sec : null,
      tx: iface && iface.tx_sec >= 0 ? iface.tx_sec : null,
    },
    battery: battery.hasBattery ? { percent: battery.percent, charging: battery.isCharging, acConnected: battery.acConnected } : null,
    uptime: si.time().uptime,
  };
}

async function collect() {
  try {
    const s = await sample();
    db.prepare('INSERT OR REPLACE INTO stats (ts, cpu, mem, disk, temp, rx, tx) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(s.ts, s.cpu.percent, s.mem.percent, s.disk ? s.disk.percent : null, s.temp, s.net.rx, s.net.tx);
    db.prepare('DELETE FROM stats WHERE ts < ?').run(Date.now() - RETENTION_MS);
  } catch (err) {
    console.error('stats collection failed:', err.message);
  }
}

export function startCollector() {
  collect();
  setInterval(collect, COLLECT_INTERVAL_MS).unref();
}

// range -> [window, bucket size]; every range returns at most ~300 points.
const RANGES = {
  '1h': [60 * 60 * 1000, 60 * 1000],
  '24h': [24 * 60 * 60 * 1000, 5 * 60 * 1000],
  '7d': [7 * 24 * 60 * 60 * 1000, 30 * 60 * 1000],
};

export const statsRouter = express.Router();

statsRouter.get('/history', (req, res) => {
  const range = RANGES[req.query.range] ? req.query.range : '1h';
  const [windowMs, bucketMs] = RANGES[range];
  const points = db.prepare(`
    SELECT (ts / ?) * ? AS ts, AVG(cpu) AS cpu, AVG(mem) AS mem, AVG(disk) AS disk,
           AVG(temp) AS temp, AVG(rx) AS rx, AVG(tx) AS tx
    FROM stats WHERE ts >= ? GROUP BY ts / ? ORDER BY ts
  `).all(bucketMs, bucketMs, Date.now() - windowMs, bucketMs);
  res.json({ range, points });
});

statsRouter.get('/system', async (req, res) => {
  const [os, cpu, system] = await Promise.all([si.osInfo(), si.cpu(), si.system()]);
  res.json({
    hostname: os.hostname,
    os: `${os.distro} ${os.release}`.trim(),
    kernel: os.kernel,
    arch: os.arch,
    cpu: `${cpu.manufacturer} ${cpu.brand}`.trim(),
    cores: cpu.cores,
    model: [system.manufacturer, system.version || system.model].filter(Boolean).join(' '),
  });
});
