export const WALLET_RESPONSE_TIMEOUT_MS = 90_000;

export type WalletHashOutcome =
  { status: 'hash'; hash: string } | { status: 'error'; error: unknown };

export function isTransactionHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

export interface TrackedWalletRequest {
  outcome: Promise<WalletHashOutcome>;
  /** Use when the wallet broadcast the transaction but did not return its hash. */
  submitManualHash: (hash: string) => void;
}

/**
 * WalletConnect normally resolves `eth_sendTransaction` with the transaction
 * hash, but the JSON-RPC response can be lost after the wallet broadcasts it.
 * Waiting on that promise alone leaves the UI stuck forever.
 *
 * This wrapper keeps waiting, reports a stall once, and lets the user supply
 * the hash manually. The original request is never cancelled: a late hash still
 * wins unless a manual hash was already supplied.
 */
export function trackWalletRequest(
  request: Promise<string>,
  options: { timeoutMs: number; onStalled: () => void },
): TrackedWalletRequest {
  let settled = false;
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveOutcome!: (outcome: WalletHashOutcome) => void;

  const outcome = new Promise<WalletHashOutcome>((resolve) => {
    resolveOutcome = resolve;
  });

  const finish = (result: WalletHashOutcome) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    resolveOutcome(result);
  };

  timer = setTimeout(() => {
    if (settled) return;
    stalled = true;
    options.onStalled();
  }, options.timeoutMs);

  request.then(
    (hash) => finish({ status: 'hash', hash }),
    (error) => {
      // A rejection after a stall is ambiguous: the wallet may have broadcast
      // the transaction and then lost the connection. Keep the recovery UI open
      // instead of cancelling an order that may already be on-chain.
      if (stalled) return;
      finish({ status: 'error', error });
    },
  );

  return {
    outcome,
    submitManualHash(hash: string) {
      finish({ status: 'hash', hash });
    },
  };
}
