import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchAccounts } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

const accountTypeLabels: Record<string, string> = {
  wallet: 'Кошелёк',
  external: 'Внешний',
  income: 'Доход',
  expense: 'Расход',
  equity: 'Капитал',
};

export function AccountsSettingsPage() {
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Счета"
        subtitle="Кошельки и системные счета, создаваемые автоматически."
        actions={
          <Button variant="secondary" asChild>
            <Link to="/settings">Назад</Link>
          </Button>
        }
      />
      {accounts.isPending ? <LoadingRows rows={6} /> : null}
      {accounts.isError ? (
        <ErrorState
          message={toRussianError(accounts.error, 'Не удалось загрузить счета')}
          onRetry={() => void accounts.refetch()}
        />
      ) : null}
      {accounts.data ? (
        <Card>
          <CardTitle>Список счетов</CardTitle>
          <CardDescription>
            Создание и переименование счетов появится в следующей итерации; текущие счета созданы
            bootstrap-процессом.
          </CardDescription>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-3 font-medium">Название</th>
                  <th className="py-2 pr-3 font-medium">Тип</th>
                  <th className="py-2 pr-3 font-medium">Сеть</th>
                  <th className="py-2 text-right font-medium">Системный</th>
                </tr>
              </thead>
              <tbody>
                {accounts.data.accounts.map((account) => (
                  <tr
                    key={account.id}
                    className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                  >
                    <td className="py-2 pr-3 text-zinc-800">{account.name}</td>
                    <td className="py-2 pr-3 text-zinc-600">
                      {accountTypeLabels[account.type] ?? account.type}
                    </td>
                    <td className="py-2 pr-3 text-zinc-600">{account.chainCode ?? '—'}</td>
                    <td className="py-2 text-right">
                      <Badge tone={account.isSystem ? 'info' : 'neutral'}>
                        {account.isSystem ? 'да' : 'нет'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
