import { NexterLogo } from '@/components/nexter-logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiPost } from '@/lib/api';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';
import { useConfirm } from './confirm';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  createLockPin,
  isValidLockPin,
  verifyLockPin,
  type StoredLockPin,
} from './app-lock-crypto';

const PIN_KEY = 'nexter-lock-pin-v1';
const LOCKED_KEY = 'nexter-app-locked-v1';

interface AppLockContextValue {
  locked: boolean;
  hasPin: boolean;
  lock: () => void;
  openSetup: () => void;
  removePin: () => void;
  resetPin: () => void;
  clearLocked: () => void;
}

const noop = () => undefined;

const AppLockContext = createContext<AppLockContextValue>({
  locked: false,
  hasPin: false,
  lock: noop,
  openSetup: noop,
  removePin: noop,
  resetPin: noop,
  clearLocked: noop,
});

function readStoredPin(): StoredLockPin | null {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredLockPin>;
    if (
      typeof parsed.salt !== 'string' ||
      typeof parsed.hash !== 'string' ||
      typeof parsed.iterations !== 'number'
    ) {
      return null;
    }

    return { salt: parsed.salt, hash: parsed.hash, iterations: parsed.iterations };
  } catch {
    return null;
  }
}

function readLocked(): boolean {
  try {
    return localStorage.getItem(LOCKED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeLocked(value: boolean): void {
  try {
    if (value) localStorage.setItem(LOCKED_KEY, '1');
    else localStorage.removeItem(LOCKED_KEY);
  } catch {
    // Storage may be unavailable; the in-memory state still works.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function LockShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="auth-shell lock-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Блокировка Nexter"
    >
      <main className="auth-stage">
        <div className="lock-panel">{children}</div>
      </main>
    </div>
  );
}

function UnlockScreen({
  onUnlock,
  onUnlocked,
  onResetPin,
}: {
  onUnlock: (pin: string) => Promise<boolean>;
  onUnlocked: () => void;
  onResetPin: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [success, setSuccess] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  useBodyScrollLock(true);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const cooldownSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  async function submit(value = pin) {
    if (busy || success) return;
    if (cooldownSeconds > 0) return;
    if (!isValidLockPin(value)) {
      setError('Введите 6 цифр');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const ok = await onUnlock(value);
      if (!ok) {
        const attempts = failedAttempts + 1;
        setFailedAttempts(attempts);
        setShake(true);
        window.setTimeout(() => setShake(false), 500);
        setPin('');
        if (attempts >= 5) {
          setCooldownUntil(Date.now() + 30_000);
          setNow(Date.now());
          setError('Слишком много попыток. Подождите 30 секунд.');
        } else {
          setError(`Неверный код. Осталось попыток: ${5 - attempts}.`);
        }
        return;
      }

      setSuccess(true);
      setError('');
      await delay(240);
      onUnlocked();
    } finally {
      setBusy(false);
    }
  }

  async function resetAndLogout() {
    if (
      !(await confirm({
        title: 'Сбросить код блокировки?',
        description:
          'Код будет удалён, приложение выйдет из аккаунта. Для входа снова понадобятся пароль и код 2FA.',
        confirmLabel: 'Сбросить и выйти',
        variant: 'danger',
      }))
    ) {
      return;
    }

    onResetPin();
    try {
      await apiPost('/api/v1/auth/logout', {});
    } finally {
      queryClient.clear();
      await navigate({ to: '/login' });
    }
  }

  return (
    <LockShell>
      <div className="flex flex-col items-center text-center">
        <NexterLogo
          lit={success ? 12 : Math.min(12, pin.length * 2)}
          state={success ? 'ok' : error ? 'error' : 'idle'}
          className="auth-logo"
        />
        <h1 className="mt-7 text-xl font-semibold">
          {success ? 'Разблокировано' : 'Приложение заблокировано'}
        </h1>
        <p className="mt-1 text-sm text-[#c7c7c7]">
          {success
            ? 'Сейчас откроем рабочее пространство.'
            : 'Введите 6-значный код, чтобы продолжить.'}
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-5 w-full rounded-lg border border-[#e93f5b]/40 bg-[#e93f5b]/10 px-3 py-2 text-sm text-[#ffb3bf]"
          >
            {error}
          </div>
        ) : null}

        <form
          className={`mt-5 w-full space-y-3 ${shake ? 'auth-shake' : ''}`}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            className="auth-code-input"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="off"
            aria-label="Код блокировки"
            value={pin}
            onChange={(event) => {
              const next = event.target.value.replace(/\D/g, '');
              setPin(next);
              setError('');
              if (next.length === 6 && !busy && !success && cooldownSeconds === 0) {
                void submit(next);
              }
            }}
            autoFocus
            disabled={busy || success || cooldownSeconds > 0}
          />
          <div className="h-4 text-xs text-[#a8a8a8]" role="status" aria-live="polite">
            {success
              ? 'Разблокировано'
              : cooldownSeconds > 0
                ? `Подождите ${cooldownSeconds} с`
                : busy
                  ? 'Проверяем…'
                  : ''}
          </div>
        </form>

        <button
          type="button"
          className="mt-5 text-xs text-[#a8a8a8] underline-offset-4 hover:text-white hover:underline"
          onClick={() => void resetAndLogout()}
        >
          Забыли код? Сбросить и выйти
        </button>
      </div>
    </LockShell>
  );
}

function SetupScreen({
  onSave,
  onClose,
}: {
  onSave: (pin: string) => Promise<void>;
  onClose: () => void;
}) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useBodyScrollLock(true);

  async function submit() {
    setError('');
    if (!isValidLockPin(pin)) {
      setError('Код должен состоять из 6 цифр.');
      return;
    }
    if (pin !== confirm) {
      setError('Коды не совпадают.');
      return;
    }

    setBusy(true);
    try {
      await onSave(pin);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить код.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <LockShell>
      <div className="flex flex-col items-center text-center">
        <NexterLogo lit={Math.min(12, pin.length * 2)} className="auth-logo" />
        <h1 className="mt-7 text-xl font-semibold">Код блокировки</h1>
        <p className="mt-1 text-sm text-[#c7c7c7]">
          Придумайте 6 цифр для быстрой разблокировки. Код хранится только на этом устройстве.
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-5 w-full rounded-lg border border-[#e93f5b]/40 bg-[#e93f5b]/10 px-3 py-2 text-sm text-[#ffb3bf]"
          >
            {error}
          </div>
        ) : null}

        <form
          className="mt-5 w-full space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            className="auth-code-input"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="off"
            aria-label="Новый код блокировки"
            placeholder="Новый код"
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            autoFocus
            disabled={busy}
          />
          <Input
            className="auth-code-input"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="off"
            aria-label="Повторите код блокировки"
            placeholder="Повторите код"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value.replace(/\D/g, ''))}
            disabled={busy}
          />

          <Button className="w-full" type="submit" disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить и заблокировать'}
          </Button>
        </form>

        <button
          type="button"
          className="mt-5 text-xs text-[#a8a8a8] underline-offset-4 hover:text-white hover:underline"
          onClick={onClose}
          disabled={busy}
        >
          Отмена
        </button>

        <p className="mt-4 text-[11px] leading-relaxed text-[#8e8e8e]">
          Это экран приватности, а не замена паролю и 2FA. Он скрывает данные от случайных глаз, но
          не защищает от злоумышленника с доступом к устройству.
        </p>
      </div>
    </LockShell>
  );
}

