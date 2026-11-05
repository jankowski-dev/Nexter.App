# Phase 9 — Ethereum Execution Report

Date: 2026-11-05

Status: **implementation complete; live Ethereum acceptance pending explicit owner approval.**

## Scope

- Ethereum chain config (chainId 1) and verified token allowlist.
- Per-chain RPC (`ETHEREUM_RPC_URL`), confirmations (12), and execution flag (`SWAP_ETHEREUM_EXECUTION_ENABLED`, default false).
- Generalized EVM RPC service, tracker, accounting gas asset, and swap/approval services.
- Chain-aware `/swap` UI and WalletConnect chain switching.
- Read-only live check for Ethereum (`node scripts/swap-live-check.mjs ethereum`).

## Implementation

- `SWAP_CHAINS` now contains BSC and Ethereum. Ethereum tokens: USDC (6 decimals), LINK, BASED, APR, native ETH. Addresses were verified on Ethereum mainnet (bytecode, symbol, decimals).
- `EvmRpcService` is chain-aware; BSC uses `BSC_RPC_URL`, Ethereum uses `ETHEREUM_RPC_URL`.
- Router/executor defaults are per chain; the global allowlists remain authoritative when configured and must include every enabled chain.
- Tracking polls per-chain block numbers, uses `SWAP_BSC_CONFIRMATIONS`/`SWAP_ETHEREUM_CONFIRMATIONS`, and derives the gas asset from the chain registry (BNB/ETH).
- `SwapService.config()` exposes per-chain `rpcConfigured` and `executionEnabled`. Ethereum execution is off by default even when BSC execution is enabled.
- `/signing` rejects Ethereum orders unless `SWAP_ETHEREUM_EXECUTION_ENABLED=true` and the global execution flag are both set.
- The UI allows selecting BSC or Ethereum, resets token selection on chain change, shows RPC/execution status, and switches WalletConnect to the selected chain before signing.
- `scripts/swap-live-check.mjs` supports `bsc` and `ethereum`; it prints only chain id, router bytecode size, and quote amounts, never RPC URLs or API keys.

## Verification

- Typecheck, lint, format:check, build: pass.
- API suite: **125 passed, 1 skipped** (adds Ethereum quote/build/ready/sign/confirm e2e with mocked provider/RPC, per-chain registry tests, and EVM RPC chain tests).
- Playwright: **5 passed** (swap UI includes the Ethereum chain selector and disabled-signing state).
- No schema migration; the `chains` table already contains `ethereum`.
- Live Ethereum acceptance: pending owner approval for a small real swap. `node scripts/swap-live-check.mjs ethereum` was run against a public RPC and verified chain id 1 and router bytecode (quote probe skipped without an API key).

## Live acceptance checklist

1. Configure `ETHEREUM_RPC_URL` (prefer private/MEV-protected) and `KYBERSWAP_API_KEY`.
2. Confirm `SWAP_ROUTER_ALLOWLIST`/`SWAP_EXECUTOR_ALLOWLIST` include both chains if set; otherwise defaults apply.
3. Run `node scripts/swap-live-check.mjs ethereum`.
4. Enable `SWAP_ETHEREUM_EXECUTION_ENABLED=true` only for the acceptance window; keep the kill switch ready.
5. Execute a small swap with Tangem; verify build → ready → signing → submit → tracking → accounting, plus the rejection/cancel path.
6. Record the order, tx hash, confirmations, accounting transaction, and deployment ID; disable the Ethereum flag if acceptance fails.

## Residuals

- Automated post-accounting reorg compensation (Phase 9 prerequisite from Phase 8.x).
- Tracker leader lock/single API replica.
- Mocked WalletConnect UI tests.
- Malformed gas and approval-gas preflight.
- Manual attach-hash endpoint for replacements older than the lookback.
- Server cannot enforce MEV protection on wallet-broadcast transactions.
