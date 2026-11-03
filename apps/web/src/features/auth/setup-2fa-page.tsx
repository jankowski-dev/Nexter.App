import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, apiPost } from '@/lib/api';
import { apiErrorReason, toRussianError } from '@/lib/error-messages';
import { FormError, Field } from './form-helpers';
import { twoFactorSetupResponseSchema, twoFactorVerifyResponseSchema } from '@nexter/contracts';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';

export function Setup2faPage() {
  const navigate = useNavigate();
  const started = useRef(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void apiPost('/api/v1/auth/2fa/setup', {}, twoFactorSetupResponseSchema)
      .then((result) => {
        setQrDataUrl(result.qrDataUrl);
        setSecret(result.secret);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof ApiError && requestError.code === 'AUTH_REQUIRED') {
          void navigate({ to: '/login' });
          return;
        }
        if (
          requestError instanceof ApiError &&
          apiErrorReason(requestError) === 'TOTP_ALREADY_ENABLED'
        ) {
          void navigate({ to: '/dashboard' });
          return;
        }
        setError(toRussianError(requestError, 'Не удалось начать настройку 2FA.'));
      });
  }, [navigate]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      await apiPost('/api/v1/auth/2fa/enable', { code }, twoFactorVerifyResponseSchema);
      await navigate({ to: '/dashboard' });
    } catch (requestError) {
      setError(toRussianError(requestError, 'Не удалось включить 2FA.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-zinc-50">Включите 2FA</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Отсканируйте QR-код в Google Authenticator, 1Password, Authy или аналогичном приложении.
        </p>
      </div>

      {error ? <FormError>{error}</FormError> : null}

      {qrDataUrl ? (
        <div className="flex justify-center rounded-md border border-zinc-800 bg-white p-4">
          <img src={qrDataUrl} alt="QR-код для TOTP" className="h-56 w-56" />
        </div>
      ) : (
        <div className="flex h-64 items-center justify-center rounded-md border border-zinc-800 text-sm text-zinc-500">
          Готовим QR-код…
        </div>
      )}

      {secret ? (
        <div className="space-y-1 text-xs text-zinc-500">
          <div>Если QR не читается, введите секрет вручную:</div>
          <code className="block break-all rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-zinc-300">
            {secret}
          </code>
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={submit}>
        <Field label="Код из приложения">
          <Input
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            required
          />
        </Field>

        <Button className="w-full" type="submit" disabled={loading || !qrDataUrl}>
          {loading ? 'Проверяем…' : 'Включить 2FA'}
        </Button>
      </form>
    </div>
  );
}
