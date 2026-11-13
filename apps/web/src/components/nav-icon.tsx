import type { ReactNode } from 'react';

export type NavIconName =
  | 'dashboard'
  | 'tasks'
  | 'testing'
  | 'crypto'
  | 'portfolio'
  | 'operations'
  | 'watchlist'
  | 'statistics'
  | 'finance'
  | 'notes'
  | 'vault'
  | 'notifications'
  | 'settings';

const icons: Record<NavIconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  tasks: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="m3.5 6 1.2 1.2L7.5 4.5M3.5 12l1.2 1.2L7.5 10.5M3.5 18l1.2 1.2L7.5 16.5" />
    </>
  ),
  testing: (
    <>
      <rect x="4.5" y="7" width="15" height="11.5" rx="3" />
      <path d="M12 3.5V7M8.5 12h.01M15.5 12h.01M9.5 15.5h5" />
    </>
  ),
  crypto: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 7.5h4a2.25 2.25 0 0 1 0 4.5h-4m0-4.5v9m0-4.5h4.5a2.25 2.25 0 0 1 0 4.5H9.5M11 5.5v2M13.5 5.5v2M11 16.5v2M13.5 16.5v2" />
    </>
  ),
  portfolio: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12V3.5Z" />
      <path d="M14.5 3.8A8.5 8.5 0 0 1 20.2 9.5H14.5V3.8Z" />
    </>
  ),
  operations: (
    <>
      <path d="M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3" />
    </>
  ),
  watchlist: (
    <>
      <path d="m12 3.5 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3.5Z" />
    </>
  ),
  statistics: (
    <>
      <path d="M5 20V11M11 20V4M17 20v-6M3 20h18" />
    </>
  ),
  finance: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18M7 15h3" />
    </>
  ),
  notes: (
    <>
      <path d="M6 4h10.5A2.5 2.5 0 0 1 19 6.5V20H8.5A2.5 2.5 0 0 1 6 17.5V4Z" />
      <path d="M9 4v16M12 8h4M12 12h4" />
    </>
  ),
  vault: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" />
    </>
  ),
  notifications: (
    <>
      <path d="M18 8.5a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
};

export function NavIcon({
  name,
  className = 'h-4 w-4',
}: {
  name: NavIconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[name]}
    </svg>
  );
}
