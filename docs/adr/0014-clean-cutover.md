# ADR 0014 — Clean cutover at go-live

## Status

Accepted as the go-live data direction (2026-11-08). Execution is deferred until Phase 11 and the UI redesign are complete. Current production data and Notion Import remain unchanged until then.

## Context

Phase 4 imported the Notion journal into a BSC-centric ledger. Phase 10 reconciliation found ten non-zero differences and thirty zero-balance unsupported imported assets. The drift comes from historical data that is incomplete for the watched wallet: recent on-chain POP/USDC activity, fees, custody on other wallets or exchanges, and assets with no verified chain/contract mapping.

Correcting the legacy ledger would require mapping hundreds of orders and dozens of assets, reconstructing missing on-chain trades and gas, and producing evidence-backed append-only corrections. The owner does not need the legacy history inside the go-forward application and prefers a clean start once the functionality and UI are usable.

## Decision

- **Do not migrate or correct the legacy Notion-derived ledger for go-live.** The old database remains as-is until the cutover, then is archived with a verified full backup; the go-forward application starts a new empty ledger epoch.
- **Opening balances at cutover.** Record current holdings as one `adjustment` transaction per asset/wallet, using the existing equity adjustment path. Cost basis is the market value at the cutover timestamp, so future P&L starts at zero. The owner supplies the quantities and values; no historical cost basis, tax basis, or USD gas is invented.
- **Custody must be explicit.** Add the actual watched addresses and reconcile the opening balances against them. Holdings on an exchange, another wallet, or another chain must be added as watch addresses, recorded as explicit exceptions, or excluded from on-chain reconciliation.
- **Legacy import is not part of the go-live path.** The Notion Import code and UI remain in place for now; their navigation/role will be decided with the UI redesign.
- **No destructive action without a backup.** The old database is not deleted or truncated until a verified backup exists. Agents do not perform the production cutover; the owner runs it.
- **Phase 10 data acceptance is deferred to the cutover.** It is closed by re-baselining, not by correcting legacy rows. Phase 10 implementation and live execution remain accepted.

## Consequences

- Historical P&L, realized gains, and the Phase 8/9 audit trail remain in the archived database, not in the go-forward app. If tax reporting is needed, the archive is the source of truth for that period.
- The new ledger starts clean; only opening balances and post-cutover activity affect dashboards and P&L.
- No 431-order migration, 30-asset contract mapping, or legacy reconciliation corrections are required.
- Opening balances require one-time manual entry. A bulk onboarding screen can be added during the UI redesign.
- New on-chain activity still requires correct custody and watch addresses. Reconciliation remains useful for the go-forward ledger.
- Until cutover, the current production data stays visible and Phase 10 will continue to show the known mismatches. They are expected and are not a blocker for Phase 11 or the UI redesign.

## Rollout (later)

1. Finish Phase 11 and the UI redesign; freeze a cutover date.
2. Take a full backup of the current production database; verify the restore procedure.
3. Create a new empty database/schema; run migrations; bootstrap the owner.
4. Add watched addresses; enter opening balances at market value; run BSC and Ethereum reconciliation.
5. Record the cutover timestamp and evidence; keep the old database read-only as the archive.
6. Decide the legacy import navigation/role as part of the UI redesign; it is not used for the clean cutover.
