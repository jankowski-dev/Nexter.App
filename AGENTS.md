# Nexter — Agent Guide

This file is the working contract for AI agents in this repository. Read it before starting a task. Product/architecture history lives in `docs/decisions.md` and `docs/adr/`; operational details live in `docs/runbooks/`.

## What this is

Private single-owner personal finance app. No public signup, no multi-tenant features. One `@nexter/api` Railway service + PostgreSQL serves the React SPA. UI is Russian, light theme, USD base currency.

Current product areas:

- crypto ledger, FIFO lots, DEX swaps (BSC first, Ethereum second, non-custodial WalletConnect/Tangem);
- portfolio, watchlist/token base, reports and statistics;
- personal finance in BYN, tasks, notes, habits, encrypted vault;
- paper trading robots (`Крипта → Роботы`);
- independent paper `Песочница`: live runs, historical replays, PDF/JSON reports, action chart and full decision journal;
- DeepSeek settings used by notes/audio; Viber integration lives in the separate `Nexter.Bot` repo.

Removed (ADR 0090): `ИИ-торговля` module/UI/contracts/API/tab and the bot backtest module/UI/API/contracts/`backtestDefault*` settings. Do not reintroduce them. `ai_*` and `bot_backtest_runs` tables and AI-origin bot columns remain dormant; do not drop them without a separate approved destructive migration and backup.

## Current state (2026-11-25)

- Production: `6b362f7`, deployment `9003288c-e070-415d-a300-aa57441cb865`, migration `0054` applied, bundle `assets/index-B4REXXip.js`; `/health`/`/ready` 200.
- Branch `sandbox-visual-cleanup` contains the approved visual-cleanup batch: replay timeline/PDF/favorites/strategies Settings/legacy removal, migration `0055` prepared but **not applied to production**.
- Stage 3 forward paper validation is active (2026-11-25 → 2027-01-20): five separate clean runs CAKE/BTCB/ETH/LINK/WBNB (BSC/GeckoTerminal 1h, $1,000 each, current Stage 1B/1C defaults). They must remain `running`; never stop/start/edit/re-run them without explicit owner approval.
- Stage 4 (real money) remains a separate decision. No real-money code path exists in the sandbox.

## Sandbox rules

- Paper only: no real money, wallets, private keys, signing, swaps or exchange execution.
- Do not change sandbox decision/risk rules, Stage 3 runs or existing report hashes in UX/doc work.
- `@nexter/sandbox-core` is independent: no imports from `apps/*`, `@nexter/ai-trading`, `trading-bots` or old AI search code.
- Live runner uses advisory lock `nexter:sandbox-runner`; replay worker uses `nexter:sandbox-replay-worker`, runs in a worker thread and persists a gzip candle snapshot.
- Historical replay artifacts are PDF + JSON. `report.md` for historical replays is removed; live-run Markdown remains.
- `GET /sandbox/replays/:id/chart` returns evaluation-window candles plus action markers; `GET …/decisions` re-runs the persisted snapshot on demand and caches in memory. Both are read-only and must not mutate the replay/report.
- New sandbox tokens come only from the default `Избранное` watchlist group via chain+contract. The server re-resolves candidates and rejects arbitrary/ineligible keys (`SANDBOX_TOKEN_NOT_IN_FAVORITES`, `SANDBOX_TOKEN_NOT_ELIGIBLE`). Existing Stage 3 tokens are untouched.
- `Прогон` page order: header/subtitle → action chart → PDF/JSON + summary → metrics → strategy/token blocks (full-width, horizontal scroll) → journals (20 rows + `Ещё`). Hashes/seed/technical notes belong in PDF/JSON, not the page.

## Trading robots / strategies

- Robots are paper-only; `bot_*` tables are isolated from the real ledger.
- Strategies are a read-only code registry in `apps/api/src/modules/trading-bots/strategies`; params are Zod-validated and stored per bot.
- The strategy reference is `Настройки → Стратегии` (read-only, no test buttons). The Crypto `Стратегии` tab is removed.
- Bot runner ticks every 60 seconds under `nexter:bot-runner`; quotes come only from `market_quotes`.
- Bot creation no longer accepts `aiCandidateId` and never writes `ai_*` tables. Historical `origin='ai'` bots remain readable.

