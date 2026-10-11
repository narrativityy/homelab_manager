import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const REFRESH_MS = 5000;
const GRANT_COMMAND = 'sudo usermod -aG docker homelab_manager && sudo systemctl restart homelab_manager';

const UNAVAILABLE = {
  'not-installed': { title: 'Docker is not installed', body: 'Install Docker on this server and its containers will show up here.' },
  'not-running': { title: 'Docker is not running', body: 'Start it on the server with: sudo systemctl start docker' },
  'no-permission': {
    title: 'The dashboard is not allowed to use Docker',
    body: 'Access to Docker is equivalent to root on this server, so it is not granted by default. To allow it, run this on the server:',
    command: GRANT_COMMAND,
  },
};

const STATE_LABEL = { running: 'Running', exited: 'Stopped', paused: 'Paused', restarting: 'Restarting', created: 'Created', dead: 'Dead' };

function LogsDialog({ container, onClose }) {
  const dialogRef = useRef(null);
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.containerLogs(container.id).then((res) => setLogs(res.logs), (err) => setError(err.message));
  }, [container.id]);

  useEffect(() => {
    dialogRef.current.showModal();
    load();
  }, [load]);

  // Keep the newest lines in view, as a terminal would.
  const preRef = useRef(null);
  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [logs]);

  return (
    <dialog ref={dialogRef} className="dialog-wide" onClose={onClose}>
      <header className="dialog-head">
        <h2>{container.name} logs</h2>
        <div className="dialog-actions">
          <button className="btn" onClick={load}>Refresh</button>
          <button className="btn" onClick={() => dialogRef.current.close()}>Close</button>
        </div>
      </header>
      {error && <p className="form-error" role="alert">{error}</p>}
      <pre className="logs" ref={preRef} tabIndex={0}>
        {logs == null ? 'Loading…' : logs || 'No log output.'}
      </pre>
      <p className="dim">Last 200 lines.</p>
    </dialog>
  );
}

function Row({ container, onChanged, onLogs }) {
  const [busy, setBusy] = useState(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [error, setError] = useState(null);
  const running = container.state === 'running' || container.state === 'restarting' || container.state === 'paused';

  async function act(action) {
    setBusy(action);
    setError(null);
    setConfirmStop(false);
    try {
      await api.containerAction(container.id, action);
      await onChanged();
    } catch (err) {
      setError(err.message);
    }
    setBusy(null);
  }

  return (
    <tr>
      <td>
        <strong>{container.name}</strong>
        <div className="dim small">{container.image}</div>
        {error && <div className="row-error" role="alert">{error}</div>}
      </td>
      <td>
        <span className={`state state-${container.state}`}><i /> {STATE_LABEL[container.state] || container.state}</span>
        <div className="dim small">{container.status}</div>
      </td>
      <td className="wide-only">
        {container.ports.length ? container.ports.map((p) => <code className="port" key={p}>{p}</code>) : <span className="dim">–</span>}
      </td>
      <td>
        <div className="row-actions">
          {busy ? (
            <span className="dim">{busy === 'stop' ? 'Stopping…' : busy === 'start' ? 'Starting…' : 'Restarting…'}</span>
          ) : confirmStop ? (
            <>
              <span className="dim">Stop {container.name}?</span>
              <button className="btn btn-danger" onClick={() => act('stop')}>Stop</button>
              <button className="btn" onClick={() => setConfirmStop(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => onLogs(container)}>Logs</button>
              {running ? (
                <>
                  <button className="btn" onClick={() => act('restart')}>Restart</button>
                  <button className="btn btn-danger-outline" onClick={() => setConfirmStop(true)}>Stop</button>
                </>
              ) : (
                <button className="btn" onClick={() => act('start')}>Start</button>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function Containers() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [logsFor, setLogsFor] = useState(null);

  const load = useCallback(
    () => api.docker().then((res) => { setData(res); setError(null); }, (err) => setError(err.message)),
    []
  );

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const containers = data?.containers || [];
  const runningCount = containers.filter((c) => c.state === 'running').length;
  const unavailable = data && !data.available ? UNAVAILABLE[data.reason] : null;

  return (
    <>
      <div className="page-head">
        <h1>Containers</h1>
        <p>{data?.available ? `${runningCount} of ${containers.length} running` : ' '}</p>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {unavailable && (
        <section className="card settings-card">
          <h2>{unavailable.title}</h2>
          <p>{unavailable.body}</p>
          {unavailable.command && <pre><code>{unavailable.command}</code></pre>}
        </section>
      )}

      {data?.available && containers.length === 0 && (
        <section className="card"><p className="dim">No containers yet. Containers you create on this server will appear here.</p></section>
      )}

      {containers.length > 0 && (
        <section className="card">
          <div className="table-wrap">
            <table className="containers">
              <thead>
                <tr><th>Container</th><th>State</th><th className="wide-only">Published ports</th><th><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {containers.map((c) => <Row key={c.id} container={c} onChanged={load} onLogs={setLogsFor} />)}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {logsFor && <LogsDialog container={logsFor} onClose={() => setLogsFor(null)} />}
    </>
  );
}
