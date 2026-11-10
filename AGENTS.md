# Nexter — Agent Guide

This file is for AI agents working in this repository.

The full implementation contract is [`docs/mega-prompt.md`](docs/mega-prompt.md). Read it before starting any task.

## Current phase

Phase 11 — Other modules implemented (2026-11-09): end-to-end encrypted password vault, tasks, and notes, with ADR 0019. UI-6 followed with the Crypto accordion navigation and the dialog focus fix; production API uses the `nexter_app` role with `MIGRATION_DATABASE_URL` for pre-deploy migrations; the worker remains on the owner role because pg-boss needs DDL for its schema. Phase 10 — On-chain reconciliation (implementation and live execution accepted 2026-11-08; data reconciliation deferred to the go-live clean cutover per ADR 0014). UI redesign UI-0 through UI-7 are implemented (new navigation, Portfolio + trade journal, asset drawer, Operations/Reports, unified trade/exchange modal, position-close linkage, dashboard analytics, daily snapshots, interactive charts, watchlist groups and contract-address token discovery, period reports and trade statistics, embedded-only swap, mobile navigation, sequential multi-token close flow with stale-order recovery, token base with contract/links/investors, task list/calendar with recurring occurrences). UI-7 is complete as of 2026-11-10; migrations `0020` (token base metadata) and `0021` (task recurrence) are applied in production. UI-8 followed with task tags, compressed image attachments in `task_images`, autosave in the task dialog, square chain icons, full-width layout, and the `Открытые` default filter (migration `0022`). UI-9 added light/graphite dark themes with a header switcher and rebuilt the dashboard around icon-tiled cards and a thicker equity chart; no migrations. A separate personal-finance module followed on 2026-11-10 (ADR 0024): BYN base, accounts/categories/transactions/transfers, import preview/commit/rollback, and the full Notion history migrated (7 accounts, 19 categories, 248 operations, 43 transfers; net worth 12 129.05 BYN). Migrations `0023`–`0025` are additive and applied in production. Notes were redesigned as a journal on 2026-11-10 (ADR 0025): one-third-width read/edit drawer, safe Markdown editor, autosave, photos in `note_images` (migration `0026`), archive toggle, and 30-note pagination. UI-10 followed on 2026-11-10 (ADR 0026): the vault is a top-level service; finance has period presets (current, previous, custom month, year, all time) and a visual category-color palette; WalletConnect and BNB/ETH selection moved into the global header with BNB as the post-connect default; portfolio, trades, and the token base render token icons with a manual upload override. No migration. See `docs/ui-redesign.md`, the ADRs, and `docs/decisions.md`. Phase 9 — Ethereum execution (accepted 2026-11-05). Live small Ethereum swap completed; Phase 8 — Swap execution is accepted (2026-11-05). Live small BSC swap completed; WalletConnect/Tangem, exact approvals, step-up TOTP, calldata verification, execution UI, tracking, and confirmed-swap accounting are implemented. Phase 8.x hardening is accepted; remaining residuals are listed in the Phase 8 report. Ethereum execution is controlled by `SWAP_EXECUTION_ENABLED` plus `SWAP_ETHEREUM_EXECUTION_ENABLED`, and the kill switch. Phase 7 is accepted. Phase 10 adds watch-only addresses, a transfer indexer, raw gas backfill, and reconciliation runs.

Phase 3 — Accounting core, Phase 4 — Notion import, Phase 5 — MVP-1 UI, Phase 6 — MVP-1 hardening, and Phase 7 — Swap foundation are accepted. Phase 7 is scoped by ADR 0009: BSC quote/build/simulate only, no signing. Phase 8 adds WalletConnect/Tangem, exact approvals, step-up TOTP, submission/tracking, and accounting integration. No private keys or seed phrases may ever reach the server.

## Non-negotiable rules

1. No private keys, seed phrases, or signing keys on the server.
2. No public signup.
3. No wallet connection in MVP-1.
4. No swap execution in MVP-1.
5. Money is always decimal strings / Postgres `numeric`; never JS number/float.
6. Every mutation must be audited.
7. The ledger is append-only; corrections are new transactions.
8. No secrets in code, prompts, logs, or screenshots.
9. Production access is allowed only with explicit owner approval for a specific operation; take a backup first and document the rollback.
10. Schema changes require an ADR and review.
11. No destructive migrations without a backup and explicit approval.
12. Tests, typecheck, and lint must pass before merge.
13. UI is Russian, light theme, USD base currency.
14. BSC first, Ethereum second.
15. Swap tokens are allowlisted.
16. Step-up TOTP is required for swaps above $500.
17. Cloudflare is optional; application auth is mandatory.
18. RPO is 1 hour and RTO is 4 hours.
19. No third-party analytics or trackers.
20. Do not change acceptance tests to make them pass.
21. Do not invent financial or tax logic.
22. If something is unclear, stop and ask.

## Commands

Use `npx pnpm@10.20.0` if pnpm is not globally installed.

```bash
npx pnpm@10.20.0 install
npx pnpm@10.20.0 dev
npx pnpm@10.20.0 build
npx pnpm@10.20.0 typecheck
npx pnpm@10.20.0 lint
npx pnpm@10.20.0 test
npx pnpm@10.20.0 db:generate
npx pnpm@10.20.0 db:migrate
```

## Conventions

- TypeScript strict mode.
- English identifiers and code comments.
- Russian UI copy.
- Zod for input validation.
- Drizzle for database access.
- No `any` in the frontend API layer.
- Small, focused changes.
- One worktree per implementation task.
- Update `docs/decisions.md` for decisions that affect architecture or product behavior.

## Definition of Done

- Spec/acceptance criteria are clear.
- Unit/integration/E2E tests pass.
- Typecheck and lint pass.
- Migration is reviewed (if any).
- Audit log is written (if mutation).
- Errors are handled.
- Docs are updated.
- No secrets.
- Security review for sensitive changes.
- Feature flag and rollback plan where relevant.
