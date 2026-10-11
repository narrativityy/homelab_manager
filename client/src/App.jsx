import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Setup from './pages/Setup.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './Dashboard.jsx';

export default function App() {
  const [auth, setAuth] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    api.authStatus().then(setAuth, (err) => setError(err.message));
  }, []);
  useEffect(refresh, [refresh]);

  const signedOut = useCallback(() => setAuth({ setupRequired: false, username: null }), []);

  if (error) {
    return (
      <div className="splash">
        <p>Can't reach the server.</p>
        <button
          className="btn"
          onClick={() => {
            setError(null);
            refresh();
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!auth) return <div className="splash" aria-busy="true" />;
  if (auth.setupRequired) return <Setup onDone={refresh} />;
  if (!auth.username) return <Login onDone={refresh} />;
  return <Dashboard username={auth.username} onSignedOut={signedOut} />;
}
