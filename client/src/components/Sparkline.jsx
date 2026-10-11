import { useState } from 'react';
import { formatTime } from '../format.js';

// Plot area inside the 0–100 viewBox, leaving room so the stroke is never clipped.
const TOP = 6;
const BOTTOM = 96;

/**
 * Single-series trend line with a hover crosshair.
 * points: [{ t: epoch ms, v: number|null }]. The scale runs from zero to max (fitted to the data when
 * max is omitted); fit instead scales to the data's own range, for measures where zero means nothing.
 */
export default function Sparkline({ points, max, fit = false, format, label }) {
  const [hover, setHover] = useState(null);
  const data = points.filter((p) => p.v != null);

  if (data.length < 2) return <div className="spark spark-empty">Collecting history…</div>;

  const values = data.map((p) => p.v);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = fit ? Math.max((high - low) * 0.25, 2) : 0;
  const floor = fit ? low - pad : 0;
  const top = fit ? high + pad : (max ?? (high * 1.15 || 1));
  const t0 = data[0].t;
  const span = data[data.length - 1].t - t0 || 1;
  const x = (p) => ((p.t - t0) / span) * 100;
  const y = (p) => BOTTOM - ((Math.min(p.v, top) - floor) / (top - floor)) * (BOTTOM - TOP);

  const line = data.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(2)},${y(p).toFixed(2)}`).join('');
  const area = `${line}L100,100L0,100Z`;

  function onMove(event) {
    const box = event.currentTarget.getBoundingClientRect();
    const t = t0 + ((event.clientX - box.left) / box.width) * span;
    let nearest = data[0];
    for (const p of data) if (Math.abs(p.t - t) < Math.abs(nearest.t - t)) nearest = p;
    setHover(nearest);
  }

  const summary = `${label}. Latest ${format(values.at(-1))}, low ${format(low)}, high ${format(high)}.`;

  return (
    <div className="spark" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={summary}>
        <path className="spark-area" d={area} />
        <path className="spark-line" d={line} vectorEffect="non-scaling-stroke" />
      </svg>
      {hover && (
        <>
          <span className="spark-cross" style={{ left: `${x(hover)}%` }} />
          <span className="spark-dot" style={{ left: `${x(hover)}%`, top: `${y(hover)}%` }} />
          <span className={`spark-tip ${x(hover) > 50 ? 'left' : 'right'}`} style={{ left: `${x(hover)}%` }}>
            <strong>{format(hover.v)}</strong> {formatTime(hover.t)}
          </span>
        </>
      )}
    </div>
  );
}
