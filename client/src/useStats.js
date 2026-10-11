import { useEffect, useState } from 'react';

/**
 * Live machine stats over a WebSocket that reconnects on its own.
 * status is 'connecting', 'live' or 'offline'.
 */
export function useStats(onUnauthorized) {
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    let ws;
    let retry;
    let attempt = 0;
    let closed = false;

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws/stats`);
      ws.onopen = () => {
        attempt = 0;
        setStatus('live');
      };
      ws.onmessage = (event) => setStats(JSON.parse(event.data));
      ws.onclose = async () => {
        if (closed) return;
        setStatus('offline');
        // A refused upgrade looks like any other close, so ask whether the session is still valid.
        try {
          const res = await fetch('/api/auth/status');
          if (res.ok && !(await res.json()).username) return onUnauthorized();
        } catch {
          // server unreachable: keep retrying
        }
        attempt += 1;
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempt, 15000));
      };
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws.close();
    };
  }, [onUnauthorized]);

  return { stats, status };
}
