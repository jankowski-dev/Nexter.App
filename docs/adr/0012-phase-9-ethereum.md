# ADR 0012 — Phase 9 Ethereum swap execution

## Status

Accepted 2026-11-05. Implementation, mocked/API verification, and a live small Ethereum swap are complete.

## Context

Phase 8 and Phase 8.x delivered non-custodial BSC execution: KyberSwap quote/build, calldata validation, exact approvals, step-up TOTP, WalletConnect/Tangem signing, tracking, replacement adoption, and confirmed-swap accounting. Phase 9 adds Ethereum (chain slug `ethereum`, chainId 1) without changing the non-custodial model: the server never holds private keys or signs transactions.

## Decision

- **Chain and tokens.** Add Ethereum with chainId 1 and the verified allowlist: USDC `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` (6 decimals), LINK `0x514910771af9ca656af840dff83e8264ecf986ca`, BASED `0x4f2b33840227ddd0e28da8d4185d6fa07adfed87`, APR `0x5a9610919f5e81183823a2be4bd1beb2b4da2a20`, and native ETH. Contract bytecode, symbols, and decimals were verified against Ethereum mainnet before adding them.
- **Router/executor.** Use the same deterministic Kyber MetaAggregationRouterV2 `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` and AggregationExecutorProxy `0x8F10B468b06c6FD214B65F87778827F7D113f996` on Ethereum. Per-chain allowlists (`SWAP_BSC_*`/`SWAP_ETHEREUM_*`) are preferred; the legacy global `SWAP_ROUTER_ALLOWLIST`/`SWAP_EXECUTOR_ALLOWLIST` remain BSC-only and are never inherited by Ethereum. Empty lists fall back to the chain-specific defaults.
- **RPC.** `BSC_RPC_URL` remains BSC; add `ETHEREUM_RPC_URL`. The server uses it for balances, allowance, simulation, tracking, and receipts, and validates/caches `eth_chainId` before using a configured endpoint. Prefer a private/MEV-protected endpoint for Ethereum reads/simulation. WalletConnect/Tangem broadcasts the signed transaction through the wallet, so the server cannot enforce MEV protection for the broadcast itself; this limitation is documented and the wallet/device remains the signing and broadcast boundary.
- **Confirmations.** `SWAP_CONFIRMATIONS` stays as the BSC default (15) for backward compatibility; `SWAP_BSC_CONFIRMATIONS` optionally overrides it and `SWAP_ETHEREUM_CONFIRMATIONS` defaults to 12. Tracking and accounting use per-chain thresholds.
- **Rollout flag.** `SWAP_EXECUTION_ENABLED` remains the global master. `SWAP_ETHEREUM_EXECUTION_ENABLED` defaults to false so Ethereum quoting/building can be verified without enabling Ethereum signing. BSC continues to follow the global flag. The kill switch remains global.
- **Tracking.** The tracker polls each chain with its own latest block, keeps same-nonce replacement adoption, content-search bounds, confirmation thresholds, and append-only accounting. It starts when either RPC is configured.
- **Accounting.** The gas asset is derived from the chain registry (BNB for BSC, ETH for Ethereum); amounts use the native decimals. The existing `(chain, symbol)` asset uniqueness already supports both chains, and the chains/account bootstrap already includes Ethereum.
- **UI.** `/swap` exposes a chain selector, per-chain token lists and RPC/execution status, and switches the WalletConnect session to the selected chain before signing. Explorer links are chain-aware (BscScan/Etherscan).
- **No schema migration.** The `chains` table already contains `ethereum`, and no new columns are required. Any future chain-specific persistence must follow the ADR/migration rules.

## Consequences

- Ethereum execution remains disabled until a successful live acceptance and a separate owner approval for the test transaction.
- Rollback must stay on a Phase 9 image while any Ethereum order exists; a pre-Phase-9 image is BSC-only and cannot track/serve Ethereum orders.
- Watch-only reconciliation (Phase 10) is still required before relying on on-chain balances for accounting.
- The single-API-replica tracker constraint and the remaining Phase 8.x residuals apply to both chains.
- A selector/executor allowlist removal still requires the kill switch for in-flight `READY` orders; `/signing` re-checks the current selector/executor/token allowlists.
