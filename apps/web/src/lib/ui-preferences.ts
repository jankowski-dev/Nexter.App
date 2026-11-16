export type ThemePreference = 'light' | 'dark';

const THEME_KEY = 'nexter-theme';
const IDLE_LOCK_KEY = 'nexter-idle-lock-minutes';
const PREFERENCE_EVENT = 'nexter-ui-preference';

export const DEFAULT_IDLE_LOCK_MINUTES = 5;

export const idleLockOptions = [
  { value: 0, label: 'Не блокировать' },
  { value: 1, label: '1 минута' },
  { value: 3, label: '3 минуты' },
  { value: 5, label: '5 минут' },
  { value: 10, label: '10 минут' },
  { value: 15, label: '15 минут' },
  { value: 30, label: '30 минут' },
  { value: 60, label: '1 час' },
] as const;

export function readTheme(): ThemePreference {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function writeTheme(theme: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage may be unavailable; the current session still uses the theme.
  }
  emitPreference(THEME_KEY);
}

export function readIdleLockMinutes(): number {
  try {
    const raw = localStorage.getItem(IDLE_LOCK_KEY);
    if (raw === null) return DEFAULT_IDLE_LOCK_MINUTES;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_IDLE_LOCK_MINUTES;
    return idleLockOptions.some((option) => option.value === parsed)
      ? parsed
      : DEFAULT_IDLE_LOCK_MINUTES;
  } catch {
    return DEFAULT_IDLE_LOCK_MINUTES;
  }
}

export function writeIdleLockMinutes(minutes: number): void {
  try {
    localStorage.setItem(IDLE_LOCK_KEY, String(minutes));
  } catch {
    // Storage may be unavailable; the current session still uses the value.
  }
  emitPreference(IDLE_LOCK_KEY);
}

export function subscribeUiPreference(key: string, listener: () => void): () => void {
  function onCustom(event: Event) {
    const detail = (event as CustomEvent<{ key?: string }>).detail;
    if (!detail?.key || detail.key === key) listener();
  }

  function onStorage(event: StorageEvent) {
    if (event.key === key) listener();
  }

  window.addEventListener(PREFERENCE_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(PREFERENCE_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}

function emitPreference(key: string): void {
  try {
    window.dispatchEvent(new CustomEvent(PREFERENCE_EVENT, { detail: { key } }));
  } catch {
    // CustomEvent is available in browsers; ignore unusual environments.
  }
}
