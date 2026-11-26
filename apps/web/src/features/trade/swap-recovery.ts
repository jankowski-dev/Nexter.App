export const SWAP_RECOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface RecoverableSwapOrderShape {
  status: string;
  txHash: string | null;
  createdAt: string;
}

/**
 * A swap stuck in AWAITING_SIGNATURE has no hash on the server even though the
 * wallet may have broadcast it. Only recent orders are surfaced for recovery;
 * older ones are historical noise.
 */
export function selectRecoverableSwapOrders<T extends RecoverableSwapOrderShape>(
  orders: T[],
  now: number,
): T[] {
  return orders.filter((order) => {
    if (order.status !== 'AWAITING_SIGNATURE' || order.txHash) return false;
    const createdAt = Date.parse(order.createdAt);
    return Number.isFinite(createdAt) && now - createdAt <= SWAP_RECOVERY_WINDOW_MS;
  });
}