## Non-negotiable rules

1. No private keys, seed phrases, signing keys or exchange execution in the server.
2. No public signup.
3. Wallet connection is non-custodial (WalletConnect/Tangem) and allowlisted; execution only behind simulation, step-up TOTP, per-chain flags and the kill switch. Do not weaken these gates.
4. Money is always decimal strings / Postgres `numeric`; never JS number/float for money.
5. Every mutation must be audited.
6. The ledger is append-only; corrections are new transactions.
7. No secrets in code, prompts, logs or screenshots.
8. Production access only with explicit owner approval for a specific operation; take an encrypted backup and document rollback first.
9. Schema/data changes require an ADR and review.
10. No destructive migrations without backup and explicit approval.
11. Tests, typecheck and lint must pass before merge.
12. Do not change acceptance tests to make them pass.
13. Do not invent financial or tax logic.
14. UI copy is Russian; code identifiers/comments are English.
15. BSC first, Ethereum second; swap tokens are allowlisted.
16. Step-up TOTP is required for swaps above $500.
17. RPO 1 hour, RTO 4 hours.
18. No third-party analytics or trackers.
19. If something is unclear, stop and ask.

## Repository layout

```text
apps/api       NestJS/Fastify API + SPA static hosting
apps/web       React 19 + TanStack Router/Query + Tailwind
apps/e2e       Playwright acceptance tests
packages/contracts  shared Zod schemas/types
packages/db         Drizzle schema/migrations/backup scripts
packages/sandbox-core  independent paper engine (no old AI/trading-bot imports)
docs/adr, docs/project, docs/runbooks, docs/sandbox
docs/decisions.md
```

## Commands

Use `npx pnpm@10.20.0` if pnpm is not globally installed.

```bash
npx pnpm@10.20.0 install
npx pnpm@10.20.0 dev
npx pnpm@10.20.0 build
npx pnpm@10.20.0 typecheck
npx pnpm@10.20.0 lint
npx pnpm@10.20.0 test
npx pnpm@10.20.0 format:check
npx pnpm@10.20.0 db:generate
npx pnpm@10.20.0 db:migrate
```

After editing `packages/contracts`, build it before API/web typecheck. DB-backed e2e requires `NEXTER_TEST_DB=1`, `DATABASE_URL`, `SETUP_TOKEN`, `AUTH_ENCRYPTION_KEY` and a local/CI Postgres; locally those tests are skipped.

## Conventions

- TypeScript strict mode.
- English identifiers/comments; Russian UI copy.
- Zod for input/output validation.
- Drizzle for database access; no repository abstraction beyond existing services.
- Small, focused changes; one worktree per implementation task.
- Update `docs/decisions.md` and the relevant `docs/project/*` page when behavior/architecture changes.
- Do not use `any` in the frontend API layer.
- Drawers/dialogs use shared components and reference-counted scroll lock.
- Long report journals show 20 rows and `Ещё`.

## Documentation map

- `docs/project/architecture.md` — system shape, sandbox/robots flows.
- `docs/project/api.md` — endpoint reference.
- `docs/project/trading-bots.md` — paper robots.
- `docs/project/data-model.md`, `security.md`, `operations.md`, `troubleshooting.md` — supporting docs.
- `docs/runbooks/sandbox.md` — sandbox enable/disable, migrations, replay verification.
- `docs/runbooks/operations.md`, `railway.md`, `restore.md` — deploy/backup.
- `docs/adr/` — decisions; ADR 0089/0090 cover the current cleanup batch.
- `docs/sandbox/stage-3-*` — forward validation baseline/incidents/weekly log.

## Definition of Done

- Spec/acceptance criteria clear.
- Unit/integration/E2E tests added or updated and passing.
- `format:check`, `lint`, `typecheck`, `test`, `build` pass.
- Migration reviewed (if any), with backup/restore plan.
- Audit written for mutations.
- Errors handled; UI copy Russian.
- Docs/ADR/runbook updated.
- No secrets.
- Security review for swap/vault/import/bot/sandbox changes.
- Feature flag and rollback plan where relevant; Stage 3 runs untouched.
