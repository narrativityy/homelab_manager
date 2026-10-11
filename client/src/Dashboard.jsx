import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useStats } from './useStats.js';
import Overview from './pages/Overview.jsx';
import Containers from './pages/Containers.jsx';
import Settings from './pages/Settings.jsx';
import { Logo, MoonIcon, SunIcon } from './components/Icons.jsx';

const STATUS_LABEL = { live: 'Live', connecting: 'Connecting', offline: 'Reconnecting' };
const PAGES = [
  { path: '/', label: 'Overview' },
  { path: '/containers', label: 'Containers' },
  { path: '/settings', label: 'Settings' },
];

function useTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('hlm-theme', next); } catch { /* private mode: applies for this visit only */ }
    setTheme(next);
  }
  return [theme, toggle];
}

function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  function go(next) {
    history.pushState(null, '', next);
    setPath(next);
  }
  return [path, go];
}

export default function Dashboard({ username, onSignedOut }) {
  const { stats, status } = useStats(onSignedOut);
  const [theme, toggleTheme] = useTheme();
  const [path, go] = usePath();

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-main">
          <div className="brand"><Logo /> Homelab Manager</div>
          <nav aria-label="Pages">
            {PAGES.map((page) => (
              <a key={page.path} href={page.path} aria-current={path === page.path ? 'page' : undefined}
                onClick={(event) => { event.preventDefault(); go(page.path); }}>
                {page.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="topbar-actions">
          <span className={`conn conn-${status}`} role="status"><i /> {STATUS_LABEL[status]}</span>
          <button className="btn btn-icon" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <span className="user">{username}</span>
          <button className="btn" onClick={() => api.logout().finally(onSignedOut)}>Sign out</button>
        </div>
      </header>

      <main className="page">
        {path === '/settings' ? <Settings /> : path === '/containers' ? <Containers /> : <Overview stats={stats} />}
      </main>
    </div>
  );
}
