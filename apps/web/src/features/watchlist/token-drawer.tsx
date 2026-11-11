import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { TokenIcon } from '@/components/token-icon';
import { formatPct, formatPrice, pnlTone } from '@/lib/format';
import { Link } from '@tanstack/react-router';
import type { WatchlistEntry } from '@nexter/contracts';

function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

export function TokenDrawer({
  entry,
  groupName,
  onClose,
  onEdit,
  onArchive,
  onRestore,
  busy,
  error,
}: {
  entry: WatchlistEntry | null;
  groupName: string | null;
  onClose: () => void;
  onEdit: (entry: WatchlistEntry) => void;
  onArchive: (entry: WatchlistEntry) => void;
  onRestore: (entry: WatchlistEntry) => void;
  busy: boolean;
  error?: string | null;
}) {
  if (!entry) return null;

  const twitterUrl = safeExternalUrl(entry.twitterUrl);
  const websiteUrl = safeExternalUrl(entry.websiteUrl);
  const bscAddress =
    entry.bscContractAddress ??
    (entry.asset.chainCode === 'bsc' ? entry.asset.contractAddress : null);
  const ethereumAddress =
    entry.ethereumContractAddress ??
    (entry.asset.chainCode === 'ethereum' ? entry.asset.contractAddress : null);

  return (
    <Drawer
      open
      onClose={onClose}
      title={entry.asset.symbol}
      description={`${entry.asset.name} · ${entry.asset.chainCode === 'ethereum' ? 'Ethereum' : 'BNB Smart Chain'}`}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
          {entry.archivedAt ? (
            <Button variant="secondary" onClick={() => onRestore(entry)} disabled={busy}>
              Вернуть
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => onArchive(entry)} disabled={busy}>
              В архив
            </Button>
          )}
          <Button onClick={() => onEdit(entry)}>Изменить</Button>
        </>
      }
    >
      <div className="space-y-5">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
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
                {groupName ? <Badge tone="info">{groupName}</Badge> : null}
                {entry.archivedAt ? <Badge tone="neutral">Архив</Badge> : null}
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

        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Контракты</div>
          <div className="mt-1 space-y-2">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
              <div className="text-[11px] font-medium text-zinc-500">BNB Smart Chain</div>
              {bscAddress ? (
                <a
                  className="mt-0.5 block break-all font-mono text-xs text-emerald-800 hover:underline"
                  href={`https://bscscan.com/address/${bscAddress}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {bscAddress}
                </a>
              ) : (
                <div className="mt-0.5 text-xs text-zinc-500">Не указан</div>
              )}
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
              <div className="text-[11px] font-medium text-zinc-500">Ethereum</div>
              {ethereumAddress ? (
                <a
                  className="mt-0.5 block break-all font-mono text-xs text-emerald-800 hover:underline"
                  href={`https://etherscan.io/address/${ethereumAddress}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {ethereumAddress}
                </a>
              ) : (
                <div className="mt-0.5 text-xs text-zinc-500">Не указан</div>
              )}
            </div>
          </div>
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
            {twitterUrl ? (
              <a
                href={twitterUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-emerald-800 hover:bg-emerald-50"
              >
                Twitter / X
              </a>
            ) : null}
            {websiteUrl ? (
              <a
                href={websiteUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-emerald-800 hover:bg-emerald-50"
              >
                Сайт
              </a>
            ) : null}
            {!twitterUrl && !websiteUrl ? (
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

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600">
          <span>Приоритет: {entry.priority}</span>
          <Link
            to="/portfolio/assets/$assetId"
            params={{ assetId: entry.asset.id }}
            className="text-emerald-800 hover:underline"
          >
            Полная карточка актива
          </Link>
        </div>
      </div>
    </Drawer>
  );
}
