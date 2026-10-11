import { useState } from 'react';
import { api } from '../api.js';
import AuthCard, { Field } from '../components/AuthCard.jsx';

const MIN_PASSWORD_LENGTH = 10;

export default function Setup({ onDone }) {
  const linkToken = new URLSearchParams(location.search).get('setup') || '';
  const [token, setToken] = useState(linkToken);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    setError(null);
    try {
      await api.setup(token.trim(), username.trim(), password);
      history.replaceState(null, '', '/'); // drop the one-time token from the address bar
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Create your admin account" error={error} onSubmit={submit}
      lead="This account controls the dashboard. You only do this once.">
      {!linkToken && (
        <Field label="Setup token" value={token} onChange={(e) => setToken(e.target.value)}
          hint="Printed in the server log when it starts: journalctl -u homelab_manager" autoFocus required />
      )}
      <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)}
        autoComplete="username" autoCapitalize="none" autoFocus={Boolean(linkToken)} required />
      <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} hint={`At least ${MIN_PASSWORD_LENGTH} characters`} required />
      <Field label="Confirm password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password" required />
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
    </AuthCard>
  );
}
