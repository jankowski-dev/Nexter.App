import { Button } from '@/components/ui/button';
import { Link } from '@tanstack/react-router';
import { SettingsCard, SettingsPageShell } from './settings-form';

export function DataSettingsPage() {
  return (
    <SettingsPageShell title="Данные" description="Счета, справочники и импорт истории.">
      <SettingsCard title="Справочники">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" asChild>
            <Link to="/settings/accounts">Счета</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link to="/import">Импорт Notion</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link to="/settings/export">Экспорт CSV/JSON</Link>
          </Button>
        </div>
      </SettingsCard>
      <SettingsCard title="Экспорт">
        <p className="text-sm text-zinc-600">
          Выгрузки транзакций, позиций и сделок перенесены в отдельный раздел «Экспорт»: CSV для
          таблиц и JSON для полного набора полей.
        </p>
        <Button variant="secondary" asChild>
          <Link to="/settings/export">Открыть экспорт</Link>
        </Button>
      </SettingsCard>
    </SettingsPageShell>
  );
}
