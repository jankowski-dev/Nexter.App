import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Select } from '@/components/ui/select';
import { TokenIcon } from '@/components/token-icon';
import { formatPct, formatPrice, pnlTone } from '@/lib/format';
import { Link } from '@tanstack/react-router';
import type { WatchlistEntry, WatchlistGroup } from '@nexter/contracts';
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

export function TokenDrawer({
  entry,
  groupName,
  groups,
  defaultGroupId,
  onGroupChange,
  groupBusy,
  onClose,
  onEdit,
  onDelete,
  deleteBusy,
  error,
}: {
  entry: WatchlistEntry | null;
  groupName: string | null;
  groups: WatchlistGroup[];
  defaultGroupId: string | null;
  onGroupChange: (entry: WatchlistEntry, groupId: string) => void;
  groupBusy: boolean;
  onClose: () => void;
  onEdit: (entry: WatchlistEntry) => void;
  onDelete: (entry: WatchlistEntry) => void;
  deleteBusy: boolean;
  error?: string | null;
}) {
  if (!entry) return null;

  const chainLabel =
    entry.asset.chainCode === 'bsc'
      ? 'BNB Smart Chain'
      : entry.asset.chainCode === 'ethereum'
        ? 'Ethereum'
        : entry.asset.chainCode === 'tron'
          ? 'TRON'
          : entry.asset.chainCode === 'solana'
            ? 'Solana'
            : entry.asset.chainCode;
  const twitterUrl = safeExternalUrl(entry.twitterUrl);
  const websiteUrl = safeExternalUrl(entry.websiteUrl);
  const telegramUrl = safeExternalUrl(entry.telegramUrl);
  const discordUrl = safeExternalUrl(entry.discordUrl);
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
      description={`${entry.asset.name} · ${chainLabel}`}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
          <Button
            variant="ghost"
            className="text-red-700"
            onClick={() => onDelete(entry)}
            disabled={deleteBusy}
          >
            Удалить
          </Button>
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

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Группа</div>
            <div className="text-sm text-zinc-700">Можно перенести токен в другую группу</div>
          </div>
          <Select
            aria-label="Группа токена"
            className="w-56"
            value={entry.groupId ?? defaultGroupId ?? groups[0]?.id ?? ''}
            onChange={(event) => onGroupChange(entry, event.target.value)}
            disabled={groupBusy || groups.length === 0}
          >
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
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
            {telegramUrl ? (
              <a
                href={telegramUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-emerald-800 hover:bg-emerald-50"
              >
                Telegram
              </a>
            ) : null}
            {discordUrl ? (
              <a
                href={discordUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-emerald-800 hover:bg-emerald-50"
              >
                Discord
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
            {!twitterUrl && !telegramUrl && !discordUrl && !websiteUrl ? (
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
