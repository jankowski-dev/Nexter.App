import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  ApiError,
  buildSwap,
  buildSwapApproval,
  cancelSwap,
  cancelSwapSigning,
  fetchSwapConfig,
  fetchTradeGroup,
  fetchSwapOrder,
  markSwapSigning,
  quoteSwap,
  readySwap,
  stepUp,
  submitSwap,
  submitSwapApproval,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatCount, formatSignedUsd, formatTokenAmount, formatUsd, pnlTone } from '@/lib/format';
import { useWalletConnect } from '@/lib/walletconnect';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { useEffect, useRef, useState } from 'react';
import type { TradeGroupSummary } from '@nexter/contracts';

type ItemStatus =
  | 'pending'
  | 'quoting'
  | 'building'
  | 'approval'
  | 'signing'
  | 'submitting'
  | 'pending_confirmation'
  | 'accounting_pending'
  | 'confirmed'
  | 'failed';

interface CloseItem {
  key: string;
  assetId: string;
  symbol: string;
  chain: 'bsc' | 'ethereum';
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  groups: TradeGroupSummary[];
  invested: Decimal;
  status: ItemStatus;
  message: string | null;
  orderId: string | null;
  txHash: string | null;
}

const STATUS_LABELS: Record<ItemStatus, string> = {
  pending: 'Ожидает',
  quoting: 'Котировка',
  building: 'Сборка',
  approval: 'Разрешение',
  signing: 'Подпись',
  submitting: 'Отправка',
  pending_confirmation: 'Ожидает подтверждения',
  accounting_pending: 'Ожидает учёта',
  confirmed: 'Подтверждено',
  failed: 'Ошибка',
};

const STATUS_TONES: Record<ItemStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  pending: 'neutral',
  quoting: 'info',
  building: 'info',
  approval: 'warning',
  signing: 'warning',
  submitting: 'info',
  pending_confirmation: 'warning',
  accounting_pending: 'warning',
  confirmed: 'success',
  failed: 'danger',
};

function swapTokenAddress(
  asset: TradeGroupSummary['asset'],
  config:
    | {
        chains: Array<{
          code: string;
          tokens: Array<{ symbol: string; address: string; native: boolean }>;
        }>;
      }
    | undefined,
): string | null {
  const chain = config?.chains.find((item) => item.code === asset.chainCode);
  if (!chain) return null;

  if (asset.contractAddress) {
    const token = chain.tokens.find(
      (item) => !item.native && item.address.toLowerCase() === asset.contractAddress?.toLowerCase(),
    );
    return token?.address ?? null;
  }

  const native = chain.tokens.find((item) => item.native && item.symbol === asset.symbol);
  return native?.address ?? null;
}

const RECOVERY_KEY = 'nexter.close-trades.recovery';

interface RecoveryEntry {
  orderId?: string;
  txHash?: string;
  status?: ItemStatus;
  message?: string | null;
}

type RecoveryMap = Record<string, RecoveryEntry>;

function selectionSignature(groups: Array<{ id: string; remainingAmount: string }>): string {
  return groups
    .map((group) => `${group.id}:${group.remainingAmount}`)
    .sort()
    .join('|');
}

function readRecovery(): RecoveryMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(RECOVERY_KEY);
    return raw ? (JSON.parse(raw) as RecoveryMap) : {};
  } catch {
    return {};
  }
}

function writeRecovery(recovery: RecoveryMap): void {
  if (typeof window === 'undefined') return;
  try {
    if (Object.keys(recovery).length === 0) {
      window.localStorage.removeItem(RECOVERY_KEY);
    } else {
      window.localStorage.setItem(RECOVERY_KEY, JSON.stringify(recovery));
    }
  } catch {
    // Storage may be unavailable; the in-memory recovery still works.
  }
}

