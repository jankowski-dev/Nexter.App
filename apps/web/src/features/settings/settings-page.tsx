import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Link } from '@tanstack/react-router';

export function SettingsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Настройки</h1>
        <p className="mt-1 text-sm text-zinc-400">Безопасность, счета и параметры отображения.</p>
      </div>

      <Card>
        <CardTitle>Безопасность</CardTitle>
        <CardDescription>Пароль, recovery codes и активные сессии.</CardDescription>
        <Link
          to="/settings/security"
          className="mt-4 inline-flex text-sm font-medium text-emerald-400 hover:text-emerald-300"
        >
          Открыть безопасность →
        </Link>
      </Card>
    </div>
  );
}
