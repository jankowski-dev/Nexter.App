# Nexter — AI Agent Guide

Read this before changing code. It is intentionally opinionated: most production incidents in this repo come from breaking one of the invariants below, not from TypeScript errors.

## 1. What this repo is

Private single-owner personal finance app. No public signup, no multi-tenant features. Crypto ledger + DEX swaps + paper bots + independent sandbox (including historical replay) + personal finance (BYN) + tasks/notes/habits/vault + DeepSeek settings and Viber audio notes. The old `ИИ-торговля` and bot backtest modules are removed (ADR 0090); their DB tables remain dormant. UI is Russian; code identifiers/comments are English.

Monorepo:

- `apps/api` — NestJS/Fastify API; also serves the built SPA.
- `apps/web` — React 19 + TanStack Router/Query + Tailwind.
- `apps/e2e` — Playwright acceptance tests.
- `packages/contracts` — Zod schemas/types shared by web/API.
- `packages/db` — Drizzle schema/migrations/backup scripts.
- `docs/adr`, `docs/runbooks`, `docs/project` — decisions/operations/this guide.

## 2. Non-negotiable rules

1. **No private keys, seed phrases, or signing keys on the server.** Ever.
2. **No public signup.**
3. **No float money.** Use `decimal.js` and Postgres `numeric`; API money values are strings.
4. **Every mutation is audited.** `AuditService` in the same transaction; critical paths use `strict: true`.
5. **Ledger is append-only.** Corrections are new transactions. Do not edit/delete posted transactions except a documented, owner-approved emergency repair with backup and audit. `audit_log` also has a DB trigger that rejects UPDATE/DELETE.
6. **No secrets in code/logs/screenshots.**
7. **Schema change = ADR + migration + backup + review.** TOTP replay state lives in `users.last_totp_step`; consume it atomically and never bypass the replay check.
8. **Tests/typecheck/lint must pass before merge.** Do not weaken acceptance tests to make a change pass.
9. **UI Russian, USD crypto base, BYN finance base.**
10. **BSC first, Ethereum second.**
11. **Swap tokens/wallets/routers/executors are allowlisted.**
12. **Step-up TOTP above `SWAP_STEP_UP_THRESHOLD_USD`.**
13. **No analytics/trackers.**
14. **If unclear, stop and ask.** Financial logic must not be invented.

## 3. Commands

```bash
npx pnpm@10.20.0 install
npx pnpm@10.20.0 build:packages
npx pnpm@10.20.0 dev
npx pnpm@10.20.0 format
npx pnpm@10.20.0 format:check
npx pnpm@10.20.0 lint
npx pnpm@10.20.0 typecheck
npx pnpm@10.20.0 test
npx pnpm@10.20.0 test:e2e
npx pnpm@10.20.0 build
npx pnpm@10.20.0 db:generate
npx pnpm@10.20.0 db:migrate
npx pnpm@10.20.0 backup
npx pnpm@10.20.0 restore:drill
```

Use `npx pnpm@10.20.0` on Windows if pnpm is not global. New worktree per implementation task. Do not merge with red CI.

## 4. Request/data flow

```text
Browser → Fastify/Nest guards → controller (Zod pipe) → service → Drizzle → Postgres
                                    ↘ AuditService
                                    ↘ external providers (CoinGecko/DexScreener/Kyber/RPC)
```

- Controllers validate with Zod schemas from `@nexter/contracts`; do not duplicate types.
- Services own transactions/business rules.
- Web API calls go through `apps/web/src/lib/api.ts` and parse Zod contracts; no `any`.
- Auth: HttpOnly session cookie; mutations need `x-csrf-token`. `apiFetch` adds it.
- Rate limit and CSRF are global; import has a special auth hook/body parser.

## 5. Money/ledger invariants

