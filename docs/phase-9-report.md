# Phase 9 — Ethereum Execution Report

Date: 2026-11-05

Status: **accepted on 2026-11-05.** PR #30 merged as `c869a12`; Railway API/worker deployments `SUCCESS`; `/health` and `/ready` 200; no schema migration. A live Ethereum swap completed and accounting was created.

## Live acceptance

On 2026-11-05 the owner approved and completed a small live Ethereum swap:

- 0.0001 ETH → 0.22526 USDC on Ethereum mainnet;
- order `92e1bada…`, tx `0x7ecdd673…`, 12 confirmations, status `CONFIRMED`;
- the first accounting attempt failed `SWAP_ACCOUNTING_NO_FUNDED_ACCOUNT` because the Tangem Ethereum ledger account had no ETH balance;
- after adding the ETH opening balance, the tracker created accounting and `/swap` shows “учёт создан”;
- Ethereum execution remains enabled in production after acceptance; `SWAP_ETHEREUM_EXECUTION_ENABLED` and the global kill switch are rollback controls.

## Scope

- Ethereum chain config (chainId 1) and verified token allowlist.
- Per-chain RPC (`ETHEREUM_RPC_URL`), confirmations (12), and execution flag (`SWAP_ETHEREUM_EXECUTION_ENABLED`, default false).
- Generalized EVM RPC service, tracker, accounting gas asset, and swap/approval services.
- Chain-aware `/swap` UI and WalletConnect chain switching.
- Read-only live check for Ethereum (`node scripts/swap-live-check.mjs ethereum`).

## Implementation

- `SWAP_CHAINS` now contains BSC and Ethereum. Ethereum tokens: USDC (6 decimals), LINK, BASED, APR, native ETH. Addresses were verified on Ethereum mainnet (bytecode, symbol, decimals).
- `EvmRpcService` is chain-aware; BSC uses `BSC_RPC_URL`, Ethereum uses `ETHEREUM_RPC_URL`. It validates and caches `eth_chainId` before using an endpoint, so a wrong-chain RPC fails closed. `/signing` re-probes the chain before the signing lock.
- Router/executor defaults are per chain. `SWAP_BSC_*`/`SWAP_ETHEREUM_*` allowlists are preferred; the legacy global lists stay BSC-only and are never inherited by Ethereum.
- Tracking polls per-chain block numbers, isolates per-chain RPC failures, uses `SWAP_BSC_CONFIRMATIONS`/`SWAP_ETHEREUM_CONFIRMATIONS`, and derives the gas asset from the chain registry (BNB/ETH). Missing confirmed receipts are retried; after repeated misses the order returns to `PENDING` for re-tracking.
- `SwapService.config()` exposes per-chain `rpcConfigured` and `executionEnabled`. Ethereum execution is off by default for new deployments and was enabled in production after live acceptance.
- `/signing` rejects Ethereum orders unless `SWAP_ETHEREUM_EXECUTION_ENABLED=true` and the global execution flag are both set.
- The UI allows selecting BSC or Ethereum, exposes BSC/Ethereum wallet-switch buttons, resets token selection on chain change, shows RPC/execution status, binds signing to the order's chain/ID, and switches WalletConnect to the selected chain before signing.
- `scripts/swap-live-check.mjs` supports `bsc` and `ethereum`; it prints only chain id, router bytecode size, and quote amounts, never RPC URLs or API keys.

## Verification

- Typecheck, lint, format:check, build: pass.
- API suite: **133 passed, 1 skipped** (adds Ethereum quote/build/ready/sign/confirm, ETH-gas accounting, per-chain RPC-failure isolation, per-chain allowlist tests, registry tests, and EVM RPC chain-id tests).
- Playwright: **5 passed** (swap UI includes the Ethereum chain selector and disabled-signing state).
- No schema migration; the `chains` table already contains `ethereum`.
- Live Ethereum acceptance: pending owner approval for a small real swap. `node scripts/swap-live-check.mjs ethereum` was run against a public RPC and verified chain id 1 and router bytecode (quote probe skipped without an API key).

## Live acceptance checklist

1. Configure `ETHEREUM_RPC_URL` (prefer private/MEV-protected) and `KYBERSWAP_API_KEY`.
2. Prefer per-chain `SWAP_BSC_*`/`SWAP_ETHEREUM_*` router/executor allowlists; legacy global lists are BSC-only. Empty lists use chain defaults.
3. Run `node scripts/swap-live-check.mjs ethereum`.
4. `SWAP_ETHEREUM_EXECUTION_ENABLED=true` is enabled after acceptance; keep the kill switch ready.
5. Execute a small swap with Tangem; verify build → ready → signing → submit → tracking → accounting, plus the rejection/cancel path.
6. Record the order, tx hash, confirmations, accounting transaction, and deployment ID; disable the Ethereum flag if acceptance fails.

Completed 2026-11-05: see Live acceptance above.

## Residuals

- Automated post-accounting reorg compensation (Phase 9 prerequisite from Phase 8.x).
- Tracker leader lock/single API replica.
- Mocked WalletConnect UI tests.
- Malformed gas and approval-gas preflight.
- Manual attach-hash endpoint for replacements older than the lookback.
- Server cannot enforce MEV protection on wallet-broadcast transactions.