export function LockProvider({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(readLocked);
  const [hasPin, setHasPin] = useState(() => Boolean(readStoredPin()));
  const [setupOpen, setSetupOpen] = useState(false);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === LOCKED_KEY) setLocked(event.newValue === '1');
      if (event.key === PIN_KEY) setHasPin(Boolean(readStoredPin()));
    }

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const lock = useCallback(() => {
    if (!readStoredPin()) {
      setSetupOpen(true);
      return;
    }
    writeLocked(true);
    setLocked(true);
  }, []);

  const unlock = useCallback(async (pin: string) => {
    const stored = readStoredPin();
    if (!stored) return false;
    return verifyLockPin(pin, stored);
  }, []);

  const savePin = useCallback(async (pin: string) => {
    const stored = await createLockPin(pin);
    localStorage.setItem(PIN_KEY, JSON.stringify(stored));
    setHasPin(true);
    setSetupOpen(false);
    writeLocked(true);
    setLocked(true);
  }, []);

  const resetPin = useCallback(() => {
    try {
      localStorage.removeItem(PIN_KEY);
    } catch {
      // Ignore storage failures.
    }
    setHasPin(false);
  }, []);

  const removePin = useCallback(() => {
    resetPin();
    writeLocked(false);
    setLocked(false);
  }, [resetPin]);

  const clearLocked = useCallback(() => {
    writeLocked(false);
    setLocked(false);
  }, []);

  const value = useMemo<AppLockContextValue>(
    () => ({
      locked,
      hasPin,
      lock,
      openSetup: () => setSetupOpen(true),
      removePin,
      resetPin,
      clearLocked,
    }),
    [clearLocked, hasPin, lock, locked, removePin, resetPin],
  );

  return (
    <AppLockContext.Provider value={value}>
      {children}
      {setupOpen ? <SetupScreen onSave={savePin} onClose={() => setSetupOpen(false)} /> : null}
      {locked ? (
        <UnlockScreen onUnlock={unlock} onUnlocked={clearLocked} onResetPin={resetPin} />
      ) : null}
    </AppLockContext.Provider>
  );
}

export function useAppLock(): AppLockContextValue {
  return useContext(AppLockContext);
}
