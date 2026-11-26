import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { fetchSwapOrders, submitSwap } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDate, formatTokenAmount, formatUsd } from '@/lib/format';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { SwapOrderSummary } from '@nexter/contracts';
import { selectRecoverableSwapOrders } from './swap-recovery';
import { isTransactionHash } from './wallet-request';

function explorerUrl(order: SwapOrderSummary): string | null {
  if (!order.walletAddress) return null;
  return order.chain === 'ethereum'
    ? `https://etherscan.io/address/${order.walletAddress}`
    : `https://bscscan.com/address/${order.walletAddress}`;
}

function RecoveryRow({ order }: { order: SwapOrderSummary }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [hash, setHash] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const link = explorerUrl(order);

  async function attach(): Promise<void> {
    const value = hash.trim();
    if (!isTransactionHash(value)) {
      setError('Введите хеш транзакции: 0x и 64 hex-символа.');
      return;
    }

    setPending(true);
    setError(null);
    try {
      await submitSwap(order.id, value);
      setDone(true);
      setHash('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['swap-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['positions'] }),
        queryClient.invalidateQueries({ queryKey: ['trade-groups'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['operations'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    } catch (err) {
      setError(toRussianError(err, 'Не удалось привязать хеш'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-white/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-zinc-900">
            {formatTokenAmount(order.amountIn, 8)} {order.tokenIn.symbol} →{' '}
            {formatTokenAmount(order.amountOut, 8)} {order.tokenOut.symbol}
          </p>
          <p className="text-xs text-zinc-500">
            {formatDate(order.createdAt)}
            {order.amountInUsd ? ` · ${formatUsd(order.amountInUsd)}` : ''}
          </p>
        </div>
        {!done ? (
          <Button
            variant="secondary"
            className="h-8 px-3 text-xs"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Свернуть' : 'Привязать хеш'}
          </Button>
        ) : (
          <span className="text-xs font-medium text-emerald-700">Хеш привязан</span>
        )}
      </div>

      {done ? (
        <p className="mt-2 text-xs text-emerald-700">
          Ждём подтверждение сети. После подтверждения своп появится в журнале и портфеле.
        </p>
      ) : open ? (
        <div className="mt-3 space-y-2">
          <Input
            value={hash}
            onChange={(event) => {
              setHash(event.target.value);
              setError(null);
            }}
            placeholder="0x…"
            className="h-9 font-mono text-xs"
            aria-invalid={Boolean(error)}
            autoComplete="off"
            spellCheck={false}
          />
          {error ? <p className="text-xs text-red-700">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="h-8 px-3 text-xs"
              onClick={() => void attach()}
              disabled={pending || !hash.trim()}
            >
              {pending ? 'Привязываю…' : 'Учесть транзакцию'}
            </Button>
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-emerald-700 underline-offset-2 hover:underline"
              >
                История кошелька
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Shows recent swaps whose wallet signature may have broadcast but whose hash
 * never reached the API. The hash can be copied from the wallet or explorer.
 */
export function SwapRecoveryPanel() {
  const query = useQuery({
    queryKey: ['swap-orders', 'awaiting-signature'],
    queryFn: () => fetchSwapOrders({ status: 'AWAITING_SIGNATURE', limit: 20 }),
    refetchInterval: 30_000,
    retry: false,
  });

  const orders = selectRecoverableSwapOrders(query.data?.data ?? [], Date.now());
  if (orders.length === 0) return null;

  return (
    <Card className="mb-4 border-amber-200 bg-amber-50/60">
      <div className="space-y-3 p-4">
        <div>
          <CardTitle>Незавершённые свопы</CardTitle>
          <p className="mt-1 text-xs text-zinc-600">
            Если транзакция уже прошла, но не появилась в журнале, привяжите её хеш из кошелька или
            обозревателя. Повторно подписывать не нужно.
          </p>
        </div>
        <div className="space-y-2">
          {orders.map((order) => (
            <RecoveryRow key={order.id} order={order} />
          ))}
        </div>
      </div>
    </Card>
  );
}