- `transactions` + `postings` are the source of truth. Buys create `lots`; sells create `lot_consumptions` FIFO.
- `accounts` types: `wallet`, `external`, `income`, `expense`, `equity`.
- Cash equivalents (USDT/USDC) do not create lots; they are cash.
- `PricingService.latestForAssets` reads `market_quotes`, falls back to manual `prices`.
- `reporting.positions` values all wallet balances; `dashboard`/`portfolio`/`trades` share it.
- Do not calculate P&L in UI from price deltas; use API realized/unrealized fields.
- Manual adjustments only add positive lots. To reduce a non-cash position, use a sell/withdrawal or a dedicated correction design; do not fake a negative amount.
- `trade_groups` status: `open`/`partial`/`closed`/`reserve`/`for_sale`.
- Closing a group uses `closeGroupIds` + expected amount; server revalidates remaining.

## 6. Market data

- DexScreener primary for contract tokens with ≥ `MARKET_QUOTE_MIN_LIQUIDITY_USD` (25k), 60s.
- CoinGecko fallback/native + 7d/30d/1y/cap, 10 min.
- `fetched_at` = last check; `changed_at` = price changed.
- Icon proxy `/watchlist/icon` is exempt from `no-store`; cache 24h. Do not remove this exemption.
- `MarketQuoteRefreshService` starts 3s after boot; test env disables.
- If adding a new quote source, update `MarketQuoteService`, `PricingService`, contracts, and ADR. Do not create a separate price path.

## 7. Swap flow

`QUOTED → BUILT → [APPROVAL_REQUIRED] → READY → AWAITING_SIGNATURE → SUBMITTED → PENDING → CONFIRMED → ACCOUNTED`.

- Server builds/simulates Kyber calldata and verifies it before signing.
- WalletConnect/Tangem signs; server never sees keys.
- `submit_failed`: same hash must be retried; never sign twice.
- `SWAP_CLOSE_GROUP_BUSY`: do not bypass; wait/cancel/supersede only via service.
- Wallet rejection may not reject the WalletConnect promise; UI has “Отменить ожидание”. If a hash arrives after cancel, it is still submitted (never leave a broadcast tx untracked).
- A wallet can broadcast `eth_sendTransaction` without returning its hash. After 90 seconds the drawers switch to manual-hash recovery without cancelling the order; a late rejection is ignored. `Крипта → Ордера` surfaces recent stalled and built-cancelled swaps; `submitted` accepts a built `CANCELLED` order. See ADR 0093.
- `swap_events` is the diagnostic source; don't put technical order IDs in the primary UI.

## 8. Imports

- Notion import expects raw arrays (`source.json`, `orders.json`, `transactions.json`) and `application/x-notion-import+json`.
- Preview is non-destructive; commit writes ledger; rollback only latest committed import with no later ledger activity.
- Legacy 429-order control only applies to original export IDs ≤466. Later exports use preview totals + per-row detection (ADR 0032).
- Do not treat the control warning as an error; do not edit the hard-coded snapshot to force a new export.
- Full replacement requires clean cutover/compensating reversal, not a blind rollback.

## 9. Tasks/notes/vault/finance

- Recurring tasks: content fields/due shift/archive/delete apply to whole series by default (`applyToSeries`); status/completion per occurrence (`applyToSeries:false`).
- New task autosave must not create the task before recurrence is chosen (UI keeps recurrence visible until explicit save).
- Notes: Markdown is a safe subset; no HTML. List responses return attachment count, not full data URLs; detail endpoint returns full attachments.
- Vault: E2E encryption in browser; server only ciphertext. Never log/decrypt on server.
- Finance is isolated from crypto ledger; credit is liability; cancelled operations are soft-cancelled. A transfer from an asset account to a credit account is a principal repayment: it counts in `expenseBase`/`netBase` and appears as the synthetic category `Погашение кредита`, but it does not change net worth. Credit drawdowns are not income.
- AI: `ai_settings` stores the encrypted DeepSeek key (never returned) and the model/reasoning/token settings; `AiService` validates JSON and fails back to raw text. Viber audio: the separate `Nexter.Bot` transcribes locally and posts transcript + original audio; the API creates the note/attachment. Audio limit is `settings.audio_max_mb` (default 8, max 20).

## 10. Database/migrations

