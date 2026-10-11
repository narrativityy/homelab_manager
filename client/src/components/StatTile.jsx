import Sparkline from './Sparkline.jsx';
import { AlertIcon } from './Icons.jsx';

const LEVEL_LABEL = { warn: 'High', crit: 'Critical' };

/** Returns 'crit', 'warn' or 'ok' for a value against its [warn, crit] thresholds. */
export function levelFor(value, [warn, crit]) {
  if (value == null) return 'ok';
  return value >= crit ? 'crit' : value >= warn ? 'warn' : 'ok';
}

export function Meter({ percent, level = 'ok' }) {
  return (
    <div className={`meter level-${level}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
      <span style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  );
}

export default function StatTile({ label, value, detail, percent, level = 'ok', trend }) {
  return (
    <section className="tile">
      <header>
        <h2>{label}</h2>
        {LEVEL_LABEL[level] && (
          <span className={`chip level-${level}`}><AlertIcon /> {LEVEL_LABEL[level]}</span>
        )}
      </header>
      <div className="tile-value">{value}</div>
      <div className="tile-detail">{detail}</div>
      {percent != null && <Meter percent={percent} level={level} />}
      {trend && (
        <figure className="tile-trend">
          <Sparkline {...trend} />
          <figcaption>{trend.label}</figcaption>
        </figure>
      )}
    </section>
  );
}
