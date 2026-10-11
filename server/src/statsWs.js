import { sample } from './stats.js';

const PUSH_INTERVAL_MS = 2000;

/** Pushes a live snapshot to every connected client. Sampling stops when nobody is watching. */
export function setupStatsWs(wss) {
  let timer = null;

  async function push() {
    try {
      const data = JSON.stringify(await sample());
      for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(data);
    } catch (err) {
      console.error('stats push failed:', err.message);
    }
  }

  wss.on('connection', (ws) => {
    ws.on('error', () => {});
    ws.on('close', () => {
      if (wss.clients.size === 0) {
        clearInterval(timer);
        timer = null;
      }
    });
    push();
    timer ??= setInterval(push, PUSH_INTERVAL_MS);
  });
}