- Drizzle schema: `packages/db/src/schema/index.ts`.
- Generate: `npx pnpm@10.20.0 db:generate`; review SQL and journal/snapshot.
- Migrations additive; grants for `nexter_app` may need update for new tables/columns.
- Production pre-deploy runs migrations with `MIGRATION_DATABASE_URL` (owner/DDL role); API uses `nexter_app`. There is no worker process; background pollers run in the API under advisory locks/intervals.
- `nexter_app` has SELECT/INSERT/UPDATE and limited DELETE; do not add DELETE grants casually.
- Manual data seeds need journal entries and ADR.

## 11. Frontend patterns

- Routes: `apps/web/src/app/router.tsx` (TanStack Router). App layout in `root-layout.tsx`.
- Data: `useQuery`/`useInfiniteQuery` with query keys; `apiFetch`/`apiPost` typed by contracts.
- Drawers/dialogs: shared components; reference-counted scroll lock. Dialogs close on backdrop/X/Escape; do not reintroduce footer “Готово” unless asked.
- `LiveValue` flashes only changed values (not whole cards). `PriceFreshness` shows fetched/changed/source.
- Token icons: `TokenIcon` + `tokenIconSrc`; icon URL is `/api/v1/watchlist/icon?url=...`.
- Russian copy; use existing `format*` helpers; never `Number()` for money except display-only.
- New UI should be full-width rows/cards where the owner asked (watchlist, vault, notes, tasks).
- Crypto is one sidebar entry with six tabs: `Обзор` (stat cards + consolidated token blocks + main token list), `Токены` (token base), `Ордера` (full journal blocks), `Операции`, `Роботы`, `Статистика`. `/operations`, `/watchlist` and `/statistics` render the same shell with the matching tab; tab switches canonicalize to `/portfolio#<tab>`. Hash compatibility: `#trades`/`#deals`/`#journal` -> `Ордера`, `#watchlist` -> `Токены`, `#reports` -> `Статистика`; legacy `#ai`/`#strategies` map to `Обзор`. The read-only strategy guide is `Настройки → Стратегии`. See ADR 0067, 0090.

## 12. Testing

- Unit: `*.spec.ts` next to source. API DB tests are skipped without `NEXTER_TEST_DB=1`/Postgres; CI runs them.
- E2E: Playwright, Chrome channel in CI (`PLAYWRIGHT_CHANNEL=chrome`). Do not change acceptance tests to hide a regression; update only when product behavior intentionally changes.
- Parser tests: `notion-import.parser.spec.ts`.
- Web tests: `apps/web` Vitest.
- CI runs migration twice, static/API smoke, the Docker API image, backup restore drill, encrypted backup smoke, dependency audit, and browser E2E. A red E2E step skips later checks — fix it, don't merge.

## 13. Production/deploy

- Railway API URL: `https://nexter.up.railway.app`.
- API serves SPA; frontend-only changes require API service redeploy (watch patterns include `apps/web/**`, `packages/**`).
- Before production migration/data repair: encrypted backup + restore check; record IDs/paths.
- Use `railway ssh` into Postgres for dumps/checks; do not print DB passwords.
- Production secrets in Railway; backup key outside the repo in a secure owner-controlled location.
- There is one API service plus Postgres. The Viber bot is a separate Railway project/service in the `jankowski-dev/Nexter.Bot` repo; it calls the app's bot API.
- `ENABLE_DOCS` only dev/test.

## 14. Common pitfalls