function chainIdFor(code: 'bsc' | 'ethereum'): number {
  return code === 'ethereum' ? 1 : 56;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isStepUp(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'SWAP_STEP_UP_REQUIRED';
}

function statusBadge(status: ItemStatus) {
  return <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function CloseTradesDialog({
  open,
  onClose,
  groups,
  onCompleted,
}: {
  open: boolean;
  onClose: () => void;
  groups: TradeGroupSummary[];
  onCompleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ['swap-config'], queryFn: fetchSwapConfig });
  const selectedIdsKey = groups.map((group) => group.id).join(',');
  const freshGroups = useQuery({
    queryKey: ['trade-groups', 'close-refresh', selectedIdsKey],
    queryFn: async () => {
      const details = await Promise.all(groups.map((group) => fetchTradeGroup(group.id)));
      return details.map((detail) => detail.group);
    },
    enabled: open && groups.length > 0,
  });
  const wallet = useWalletConnect(config.data?.walletConnectProjectId ?? null);
  const [items, setItems] = useState<CloseItem[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpCode, setStepUpCode] = useState('');
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const stepUpResolver = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  const itemsRef = useRef<CloseItem[]>([]);
  const itemsLocked = useRef(false);
  const stepUpInputRef = useRef<HTMLInputElement>(null);

  const safeConfig = config.data;
  const usdcFor = (chain: 'bsc' | 'ethereum'): string | null => {
    const chainConfig = safeConfig?.chains.find((item) => item.code === chain);
    const token = chainConfig?.tokens.find((item) => item.symbol === 'USDC' && !item.native);
    return token?.address ?? null;
  };

  useEffect(() => {
    if (!open) {
      itemsLocked.current = false;
      return;
    }
    if (itemsLocked.current) return;

    const grouped = new Map<string, TradeGroupSummary[]>();
    const previousBySignature = new Map(
      itemsRef.current.map((item) => [selectionSignature(item.groups), item]),
    );
    const recovery = readRecovery();
    const sourceGroups = freshGroups.data ?? groups;

    for (const group of sourceGroups) {
      if (group.status === 'closed' || new Decimal(group.remainingAmount).lte(0)) continue;
      const list = grouped.get(group.asset.id) ?? [];
      list.push(group);
      grouped.set(group.asset.id, list);
    }

    const next: CloseItem[] = [...grouped.values()]
      .map((assetGroups) => {
        const first = assetGroups[0];
        const chain: 'bsc' | 'ethereum' = first.asset.chainCode === 'ethereum' ? 'ethereum' : 'bsc';
        const decimals = first.asset.decimals;
        const amount = assetGroups
          .reduce((total, group) => total.plus(group.remainingAmount), new Decimal(0))
          .toFixed(decimals);
        const invested = assetGroups.reduce(
          (total, group) => total.plus(group.buyUsd),
          new Decimal(0),
        );

        const tokenIn = swapTokenAddress(first.asset, safeConfig) ?? '';
        const tokenOut = usdcFor(chain) ?? '';
        const message = !tokenIn
          ? 'Токен не входит в swap allowlist'
          : !tokenOut
            ? `В сети ${chain} не найден USDC`
            : null;

        const signature = selectionSignature(assetGroups);
        const previous = previousBySignature.get(signature);
        const saved = recovery[signature];
        const recoveredOrderId = previous?.orderId ?? saved?.orderId ?? null;
        const recoveredTxHash = previous?.txHash ?? saved?.txHash ?? null;
        const hasRecovery = Boolean(recoveredOrderId || recoveredTxHash);
        const recoveredSource = previous ?? saved;
        const recoveredStatus: ItemStatus =
          hasRecovery &&
          recoveredSource?.status &&
          ['pending_confirmation', 'accounting_pending', 'confirmed'].includes(
            recoveredSource.status,
          )
            ? recoveredSource.status
            : hasRecovery
              ? 'failed'
              : 'pending';

        return {
          key: first.asset.id,
          assetId: first.asset.id,
          symbol: first.asset.symbol,
          chain,
          chainId: chainIdFor(chain),
          tokenIn,
          tokenOut,
          amount,
          groups: assetGroups,
          invested,
          status: recoveredStatus,
          message: hasRecovery
            ? (recoveredSource?.message ?? 'Есть незавершённая транзакция. Нажмите «Продолжить».')
            : message,
          orderId: recoveredOrderId,
          txHash: recoveredTxHash,
        };
      })
      .sort((a, b) => {
        const chainOrder = (item: CloseItem) => (item.chain === 'bsc' ? 0 : 1);
        return chainOrder(a) - chainOrder(b) || b.invested.comparedTo(a.invested);
      });

    setItems(next);
    itemsRef.current = next;
    setResult(null);
    setError(null);
  }, [freshGroups.data, groups, open, safeConfig]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!open || items.length === 0) return;

    const next = readRecovery();

    for (const item of items) {
      const signature = selectionSignature(item.groups);

      if (
        ['confirmed', 'accounting_pending'].includes(item.status) ||
        (!item.orderId && !item.txHash)
      ) {
        delete next[signature];
        continue;
      }

      next[signature] = {
        ...(item.orderId ? { orderId: item.orderId } : {}),
        ...(item.txHash ? { txHash: item.txHash } : {}),
        status: item.status,
        message: item.message,
      };
    }

    writeRecovery(next);
  }, [items, open]);

  useEffect(() => {
    if (!stepUpOpen) return;
    stepUpInputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    stepUpInputRef.current?.focus();
  }, [stepUpOpen]);

  function updateItemByKey(key: string, patch: Partial<CloseItem>): void {
    setItems((current) => {
      const next = current.map((item) => (item.key === key ? { ...item, ...patch } : item));
      itemsRef.current = next;
      return next;
    });
  }

  const pendingSignature = items
    .filter(
      (item) =>
        item.orderId && ['pending_confirmation', 'accounting_pending'].includes(item.status),
    )
    .map((item) => `${item.key}:${item.orderId}:${item.status}`)
    .join('|');

  useEffect(() => {
    if (!open || !pendingSignature) return;

    const timer = window.setInterval(async () => {
      const pending = itemsRef.current.filter(
        (item) =>
          item.orderId && ['pending_confirmation', 'accounting_pending'].includes(item.status),
      );

      for (const item of pending) {
        try {
          const order = await fetchSwapOrder(item.orderId as string);

          if (order.status === 'CONFIRMED') {
            updateItemByKey(item.key, {
              status: order.accountingTransactionId ? 'confirmed' : 'accounting_pending',
              message: order.accountingTransactionId
                ? 'Учёт создан'
                : 'Своп подтверждён, ожидает учёта',
            });

            if (order.accountingTransactionId) {
              void queryClient.invalidateQueries({ queryKey: ['trade-groups'] });
              void queryClient.invalidateQueries({ queryKey: ['positions'] });
              void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
              onCompleted?.();
            }
          } else if (
            ['FAILED', 'REPLACED', 'DROPPED', 'CANCELLED', 'EXPIRED'].includes(order.status)
          ) {
            updateItemByKey(item.key, {
              status: 'failed',
              message: `Своп завершился со статусом ${order.status}`,
              orderId: null,
              txHash: null,
            });
          }
        } catch {
          // Keep polling.
        }
      }
    }, 10_000);

    return () => window.clearInterval(timer);
  }, [open, pendingSignature, queryClient, onCompleted]);

  const totalInvested = items.reduce((total, item) => total.plus(item.invested), new Decimal(0));
  const totalPnl = items.reduce(
    (total, item) =>
      total.plus(
        item.groups.reduce(
          (groupTotal, group) => groupTotal.plus(group.totalPnlUsd ?? '0'),
          new Decimal(0),
        ),
      ),
    new Decimal(0),
  );
  const confirmedCount = items.filter((item) => item.status === 'confirmed').length;
  const executionReady = Boolean(
    safeConfig?.executionEnabled &&
    items.every((item) => {
      if (item.message) return true;
      const chain = safeConfig.chains.find((entry) => entry.code === item.chain);
      return chain?.executionEnabled;
    }),
  );
  const freshGroupsReady = Boolean(
    freshGroups.data && !freshGroups.isFetching && !freshGroups.isError,
  );
  const canStart = Boolean(
    wallet.connected &&
    safeConfig?.enabled &&
    executionReady &&
    freshGroupsReady &&
    items.length > 0 &&
    items.some(
      (item) =>
        !['confirmed', 'pending_confirmation', 'accounting_pending'].includes(item.status) &&
        !item.message,
    ),
  );

  function updateItem(index: number, patch: Partial<CloseItem>): void {
    setItems((current) => {
      const next = current.map((item, currentIndex) =>
        currentIndex === index ? { ...item, ...patch } : item,
      );
      itemsRef.current = next;
      return next;
    });
  }

  function requestStepUp(): Promise<void> {
    return new Promise((resolve, reject) => {
      stepUpResolver.current = { resolve, reject };
      setStepUpCode('');
      setStepUpError(null);
      setStepUpOpen(true);
    });
  }

  async function runWithStepUp<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (err) {
      if (!isStepUp(err)) throw err;
      await requestStepUp();
      return action();
    }
  }

  async function confirmStepUp(): Promise<void> {
    try {
      await stepUp(stepUpCode);
      setStepUpOpen(false);
      stepUpResolver.current?.resolve();
      stepUpResolver.current = null;
    } catch (err) {
      setStepUpError(toRussianError(err, 'Не удалось подтвердить TOTP'));
    }
  }

  function cancelStepUp(): void {
    setStepUpOpen(false);
    stepUpResolver.current?.reject(new Error('Подтверждение TOTP отменено'));
    stepUpResolver.current = null;
  }

  function describeError(error: unknown, fallback: string): string {
    if (error instanceof ApiError) return toRussianError(error, fallback);
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  }

  async function waitForFinalStatus(
    orderId: string,
  ): Promise<{ status: string; accounting: boolean }> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const order = await fetchSwapOrder(orderId);
        if (
          ['CONFIRMED', 'FAILED', 'REPLACED', 'DROPPED', 'CANCELLED', 'EXPIRED'].includes(
            order.status,
          )
        ) {
          return {
            status: order.status,
            accounting: Boolean(order.accountingTransactionId),
          };
        }
      } catch {
        // Keep polling; tracking may lag behind submission.
      }
      await sleep(5_000);
    }
    return { status: 'PENDING', accounting: false };
  }

  async function submitOrReconcile(orderId: string, hash: string): Promise<void> {
    try {
      await runWithStepUp(() => submitSwap(orderId, hash));
    } catch (err) {
      if (err instanceof ApiError && ['CONFLICT', 'SWAP_STATE_INVALID'].includes(err.code)) {
        const order = await fetchSwapOrder(orderId);
        if (order.txHash && order.txHash.toLowerCase() === hash.toLowerCase()) return;
      }
      throw err;
    }
  }

  function applyFinalStatus(index: number, outcome: { status: string; accounting: boolean }): void {
    if (outcome.status === 'CONFIRMED') {
      updateItem(index, {
        status: outcome.accounting ? 'confirmed' : 'accounting_pending',
        message: outcome.accounting ? 'Учёт создан' : 'Своп подтверждён, ожидает учёта',
      });
      return;
    }

    if (outcome.status === 'PENDING') {
      updateItem(index, {
        status: 'pending_confirmation',
        message: 'Отправлено, ожидает подтверждения. Статус обновится автоматически.',
      });
      return;
    }

    throw new Error(`Своп завершился со статусом ${outcome.status}`);
  }

  async function cancelAbandonedOrder(item: CloseItem, index: number): Promise<void> {
    if (!item.orderId || item.txHash) return;

    try {
      await cancelSwapSigning(item.orderId);
    } catch {
      // The order may not be in AWAITING_SIGNATURE.
    }

    try {
      await cancelSwap(item.orderId);
    } catch {
      // The order may already be terminal.
    }

    updateItem(index, { orderId: null });
  }

  async function quoteFor(item: CloseItem) {
    if (!safeConfig || !wallet.address) throw new Error('Кошелёк не подключён');
    return quoteSwap({
      chain: item.chain,
      tokenIn: item.tokenIn,
      tokenOut: item.tokenOut,
      amountIn: item.amount,
      slippageBps: safeConfig.defaultSlippageBps,
      walletAddress: wallet.address,
      closeGroupIds: item.groups.map((group) => group.id),
    });
  }

  async function executeItem(item: CloseItem, index: number): Promise<void> {
    if (!wallet.address) throw new Error('Кошелёк не подключён');
    if (item.message) throw new Error(item.message);
    if (!safeConfig) throw new Error('Конфигурация свопов не загружена');
    if (!item.tokenIn || !item.tokenOut) {
      throw new Error('Не найден адрес токена или USDC для этой сети');
    }

    const chainConfig = safeConfig.chains.find((chain) => chain.code === item.chain);
    if (!safeConfig.executionEnabled || !chainConfig?.executionEnabled) {
      throw new Error(`Исполнение для сети ${item.chain} выключено на сервере.`);
    }

    // A hash can only be retried by re-submitting it; never sign a second swap.
    if (item.txHash && item.orderId) {
      updateItem(index, { status: 'submitting', message: null });
      await submitOrReconcile(item.orderId, item.txHash);
      updateItem(index, { status: 'pending_confirmation' });
      const outcome = await waitForFinalStatus(item.orderId);
      if (outcome.status !== 'CONFIRMED' && outcome.status !== 'PENDING') {
        updateItem(index, { orderId: null, txHash: null });
      }
      applyFinalStatus(index, outcome);
      return;
    }

    await cancelAbandonedOrder(item, index);

    updateItem(index, { status: 'quoting', message: null, orderId: null, txHash: null });
    let quote = await quoteFor(item);

    updateItem(index, { status: 'building', orderId: quote.id });
    let build;
    try {
      build = await buildSwap(quote.id, wallet.address);
    } catch (err) {
      if (!isStepUp(err)) throw err;
      await cancelSwap(quote.id).catch(() => undefined);
      await requestStepUp();
      // A TOTP prompt usually outlives the 15s quote. Start with a fresh one.
      quote = await quoteFor(item);
      updateItem(index, { status: 'building', orderId: quote.id });
      build = await buildSwap(quote.id, wallet.address);
    }

    if (
      build.id !== quote.id ||
      build.chain !== item.chain ||
      !build.walletAddress ||
      build.walletAddress.toLowerCase() !== wallet.address.toLowerCase()
    ) {
      throw new Error('Сборка не совпала с кошельком или сетью. Обновите котировку.');
    }

    if (build.approvalRequired || build.status === 'APPROVAL_REQUIRED') {
      updateItem(index, { status: 'approval' });
      const approval = await runWithStepUp(() => buildSwapApproval(quote.id));

      if (
        approval.approval.orderId !== quote.id ||
        approval.approval.chain !== item.chain ||
        approval.approval.walletAddress.toLowerCase() !== wallet.address.toLowerCase()
      ) {
        throw new Error('Approval не совпал с ордером или кошельком. Обновите котировку.');
      }

      const approvalHash = await wallet.sendTransaction({
        chainId: item.chainId,
        to: approval.to,
        data: approval.calldata,
        value: approval.value,
      });
      await submitSwapApproval(approval.approval.id, approvalHash);
      await wallet.waitForReceipt(approvalHash);
      build = await runWithStepUp(() => readySwap(quote.id));
      if (
        build.id !== quote.id ||
        build.chain !== item.chain ||
        !build.walletAddress ||
        build.walletAddress.toLowerCase() !== wallet.address.toLowerCase()
      ) {
        throw new Error('Готовая сборка не совпала с кошельком или сетью. Обновите котировку.');
      }
    }

    if (!build.routerAddress || !build.calldata) {
      throw new Error('Сервер не вернул calldata для закрытия');
    }
    if (build.deadline && Date.now() / 1000 >= build.deadline) {
      throw new Error('Срок действия котировки истёк. Запустите закрытие ещё раз.');
    }

    updateItem(index, { status: 'signing' });
    await runWithStepUp(() => markSwapSigning(quote.id));
    updateItem(index, { orderId: quote.id });

    let hash: string;
    try {
      hash = await wallet.sendTransaction({
        chainId: item.chainId,
        to: build.routerAddress,
        data: build.calldata,
        value: build.transactionValue ?? '0',
      });
    } catch (err) {
      await cancelSwapSigning(quote.id).catch(() => undefined);
      throw err;
    }

    updateItem(index, { status: 'submitting', orderId: quote.id, txHash: hash });
    await submitOrReconcile(quote.id, hash);
    updateItem(index, { status: 'pending_confirmation' });
    const outcome = await waitForFinalStatus(quote.id);
    if (outcome.status !== 'CONFIRMED' && outcome.status !== 'PENDING') {
      updateItem(index, { orderId: null, txHash: null });
    }
    applyFinalStatus(index, outcome);
  }

  async function runBatch(): Promise<void> {
    if (!freshGroups.data || freshGroups.isFetching || freshGroups.isError) {
      setError('Не удалось обновить выбранные сделки. Закройте окно и обновите список.');
      return;
    }
    if (!wallet.connected) {
      setError('Сначала подключите Tangem.');
      return;
    }
    if (!safeConfig?.enabled) {
      setError('Свопы отключены или сработал kill switch.');
      return;
    }
    if (!safeConfig.executionEnabled) {
      setError('Исполнение свопов выключено на сервере.');
      return;
    }
    if (
      items.some((item) => {
        if (item.message) return false;
        const chain = safeConfig.chains.find((entry) => entry.code === item.chain);
        return !chain?.executionEnabled;
      })
    ) {
      setError('Исполнение выключено для одной из выбранных сетей.');
      return;
    }

    itemsLocked.current = true;
    setRunning(true);
    setError(null);
    setResult(null);

    const plan = itemsRef.current.map((item) => ({ ...item }));
    let failed = false;

    for (let index = 0; index < plan.length; index += 1) {
      if (
        ['confirmed', 'pending_confirmation', 'accounting_pending'].includes(plan[index].status) ||
        plan[index].message
      ) {
        continue;
      }

      try {
        await executeItem(plan[index], index);
      } catch (err) {
        failed = true;
        updateItem(index, {
          status: 'failed',
          message: describeError(err, 'Не удалось закрыть сделку'),
        });
        break;
      }
    }

    setRunning(false);
    await queryClient.invalidateQueries({ queryKey: ['trade-groups'] });
    await queryClient.invalidateQueries({ queryKey: ['positions'] });
    await queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    onCompleted?.();

    if (failed) {
      setError('Батч остановлен на ошибке. Исправьте причину и нажмите «Продолжить».');
    } else {
      const latest = itemsRef.current;
      const confirmed = latest.filter((item) => item.status === 'confirmed').length;
      const pending = latest.filter((item) =>
        ['pending_confirmation', 'accounting_pending'].includes(item.status),
      ).length;
      setResult(
        `Готово: подтверждено ${confirmed}${pending > 0 ? `, ожидают подтверждения ${pending}` : ''}.`,
      );
    }
  }

  function retryBatch(): void {
    setItems((current) => {
      const next = current.map((item) =>
        item.status === 'failed' ? { ...item, status: 'pending' as const, message: null } : item,
      );
      itemsRef.current = next;
      return next;
    });
    setError(null);
    window.setTimeout(() => void runBatch(), 0);
  }

  const closeBlocked = running || stepUpOpen;
  const close = () => {
    if (closeBlocked) return;
    itemsLocked.current = false;
    onClose();
  };

  const progressTotal = items.filter((item) => !item.message).length;
  const progressDone = items.filter((item) =>
    ['confirmed', 'pending_confirmation', 'accounting_pending'].includes(item.status),
  ).length;

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Закрытие сделок"
      description="Последовательное закрытие: один swap на токен. Для каждого токена нужна подпись Tangem."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={closeBlocked}>
            Закрыть
          </Button>
          {!running && items.some((item) => item.status === 'failed') ? (
            <Button variant="secondary" onClick={retryBatch} disabled={!wallet.connected}>
              Продолжить
            </Button>
          ) : null}
          <Button variant="danger" onClick={() => void runBatch()} disabled={!canStart || running}>
            {running
              ? `Закрываю ${Math.min(progressDone + 1, progressTotal)} из ${progressTotal}…`
              : 'Закрыть сделки'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!safeConfig?.enabled ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Свопы отключены или сработал kill switch. Закрытие недоступно.
          </div>
        ) : null}
        {safeConfig?.enabled && !executionReady ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Исполнение выключено для одной из выбранных сетей. Approval и подпись недоступны.
          </div>
        ) : null}
        {freshGroups.isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Не удалось обновить выбранные сделки. Закройте окно и обновите список.
          </div>
        ) : null}
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        {result ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {result}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 p-3">
            <div className="text-xs text-zinc-500">Вложено</div>
            <div className="mt-1 font-mono text-lg font-semibold text-zinc-900">
              {formatUsd(totalInvested.toFixed(8))}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-200 p-3">
            <div className="text-xs text-zinc-500">Итоговый P&L</div>
            <div className={`mt-1 font-mono text-lg font-semibold ${pnlTone(totalPnl.toFixed(8))}`}>
              {formatSignedUsd(totalPnl.toFixed(8))}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-200 p-3">
            <div className="text-xs text-zinc-500">Подтверждено</div>
            <div className="mt-1 font-mono text-lg font-semibold text-zinc-900">
              {formatCount(confirmedCount)} / {formatCount(items.length)}
            </div>
          </div>
        </div>

        {!wallet.connected ? (
          <Card>
            <CardTitle>Подключите Tangem</CardTitle>
            <CardDescription>
              Для закрытия нужна подпись в кошельке. Приватные ключи не передаются серверу.
            </CardDescription>
            <Button
              className="mt-3"
              onClick={() => void wallet.connect()}
              disabled={wallet.connecting || !safeConfig?.walletConnectProjectId}
            >
              {wallet.connecting ? 'Подключаю…' : 'Подключить Tangem'}
            </Button>
            {wallet.error ? <p className="mt-2 text-sm text-red-700">{wallet.error}</p> : null}
          </Card>
        ) : (
          <div className="text-xs text-zinc-500">
            Кошелёк: <span className="font-mono">{wallet.address}</span>
          </div>
        )}

        <Card>
          <CardTitle>Очередь закрытия</CardTitle>
          <CardDescription>
            Сначала BSC, затем Ethereum. Внутри сети — по убыванию вложенной суммы.
          </CardDescription>
          <div className="mt-3 space-y-2">
            {items.map((item) => (
              <div
                key={item.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 p-3 text-sm"
              >
                <div>
                  <div className="font-medium text-zinc-900">
                    {item.symbol} · {item.chain}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {formatCount(item.groups.length)} групп · {formatTokenAmount(item.amount)}{' '}
                    {item.symbol} · вложено {formatUsd(item.invested.toFixed(8))}
                  </div>
                  {item.message ? (
                    <div className="mt-1 text-xs text-red-700">{item.message}</div>
                  ) : null}
                  {item.txHash ? (
                    <div className="mt-1 break-all font-mono text-xs text-zinc-500">
                      {item.txHash}
                    </div>
                  ) : null}
                </div>
                {statusBadge(item.status)}
              </div>
            ))}
          </div>
        </Card>

        {stepUpOpen ? (
          <Card className="border-amber-200 bg-amber-50">
            <CardTitle className="text-amber-800">Подтвердите TOTP</CardTitle>
            <CardDescription className="text-amber-700">
              Сумма выше порога step-up. Введите свежий код из приложения.
            </CardDescription>
            <Input
              ref={stepUpInputRef}
              className="mt-3 max-w-xs font-mono tracking-[0.3em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={stepUpCode}
              onChange={(event) => setStepUpCode(event.target.value.replace(/\D/g, ''))}
              aria-label="Код TOTP"
            />
            {stepUpError ? <p className="mt-2 text-sm text-red-700">{stepUpError}</p> : null}
            <div className="mt-3 flex gap-2">
              <Button variant="ghost" onClick={cancelStepUp}>
                Отмена
              </Button>
              <Button onClick={() => void confirmStepUp()} disabled={stepUpCode.length !== 6}>
                Подтвердить
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
    </Dialog>
  );
}
