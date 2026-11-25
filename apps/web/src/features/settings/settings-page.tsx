import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NavIcon, type NavIconName } from '@/components/nav-icon';
import { PageHeader } from '@/components/ui/page-header';
import { Link } from '@tanstack/react-router';

const settingsTones = {
  emerald: {
    card: 'hover:border-emerald-300',
    icon: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  sky: { card: 'hover:border-sky-300', icon: 'border-sky-200 bg-sky-50 text-sky-700' },
  amber: { card: 'hover:border-amber-300', icon: 'border-amber-200 bg-amber-50 text-amber-700' },
  violet: {
    card: 'hover:border-violet-300',
    icon: 'border-violet-200 bg-violet-50 text-violet-700',
  },
  rose: { card: 'hover:border-rose-300', icon: 'border-rose-200 bg-rose-50 text-rose-700' },
  zinc: { card: 'hover:border-zinc-300', icon: 'border-zinc-200 bg-zinc-100 text-zinc-600' },
} as const;

function SettingsNavCard({
  to,
  title,
  description,
  icon,
  tone,
}: {
  to: string;
  title: string;
  description: string;
  icon: NavIconName;
  tone: keyof typeof settingsTones;
}) {
  const styles = settingsTones[tone];
  return (
    <Link to={to} className="block">
      <Card className={`h-full p-4 transition-colors ${styles.card}`}>
        <div className="flex items-start gap-3">
          <span
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${styles.icon}`}
          >
            <NavIcon name={icon} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="font-medium text-zinc-900">{title}</div>
            <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
          </div>
        </div>
        <div className="mt-3 flex justify-end text-[11px] text-zinc-400">Открыть →</div>
      </Card>
    </Link>
  );
}

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Настройки"
        subtitle="Общие параметры, уведомления, безопасность, данные и экспорт."
      />

      <Card className="border-emerald-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700">
              <NavIcon name="download" className="h-6 w-6" />
            </span>
            <div>
              <div className="text-base font-semibold text-zinc-900">Инженерный гайд AI</div>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">
                23 страницы: данные, walk-forward, воронка поиска, fast engine, H5, рекомендации и
                paper-боты. PDF со схемами.
              </p>
            </div>
          </div>
          <Button
            asChild
            className="h-11 w-full border-emerald-500 bg-emerald-500 px-5 text-white shadow-sm hover:border-emerald-600 hover:bg-emerald-600 sm:w-auto"
          >
            <a
              href="/docs/nexter-ai-system-engineering.pdf?v=5"
              download="nexter-ai-system-engineering.pdf"
            >
              <NavIcon name="download" className="h-4 w-4" />
              Скачать PDF
            </a>
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SettingsNavCard
          to="/settings/general"
          title="Общие настройки"
          description="Базовая валюта, FIFO, часовой пояс и газ."
          icon="sliders"
          tone="emerald"
        />
        <SettingsNavCard
          to="/settings/notifications"
          title="Уведомления"
          description="События в приложении и частота обновления."
          icon="notifications"
          tone="amber"
        />
        <SettingsNavCard
          to="/settings/viber"
          title="ViberBot"
          description="Сделки, P&L, остановки роботов и периодичность."
          icon="notifications"
          tone="violet"
        />
        <SettingsNavCard
          to="/settings/accounting"
          title="Учёт и отчёты"
          description="Период статистики и правила учёта."
          icon="statistics"
          tone="emerald"
        />
        <SettingsNavCard
          to="/settings/market"
          title="Рынок и графики"
          description="Котировки, ликвидность, история и период графика."
          icon="watchlist"
          tone="sky"
        />
        <SettingsNavCard
          to="/settings/trading"
          title="Торговля и свопы"
          description="Slippage, price impact, gas и TTL котировки."
          icon="operations"
          tone="amber"
        />
        <SettingsNavCard
          to="/settings/bots"
          title="Роботы и бэктест"
          description="Тик, лимиты и значения по умолчанию."
          icon="testing"
          tone="violet"
        />
        <SettingsNavCard
          to="/settings/strategies"
          title="Стратегии"
          description="Справочник встроенных алгоритмов: описание, гайд и риски."
          icon="sliders"
          tone="violet"
        />
        <SettingsNavCard
          to="/settings/tasks"
          title="Задачи и заметки"
          description="Напоминания, время задачи и автосохранение."
          icon="tasks"
          tone="sky"
        />
        <SettingsNavCard
          to="/settings/ai"
          title="ИИ и аудио"
          description="DeepSeek, ключ API, модель и лимит аудио."
          icon="ai"
          tone="violet"
        />
        <SettingsNavCard
          to="/settings/interface"
          title="Интерфейс и поведение"
          description="Тема, автоблокировка, сеть и интервалы обновления."
          icon="sliders"
          tone="sky"
        />
        <SettingsNavCard
          to="/settings/security"
          title="Безопасность и аудит"
          description="Пароль, 2FA, сессии и журнал действий."
          icon="security"
          tone="emerald"
        />
        <SettingsNavCard
          to="/settings/diagnostics"
          title="Диагностика"
          description="Система и качество данных в одном месте."
          icon="system"
          tone="emerald"
        />
        <SettingsNavCard
          to="/settings/export"
          title="Экспорт"
          description="CSV/JSON для транзакций, позиций и сделок."
          icon="download"
          tone="zinc"
        />
        <SettingsNavCard
          to="/settings/data"
          title="Данные"
          description="Счета, справочники и импорт истории."
          icon="upload"
          tone="zinc"
        />
      </div>
    </div>
  );
}
