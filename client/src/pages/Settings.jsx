import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const RESTART_TIMEOUT_MS = 45 * 1000;
const START_COMMAND = 'sudo systemctl start homelab_manager';

const formatStarted = (ts) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

function StopDialog({ dialogRef, onStopped }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.serviceStop(password);
      onStopped();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={() => {
        setPassword('');
        setError(null);
      }}
    >
      <form onSubmit={submit}>
        <h2>Stop the dashboard?</h2>
        <p>It will go offline and can't be started again from the browser. To bring it back, run this on the server:</p>
        <pre>
          <code>{START_COMMAND}</code>
        </pre>
        <label className="field">
          <span>Confirm your password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => dialogRef.current.close()}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={busy}>
            {busy ? 'Stopping…' : 'Stop dashboard'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export default function Settings() {
  const [service, setService] = useState(null);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | restarting | restarted | stopped
  const [bootBusy, setBootBusy] = useState(false);
  const dialogRef = useRef(null);

  useEffect(() => {
    api.service().then(setService, (err) => setError(err.message));
  }, []);

  async function restart() {
    setError(null);
    setPhase('restarting');
    const before = service.startedAt;
    try {
      await api.serviceRestart();
    } catch (err) {
      setError(err.message);
      return setPhase('idle');
    }
    // The new process reports a later start time; until then requests fail or return the old one.
    const deadline = Date.now() + RESTART_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const next = await api.service().catch(() => null);
      if (next && next.startedAt > before) {
        setService(next);
        return setPhase('restarted');
      }
    }
    setError(
      `The dashboard did not come back within ${RESTART_TIMEOUT_MS / 1000} seconds. Check it on the server with: sudo homelab_manager logs`,
    );
    setPhase('idle');
  }

  async function setBoot(enabled) {
    setError(null);
    setBootBusy(true);
    try {
      setService(await api.serviceBoot(enabled));
    } catch (err) {
      setError(err.message);
    }
    setBootBusy(false);
  }

  if (phase === 'stopped') {
    return (
      <div className="page-head">
        <h1>Dashboard stopped</h1>
        <p>Start it again from the server with:</p>
        <pre>
          <code>{START_COMMAND}</code>
        </pre>
      </div>
    );
  }

  const usable = service?.managed && service.canControl;

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <p>Manage the dashboard itself.</p>
      </div>

      <section className="card settings-card">
        <h2>Dashboard service</h2>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {service && !service.managed && (
          <p className="notice">
            This dashboard was started by hand, not as a systemd service, so there is nothing to control here. Install
            it with the installer to get restart, stop and start-on-boot controls.
          </p>
        )}
        {service?.managed && !service.canControl && (
          <p className="notice">
            The sudo rule that lets the dashboard manage its own service is missing. Re-run the installer to restore it.
          </p>
        )}

        <dl>
          <dt>Version</dt>
          <dd>{service?.version ?? '–'}</dd>
          <dt>Running since</dt>
          <dd>{service ? formatStarted(service.startedAt) : '–'}</dd>
          {service?.managed && (
            <>
              <dt>Service</dt>
              <dd>
                <code>{service.unit}</code>
              </dd>
            </>
          )}
        </dl>

        {usable && (
          <>
            <div className="setting">
              <div>
                <strong id="boot-label">Start on boot</strong>
                <p>Start the dashboard automatically when the server starts.</p>
              </div>
              <button
                className="switch"
                role="switch"
                aria-checked={service.startOnBoot}
                aria-labelledby="boot-label"
                disabled={bootBusy}
                onClick={() => setBoot(!service.startOnBoot)}
              >
                <span />
              </button>
            </div>

            <div className="setting">
              <div>
                <strong>Restart</strong>
                <p role="status">
                  {phase === 'restarting'
                    ? 'Restarting… this page reconnects on its own.'
                    : phase === 'restarted'
                      ? 'Restarted.'
                      : 'Stops and starts the dashboard. You stay signed in.'}
                </p>
              </div>
              <button className="btn" disabled={phase === 'restarting'} onClick={restart}>
                Restart
              </button>
            </div>

            <div className="setting">
              <div>
                <strong>Stop</strong>
                <p>Shuts the dashboard down until it is started from the server.</p>
              </div>
              <button
                className="btn btn-danger-outline"
                disabled={phase === 'restarting'}
                onClick={() => dialogRef.current.showModal()}
              >
                Stop…
              </button>
            </div>
          </>
        )}
      </section>

      <StopDialog
        dialogRef={dialogRef}
        onStopped={() => {
          dialogRef.current.close();
          setPhase('stopped');
        }}
      />
    </>
  );
}
