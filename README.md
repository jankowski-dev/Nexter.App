# Nexter

Private, single-user, modular personal finance application.

Current scope: **production v2 (2026-11-19)**. Phases 0–11 are accepted, and the shipped product now also includes live non-custodial swaps on BSC and Ethereum, paper-trading bots with backtesting and telemetry, an AI settings module, an AI trading research module (data, lab analysis, backtests and mass walk-forward search; recommendation-to-draft-bot is the next phase), Viber audio notes, an encrypted vault, tasks, notes, finance tracking, and the redesigned Russian UI. This is the actual product scope; where older sections of the implementation contract still say "MVP-1", the v2 scope amendment in [`docs/mega-prompt.md`](docs/mega-prompt.md) and ADR 0063 take precedence. The unused `@nexter/worker` service was removed; background work runs in the API process. Ethereum signing is controlled by `SWAP_ETHEREUM_EXECUTION_ENABLED` and the kill switch.

The implementation contract is in [`docs/mega-prompt.md`](docs/mega-prompt.md).

Current UI state: `Крипта` is one sidebar entry with eight tabs (`Обзор`, `Токены`, `Ордера`, `Операции`, `Роботы`, `ИИ-торговля`, `Стратегии`, `Статистика`). The AI tab is one workspace with a logged one-click data → search → recommendations → draft-bot cycle, mass walk-forward search with OOS warmup and JSON export, recommendation TTL, an invalidation health monitor, OOS histograms and a read-only Binance history fallback. The cycle never starts bots; the owner starts them manually. `Обзор` combines summary cards, consolidated token blocks and the main token list; the other tabs reuse the operations, token-base, journal, bot, strategy and statistics pages. The Viber audio limit is configurable in `Настройки → ИИ → Аудио` (default 8 MB, max 20 MB). Wave 0/1 hardening added disposable-DB test guards, CSRF origin enforcement, TOTP replay protection, an append-only `audit_log` trigger, and removed the unused worker service.

## Notion import

The `/import` page accepts three JSON arrays exported from Notion:

- `Source.json` — assets, CoinGecko IDs, and current prices;
- `Orders.json` — buy/sell order groups;
- `Transactions.json` — USDT deposits and withdrawals.

Preview is non-destructive: it stages normalized rows and reconciles the 429-order Phase 3 control snapshot. Commit applies the import in one transaction; rollback is allowed only while no later ledger activity exists. See [`docs/adr/0007-notion-import.md`](docs/adr/0007-notion-import.md) and [`docs/runbooks/notion-import.md`](docs/runbooks/notion-import.md).

DB-backed tests and the real 431-row import check are opt-in:

```bash
NEXTER_TEST_DB=1 \
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/nexter_local \
SETUP_TOKEN=test-setup-token \
AUTH_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
NOTION_EXPORT_DIR=/path/to/notion-export \
npx pnpm@10.20.0 --filter @nexter/api test
```

## Stack

- Node.js 24 LTS in Docker and CI; Node.js 22.12+ is supported locally
- pnpm workspaces
- NestJS 11 + Fastify
- PostgreSQL 17 + Drizzle ORM
- React 19 + Vite + TanStack Router/Query
- Tailwind CSS + shadcn-compatible primitives
- Vitest + Supertest + Playwright; Testcontainers, fast-check, and Anvil planned
- Railway + Cloudflare + R2

## Repository

```text
apps/api       NestJS API, serves the built SPA in production
apps/web       React SPA
packages/db    Drizzle schema, migrations, client
packages/contracts shared Zod schemas and API types
packages/config shared root env loader
packages/ui    shared UI utilities
docs           specs, ADRs, runbooks
```

## Local setup

