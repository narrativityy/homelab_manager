const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export const Logo = () => (
  <svg className="logo" viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
    <rect width="32" height="32" rx="7" fill="var(--accent)" />
    <g fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
      <rect x="7" y="8" width="18" height="6.5" rx="2" />
      <rect x="7" y="17.5" width="18" height="6.5" rx="2" />
    </g>
    <circle cx="11.2" cy="11.25" r="1.2" fill="#fff" />
    <circle cx="11.2" cy="20.75" r="1.2" fill="#fff" />
  </svg>
);

export const SunIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...stroke}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const MoonIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...stroke}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </svg>
);

export const AlertIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" {...stroke} strokeWidth="2.2">
    <path d="M12 3.5 2.5 20h19L12 3.5zM12 10v4.5M12 17.4v.1" />
  </svg>
);
