import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { TokenIcon } from '@/components/token-icon';
import { formatPct, formatPrice, pnlTone } from '@/lib/format';
import type { WatchlistEntry } from '@nexter/contracts';
import { TokenPriceChart } from './token-price-chart';

function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function LinkButton({ href, label }: { href: string | null; label: string }) {
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-emerald-800 hover:bg-emerald-50"
    >
      {label}
    </a>
  );
}

export function TokenInfoDialog({
  entry,
  onClose,
}: {
  entry: WatchlistEntry | null;
  onClose: () => void;
}) {
  if (!entry) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${entry.asset.symbol} · ${entry.asset.name}`}
      description={`${entry.asset.chainCode} · данные из базы токенов`}
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Закрыть
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <TokenIcon
              logoUrl={entry.logoUrl}
              symbol={entry.asset.symbol}
              className="h-12 w-12 text-sm"
            />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xl font-semibold text-zinc-900">{entry.asset.symbol}</span>
                <Badge tone="neutral">{entry.asset.chainCode}</Badge>
              </div>
              <div className="text-sm text-zinc-500">{entry.asset.name}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-xl font-semibold text-zinc-900">
              {formatPrice(entry.priceUsd)}
            </div>
            <div className={`text-sm ${pnlTone(entry.change24hPct)}`}>
              {entry.change24hPct ? formatPct(entry.change24hPct) : '24ч: —'}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 p-3">
          <TokenPriceChart entryId={entry.id} />
        </div>

        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Описание</div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">
            {entry.thesis ?? 'Описание не заполнено.'}
          </p>
        </div>

        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Ссылки</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <LinkButton href={safeExternalUrl(entry.twitterUrl)} label="Twitter / X" />
            <LinkButton href={safeExternalUrl(entry.telegramUrl)} label="Telegram" />
            <LinkButton href={safeExternalUrl(entry.discordUrl)} label="Discord" />
            <LinkButton href={safeExternalUrl(entry.websiteUrl)} label="Сайт" />
            {!entry.twitterUrl && !entry.telegramUrl && !entry.discordUrl && !entry.websiteUrl ? (
              <span className="text-sm text-zinc-500">Ссылки не заполнены.</span>
            ) : null}
          </div>
        </div>

        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Инвесторы</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {entry.investors.length > 0 ? (
              entry.investors.map((investor, index) => (
                <Badge key={`${investor}-${index}`} tone="neutral">
                  {investor}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-zinc-500">Не указаны.</span>
            )}
          </div>
        </div>

        {entry.tags.length > 0 ? (
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Теги</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {entry.tags.map((tag) => (
                <Badge key={tag} tone="info">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