- **Drizzle nullable columns**: `eq(table.col, maybeNull)` type errors; cast/narrow explicitly.
- **Stale closures**: `phase` in async execute/catch can be stale; use refs for state read after await.
- **Wallet promises can hang**: always offer a cancel/recovery path; don't rely only on provider rejection.
- **Date-only vs timestamp**: tasks due dates use local noon; cursor timestamps are ms; don't mix.
- **CRLF on Windows**: Prettier warnings are okay; committed blobs are LF.
- **Contracts package dist**: after editing `packages/contracts`, build it before API/web typecheck if types don't update.
- **API role**: new tables need grants. The API role is `nexter_app`; migrations use the owner role. There is no worker role.
- **No `any`** in web API layer; contracts should be Zod-first.
- **XSS/SSRF**: validate URLs/Markdown/icon hosts; do not fetch arbitrary URLs.
- **Audio size**: base64 expands 4/3. The limit is `settings.audio_max_mb` (default 8, max 20) on `POST /api/v1/bot/audio-notes`; do not reintroduce a fixed 2 MB cap. The request body is bounded by a route-specific Fastify limit.
- **`market_quotes` fallback**: don't overwrite CoinGecko periods with null on DEX ticks; preserve unless provider explicitly returns null on a due tick.
- **Swap preview**: Do not poll Kyber too aggressively; 500ms debounce/15s poll/5s server cache.
- **Order footer**: technical IDs belong in audit/logs, not the primary UI.

## 15. Trading robots (see `trading-bots.md`)

- Paper-only; no real swaps/signing. Tables: `trading_bots`, `bot_tokens`, `bot_positions`, `bot_trades`, `bot_equity_snapshots`, `bot_events`, `bot_quote_samples`, `bot_signals`. `bot_backtest_runs` is dormant after ADR 0090.
- Strategies live in `apps/api/src/modules/trading-bots/strategies/` as a read-only code registry with Zod params, `guide`, `kind`, `paramFields`. New strategy = code + unit tests + deploy; never execute user scripts. Bots own `strategyKey`/`strategyParams`; no strategy-instance table.
- `GET /bots/:id/signals` returns per-token price/24h/action/reason. Stateful strategies persist `strategy_state` in `bot_signals`.
- `BotRunnerService` ticks every 60 seconds under `pg_try_advisory_lock('nexter:bot-runner')`; quotes come only from `market_quotes`, stale/missing quotes are skipped.
- P&L is average-cost; never write paper trades into `transactions`/`postings`/`lots`/`trade_groups`.
- All user mutations are audited (`bot.*`); paper trades/events are their own journals. Running bots cannot be edited. Archiving is blocked while positions remain.
- API under `/api/v1/trading-bots`; UI under `/portfolio#robots`. Strategy reference is `/settings/strategies` (read-only, no test buttons). Bot journals paginate with `limit/offset` and `Ещё`.
- Bot creation no longer accepts `aiCandidateId` and never writes `ai_*` tables. Historical `origin='ai'` robots may still exist and remain readable; they are not recreated by the removed module.
- Real automated trading is blocked by WalletConnect/Tangem manual signing. A future live venue needs an owner-approved signer/session-key/AA design and a separate security review; no server private keys.

## 16. Sandbox (see `runbooks/sandbox.md`)

- `@nexter/sandbox-core` is independent of `apps/*`, AI and trading-bots. Paper-only: no wallets/keys/signing/real ledger.
- Live runs: `sandbox_runs`/`sandbox_events` under advisory lock `nexter:sandbox-runner`.
- Historical replay: `POST /sandbox/replays` queues a worker (`nexter:sandbox-replay-worker`) that freezes config/settings/seed and a gzip candle snapshot; the report hash must reproduce.
- Replay artifacts are PDF + JSON. `report.md` for historical replays is removed; live run Markdown remains.
- `chart`/`decisions` are read-only projections: chart uses the evaluation-window candles and report intent/trade/counterfactual rows; decisions re-run the persisted snapshot on demand and cache in memory. Never mutate the replay row/report from these reads.
- New sandbox tokens come only from the default `Избранное` group via chain+contract; server rejects arbitrary keys and ineligible candidates. Existing Stage 3 tokens are untouched.
- Never stop/start/re-run the five Stage 3 production runs without explicit owner approval.

## 17. Definition of Done

- Spec/acceptance clear; tests added/updated.
- `format:check`, `lint`, `typecheck`, `test`, `build` pass.
- Migration reviewed, backup/restore plan if schema/data.
- Audit written for mutations.
- Docs/ADR/runbook updated.
- No secrets.
- Security review for swap/vault/import/bot changes.
- Feature flag/rollback plan where relevant.
