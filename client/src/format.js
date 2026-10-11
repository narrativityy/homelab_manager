const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes, digits = 1) {
  if (bytes == null) return '–';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : digits)} ${UNITS[unit]}`;
}

export const formatRate = (bytesPerSec) => (bytesPerSec == null ? '–' : `${formatBytes(bytesPerSec)}/s`);

export const formatPercent = (value) => (value == null ? '–' : `${Math.round(value)}%`);

export function formatUptime(seconds) {
  if (seconds == null) return '–';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
