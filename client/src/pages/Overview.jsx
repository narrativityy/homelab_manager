import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatBytes, formatPercent, formatRate, formatUptime } from '../format.js';
import StatTile, { Meter, levelFor } from '../components/StatTile.jsx';

const HISTORY_REFRESH_MS = 60 * 1000;

// [warn, crit] thresholds
const CPU_LEVELS = [75, 90];
const USAGE_LEVELS = [80, 90];
const TEMP_LEVELS = [75, 85];

const formatTemp = (celsius) => (celsius == null ? '–' : `${Math.round(celsius)}°C`);

function batteryState(battery) {
  if (battery.charging) return 'Charging';
  return battery.acConnected ? 'Plugged in' : 'On battery';
}

export default function Overview({ stats }) {
  const [system, setSystem] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    api.system().then(setSystem, () => {});
    const load = () =>
      api.history('1h').then(
        (res) => setHistory(res.points),
        () => {},
      );
    load();
    const id = setInterval(load, HISTORY_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // The stored per-minute history, with the live reading as the newest point.
  function trend(key, live, options) {
    const points = history.map((p) => ({ t: p.ts, v: p[key] }));
    if (stats && live != null && stats.ts > (points.at(-1)?.t ?? 0)) points.push({ t: stats.ts, v: live });
    return { points, label: 'Last hour', ...options };
  }

  const s = stats;
  const subtitle = [system?.os, system?.model, s && `up ${formatUptime(s.uptime)}`].filter(Boolean).join(' · ');

  return (
    <>
      <div className="page-head">
        <h1>{system?.hostname || 'Overview'}</h1>
        <p>{subtitle || ' '}</p>
      </div>

      <div className="tiles">
        <StatTile
          label="CPU"
          value={formatPercent(s?.cpu.percent)}
          detail={s ? `${s.cpu.cores} threads · load ${s.cpu.loadAvg.toFixed(2)}` : ' '}
          percent={s?.cpu.percent ?? 0}
          level={levelFor(s?.cpu.percent, CPU_LEVELS)}
          trend={trend('cpu', s?.cpu.percent, { max: 100, format: formatPercent })}
        />

        <StatTile
          label="Memory"
          value={formatPercent(s?.mem.percent)}
          detail={s ? `${formatBytes(s.mem.used)} of ${formatBytes(s.mem.total)}` : ' '}
          percent={s?.mem.percent ?? 0}
          level={levelFor(s?.mem.percent, USAGE_LEVELS)}
          trend={trend('mem', s?.mem.percent, { max: 100, format: formatPercent })}
        />

        <StatTile
          label={`Disk${s?.disk ? ` (${s.disk.mount})` : ''}`}
          value={formatPercent(s?.disk?.percent)}
          detail={s?.disk ? `${formatBytes(s.disk.used)} of ${formatBytes(s.disk.size)}` : ' '}
          percent={s?.disk?.percent ?? 0}
          level={levelFor(s?.disk?.percent, USAGE_LEVELS)}
          trend={trend('disk', s?.disk?.percent, { max: 100, format: formatPercent })}
        />

        {(!s || s.temp != null) && (
          <StatTile
            label="Temperature"
            value={formatTemp(s?.temp)}
            detail="CPU"
            level={levelFor(s?.temp, TEMP_LEVELS)}
            trend={trend('temp', s?.temp, { fit: true, format: formatTemp })}
          />
        )}

        <StatTile
          label="Network"
          value={<>↓ {formatRate(s?.net.rx)}</>}
          detail={s ? `↑ ${formatRate(s.net.tx)} · ${s.net.iface}` : ' '}
          trend={trend('rx', s?.net.rx, { format: formatRate, label: 'Download, last hour' })}
        />

        {s?.battery && (
          <StatTile
            label="Battery"
            value={formatPercent(s.battery.percent)}
            detail={batteryState(s.battery)}
            percent={s.battery.percent}
            level={!s.battery.acConnected && s.battery.percent <= 20 ? 'warn' : 'ok'}
          />
        )}
      </div>

      <div className="cards">
        <section className="card">
          <h2>Storage</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mount</th>
                  <th className="wide-only">Device</th>
                  <th className="num">Used</th>
                  <th className="num">Size</th>
                  <th>Usage</th>
                </tr>
              </thead>
              <tbody>
                {(s?.disks || []).map((d) => (
                  <tr key={d.mount}>
                    <td>
                      <code>{d.mount}</code>
                    </td>
                    <td className="dim wide-only">
                      {d.fs} · {d.type}
                    </td>
                    <td className="num">{formatBytes(d.used)}</td>
                    <td className="num">{formatBytes(d.size)}</td>
                    <td>
                      <div className="usage">
                        <Meter percent={d.percent} level={levelFor(d.percent, USAGE_LEVELS)} />
                        <span className="num">{formatPercent(d.percent)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h2>System</h2>
          <dl>
            <dt>OS</dt>
            <dd>{system?.os || '–'}</dd>
            <dt>Kernel</dt>
            <dd>{system ? `${system.kernel} (${system.arch})` : '–'}</dd>
            <dt>Processor</dt>
            <dd>{system?.cpu || '–'}</dd>
            <dt>Hardware</dt>
            <dd>{system?.model || '–'}</dd>
            <dt>Uptime</dt>
            <dd>{formatUptime(s?.uptime)}</dd>
            <dt>Swap</dt>
            <dd>{s ? `${formatBytes(s.mem.swapUsed)} of ${formatBytes(s.mem.swapTotal)}` : '–'}</dd>
          </dl>
        </section>
      </div>
    </>
  );
}