1. Copy environment file and set `DATABASE_URL`:

   ```bash
   cp .env.example .env
   ```

   ```dotenv
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/nexter
   ```

   Generate local auth secrets:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   # use as SETUP_TOKEN
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   # use as AUTH_ENCRYPTION_KEY
   ```

2. Start Postgres:

   ```bash
   docker compose up -d postgres
   ```

3. Install dependencies:

   ```bash
   npx pnpm@10.20.0 install
   ```

4. Generate and apply the initial migration:

   ```bash
   npx pnpm@10.20.0 db:generate
   npx pnpm@10.20.0 db:migrate
   ```

5. Start development:

   ```bash
   npx pnpm@10.20.0 dev
   ```

6. Open:

   - Web: http://localhost:5173
   - API health: http://localhost:3000/health
   - API readiness: http://localhost:3000/ready
   - OpenAPI docs (non-production): http://localhost:3000/api/docs

## Workspace commands

```bash
npx pnpm@10.20.0 build
npx pnpm@10.20.0 typecheck
npx pnpm@10.20.0 lint
npx pnpm@10.20.0 test
npx pnpm@10.20.0 format
npx pnpm@10.20.0 smoke:static
```

Browser auth E2E and API auth integration tests **truncate auth tables**. Never point them at a database that contains real Nexter data. Create a disposable database (for example `nexter_test`) and set `NEXTER_TEST_DB=1`; without this flag the destructive suites are skipped. The API test global setup also refuses any `DATABASE_URL` whose host is not localhost or whose database name does not contain `test`.

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/nexter_test
export SETUP_TOKEN=test-setup-token
export AUTH_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
export NEXTER_TEST_DB=1

npx pnpm@10.20.0 db:migrate
npx pnpm@10.20.0 test
npx pnpm@10.20.0 --filter @nexter/e2e exec playwright install chromium
npx pnpm@10.20.0 test:e2e
```

## Documentation

- [`docs/mega-prompt.md`](docs/mega-prompt.md) — implementation contract
- [`docs/ui-redesign.md`](docs/ui-redesign.md) — UI redesign IA, trade/exchange modal, and delivery order
- [`docs/specs/`](docs/specs) — product, threat model, accounting, API/UX, KyberSwap
- [`docs/adr/`](docs/adr) — architecture decisions
- [`docs/runbooks/`](docs/runbooks) — Railway, restore, and auth break-glass procedures
- [`docs/phase-1-report.md`](docs/phase-1-report.md) — Phase 1 verification report
- [`docs/phase-2-report.md`](docs/phase-2-report.md) — Phase 2 verification report
- [`docs/phase-3-report.md`](docs/phase-3-report.md) — Phase 3 verification report

## Phase status

- [x] Phase 0 — Design
- [x] Phase 1 — Foundation (accepted with operational follow-ups)
- [x] Phase 2 — Auth and security (accepted)
- [x] Phase 3 — Accounting core (accepted)
- [x] Phase 4 — Notion import
- [x] Phase 5 — MVP-1 UI
- [x] Phase 6 — MVP-1 hardening
- [x] Phase 7 — Swap foundation
- [x] Phase 8 — Swap execution (BSC)
- [x] Phase 9 — Ethereum (accepted)
- [x] Phase 10 — On-chain reconciliation (implementation accepted; data reconciliation deferred to the clean cutover)
- [x] Phase 11 — Other modules (vault, tasks, notes)
- [x] Post-MVP — production UI redesign, live swaps, paper-trading bots, AI and audio notes

## Production environment

Production and staging require `DATABASE_URL`, `SETUP_TOKEN`, `AUTH_ENCRYPTION_KEY`, and `APP_URL`. `AUTH_ENCRYPTION_KEY` must be a 32-byte base64 or 64-char hex key. Set `TRUST_PROXY` to the exact Railway/Cloudflare proxy CIDR (default `false`). See `docs/runbooks/railway.md`.

## Security notes

- No private keys or seed phrases on the server.
- No public signup.
- Wallet connection is non-custodial (Tangem via WalletConnect); keys never reach the server.
- Swap execution is allowlisted, simulated, step-up protected above $500, and gated by the kill switch.
- All mutations must be audited; `audit_log` is protected by an append-only trigger.
- TOTP codes are single-use per 30-second period; replay returns `TOTP_REPLAY`.
- Pending sessions before 2FA expire after 15 minutes.
- Secrets live in environment variables only.
