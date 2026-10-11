import { useId } from 'react';
import { Logo } from './Icons.jsx';

export default function AuthCard({ title, lead, error, children, onSubmit }) {
  return (
    <main className="auth">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="brand">
          <Logo /> Homelab Manager
        </div>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
        {children}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}

export function Field({ label, hint, ...input }) {
  const hintId = useId();
  return (
    <div className="field">
      <label>
        <span>{label}</span>
        <input aria-describedby={hint ? hintId : undefined} {...input} />
      </label>
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}
