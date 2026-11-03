import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, apiPost } from '@/lib/api';
import { FormError, Field } from './form-helpers';
import { recoveryCodesResponseSchema } from '@nexter/contracts';
import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

export function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newCodes, setNewCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await apiPost(
        '/api/v1/auth/password/reset',
        { email, recoveryCode, newPassword },
        recoveryCodesResponseSchema,
      );
      setNewCodes(result.recoveryCodes);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'Не удалось сбросить пароль.',
      );
    } finally {
      setLoading(false);
    }
  }

  if (newCodes.length > 0) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-zinc-50">Пароль изменён</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Сохраните новые recovery codes. Старые коды больше не действуют.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono text-sm text-zinc-200">
          {newCodes.map((code) => (
            <span key={code}>{code}</span>
          ))}
        </div>

        <Button asChild className="w-full">
          <Link to="/login">Перейти ко входу</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-zinc-50">Сброс пароля</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Нужен recovery code. Email используется только как логин.
        </p>
      </div>

      {error ? <FormError>{error}</FormError> : null}

      <form className="space-y-4" onSubmit={submit}>
        <Field label="Email">
          <Input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>

        <Field label="Recovery code">
          <Input
            autoComplete="off"
            value={recoveryCode}
            onChange={(event) => setRecoveryCode(event.target.value)}
            required
          />
        </Field>

        <Field label="Новый пароль (минимум 12 символов)">
          <Input
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </Field>

        <Button className="w-full" type="submit" disabled={loading}>
          {loading ? 'Меняем…' : 'Сбросить пароль'}
        </Button>
      </form>

      <div className="text-center text-sm text-zinc-500">
        <Link className="hover:text-zinc-300" to="/login">
          Вернуться ко входу
        </Link>
      </div>
    </div>
  );
}
