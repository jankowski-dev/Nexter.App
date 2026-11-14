# ADR 0043 — Token charts, social links, and main-list allowlist

## Status

Accepted for UI-52 on 2026-11-14. Migration `0039` is additive (two nullable columns).

## Context

The token base already stores a description, a website, Twitter/X, two chain contract addresses, and a list of investors. The owner asked for three related improvements:

- an interactive price chart inside every token-base card;
- a read-only token modal in the portfolio's `Основной список` that opens on a row click (except the `Купить` button) and shows the same description, chart, links, and investors;
- the BSC tokens from the main list added to the swap allowlist, with researched descriptions, social links, and known investors.

The main list contained 15 BSC tokens. Four were already allowed (`APR`, `BASED`, `POP`, `XNY`); eleven were not. Several main-list entries keep the contract address only in `watchlist.bsc_contract_address`, while `assets.contract_address` is null, and the frontend allowlist check previously read only the asset address.

## Decision

- **Chart endpoint.** `GET /api/v1/watchlist/:id/chart?days=30|90|180|365` returns daily close points `{ date, priceUsd }`, the chosen source, and the requested period. It is read-only and owner-scoped. `MarketDataService` asks GeckoTerminal first for BSC/Ethereum contract tokens, then CoinGecko when the series is shorter or absent; results are cached in memory for one hour. No price history is persisted.
- **Chart UI.** The existing interactive SVG `LineChart` gains value/tick formatters. `TokenPriceChart` adds 30/90/180/365-day buttons, price formatting (not compact USD), a red line for a falling period, and explicit empty/error states. It is embedded in the token-base drawer and in the read-only main-list modal.
- **Main-list modal.** `Основной список` rows are keyboard-focusable and open a `TokenInfoDialog` on click, Enter, or Space. The `Купить` button stops propagation, so it still starts the trade flow. The dialog shows the token header, chart, description, X/Telegram/Discord/site links, investors, and tags. It does not expose edit/delete actions.
- **Contract fallback.** The main list builds a trade asset with `contractAddress = asset.contractAddress ?? watchlist.<chain>ContractAddress` before the allowlist check and before opening the trade drawer. This makes tokens whose address exists only on the watchlist row behave like fully populated assets.
- **Social links.** Migration `0039` adds nullable `watchlist.telegram_url` and `watchlist.discord_url`. The API validates both with the existing `http(s)` URL schema and audits changes through the existing `watchlist.updated` path. The token-base edit form and both detail views show the new links.
- **Allowlist additions.** The BSC swap registry gains `AKE` (AKEDO), `CLO`, `CYBER`, `CYC` (Cycle), `GWEI` (ETHGas), `HOME` (Defi App), `IRYS`, `ON` (Orochi), `Q` (Quack AI), `SAHARA` (stored as SHRAI in the watchlist), and `WARD` (Warden). Addresses and 18 decimals were verified against BSC RPC and DexScreener/CoinGecko. `APR`, `BASED`, `POP`, and `XNY` remain. Wallet/router/executor/selector allowlists, execution flags, and the kill switch are unchanged.
- **Data enrichment.** `scripts/enrich-main-watchlist.mjs` is an idempotent, address-matched update for the 15 main-list tokens. It writes `thesis`, X, website, Telegram, Discord, and investors, and inserts an audit row `watchlist.enriched` with before/after values. It never changes symbols or contract addresses. Descriptions use public project documentation and funding announcements; no investor is listed without a public source.

## Consequences

- Charts depend on GeckoTerminal/CoinGecko availability and rate limits. A newly launched token may show “Недостаточно исторических данных” until the source has at least two daily points.
- Adding another token still requires a code change, review, and deploy; it is intentionally not editable from the UI. A green `Купить` button does not bypass the wallet allowlist, execution flags, step-up TOTP, gas cap, or calldata validation.
- The main-list modal reuses the token-base data; editing remains in `База токенов`.
- The enrichment script is not run automatically. Production rollout takes a targeted `watchlist` backup, applies migration `0039`, deploys the API, runs the script, and verifies the 15 rows. Rollback is the JSON backup plus dropping the two nullable columns if the migration must be reverted.
- No ledger, swap-signing, private-key, or accounting behavior changes.

## Rollout

1. Take a targeted JSON backup of `watchlist` and record its SHA-256.
2. Deploy the API; the pre-deploy migration runner applies `0039`.
3. Run `node scripts/enrich-main-watchlist.mjs` from `apps/api` (or the API container) with the owner `DATABASE_URL`; verify 15 updated rows.
4. Check `/ready`, the token-base chart, the main-list modal, and the green `Купить` state for the new addresses.
