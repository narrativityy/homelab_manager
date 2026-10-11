import { useState } from 'react';
import { api } from '../api.js';
import AuthCard, { Field } from '../components/AuthCard.jsx';

export default function Login({ onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(username, password);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Sign in" error={error} onSubmit={submit}>
      <Field
        label="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="username"
        autoCapitalize="none"
        autoFocus
        required
      />
      <Field
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        required
      />
      <button className="btn btn-primary" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </AuthCard>
  );
}
