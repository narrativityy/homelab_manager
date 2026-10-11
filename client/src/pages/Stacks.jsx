import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import DockerUnavailable from '../components/DockerUnavailable.jsx';

const REFRESH_MS = 5000;

const STATE_LABEL = { running: 'Running', partial: 'Partly running', stopped: 'Stopped', down: 'Not created' };
const ACTION_LABEL = { up: 'Up', pull: 'Pull', update: 'Update', restart: 'Restart', stop: 'Stop', down: 'Down' };
const ACTION_RUNNING = {
  up: 'Bringing up',
  pull: 'Pulling images',
  update: 'Updating',
  restart: 'Restarting',
  stop: 'Stopping',
  down: 'Removing',
};

/** Live output of one compose job, streamed from the server. */
function JobOutput({ job, onDone, onDismiss }) {
  const [output, setOutput] = useState('');
  const [exitCode, setExitCode] = useState(null);
  const preRef = useRef(null);

  useEffect(() => {
    const source = new EventSource(`/api/stacks/jobs/${job.id}/stream`);
    source.addEventListener('output', (event) => setOutput((prev) => prev + JSON.parse(event.data)));
    source.addEventListener('done', (event) => {
      setExitCode(JSON.parse(event.data).exitCode);
      source.close();
      onDone();
    });
    // The job is gone (for example after a dashboard restart): stop the browser's automatic retries.
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) return;
      source.close();
      api.stackJob(job.id).then(
        (j) => {
          setOutput(j.output);
          if (!j.running) setExitCode(j.exitCode);
        },
        () => setExitCode(-1),
      );
    };
    return () => source.close();
  }, [job.id, onDone]);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [output]);

  const running = exitCode === null;
  return (
    <div className="job">
      <div className="job-head">
        <span role="status">
          {running
            ? `${ACTION_RUNNING[job.action]}…`
            : exitCode === 0
              ? `${ACTION_LABEL[job.action]} finished`
              : exitCode === -1
                ? 'Output is no longer available'
                : `${ACTION_LABEL[job.action]} failed (exit code ${exitCode})`}
        </span>
        {!running && (
          <button className="btn" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
      <pre className="logs job-output" ref={preRef} tabIndex={0}>
        {output || 'Starting…'}
      </pre>
    </div>
  );
}

function Stack({ stack, onChanged }) {
  // The job shown under this stack: one started here, or one found already running on load.
  const [job, setJob] = useState(stack.job);
  const [confirmDown, setConfirmDown] = useState(false);
  const [error, setError] = useState(null);
  const busy = Boolean(stack.job) || (job && job.pending);

  if (stack.job && (!job || job.id !== stack.job.id)) setJob(stack.job);

  async function act(action) {
    setError(null);
    setConfirmDown(false);
    setJob({ id: null, action, pending: true });
    try {
      const { jobId } = await api.stackAction(stack.name, action);
      setJob({ id: jobId, action });
      onChanged();
    } catch (err) {
      setError(err.message);
      setJob(null);
    }
  }

  const anyRunning = stack.containers.some((c) => c.state === 'running');
  const exists = stack.containers.length > 0;

  return (
    <section className="card stack">
      <header className="stack-head">
        <div>
          <h2>{stack.name}</h2>
          {stack.dir && <code className="dim small">{stack.dir}</code>}
        </div>
        <span className={`state state-${stack.state}`}>
          <i /> {STATE_LABEL[stack.state]}
        </span>
      </header>

      {exists && (
        <ul className="stack-containers">
          {stack.containers.map((c) => (
            <li key={c.id}>
              <span>
                <strong>{c.service || c.name}</strong> <span className="dim small">{c.image}</span>
              </span>
              <span className="dim small">{c.status}</span>
            </li>
          ))}
        </ul>
      )}

      {!stack.filesReadable && (
        <p className="notice">
          The dashboard cannot read this stack’s compose file, so it can restart, stop and remove the stack but not
          bring it up or update it. Give the <code>homelab_manager</code> user read access to the stack’s directory to
          enable those.
        </p>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="stack-actions">
        {confirmDown ? (
          <>
            <span className="dim">Remove {stack.name}’s containers and networks? Volumes are kept.</span>
            <button className="btn btn-danger" onClick={() => act('down')}>
              Down
            </button>
            <button className="btn" onClick={() => setConfirmDown(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            {stack.state !== 'running' && (
              <button className="btn" disabled={busy || !stack.filesReadable} onClick={() => act('up')}>
                Up
              </button>
            )}
            <button
              className="btn"
              disabled={busy || !stack.filesReadable}
              title="Pull newer images, then recreate what changed"
              onClick={() => act('update')}
            >
              Update
            </button>
            {anyRunning && (
              <>
                <button className="btn" disabled={busy} onClick={() => act('restart')}>
                  Restart
                </button>
                <button className="btn" disabled={busy} onClick={() => act('stop')}>
                  Stop
                </button>
              </>
            )}
            {exists && (
              <button className="btn btn-danger-outline" disabled={busy} onClick={() => setConfirmDown(true)}>
                Down
              </button>
            )}
          </>
        )}
      </div>

      {job?.id && <JobOutput key={job.id} job={job} onDone={onChanged} onDismiss={() => setJob(null)} />}
    </section>
  );
}

export default function Stacks() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(
    () =>
      api.stacks().then(
        (res) => {
          setData(res);
          setError(null);
        },
        (err) => setError(err.message),
      ),
    [],
  );

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const stacks = data?.stacks || [];
  const runningCount = stacks.filter((s) => s.state === 'running').length;

  return (
    <>
      <div className="page-head">
        <h1>Stacks</h1>
        <p>
          {data?.available
            ? `${runningCount} of ${stacks.length} running · Docker Compose ${data.composeVersion}`
            : ' '}
        </p>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {data && !data.available && <DockerUnavailable reason={data.reason} />}

      {data?.available && stacks.length === 0 && (
        <section className="card">
          <p className="dim">
            No Compose stacks found. Stacks appear here once they have been started on this server with docker compose.
          </p>
        </section>
      )}

      <div className="stacks">
        {stacks.map((s) => (
          <Stack key={s.name} stack={s} onChanged={load} />
        ))}
      </div>
    </>
  );
}
