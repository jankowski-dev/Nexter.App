# Nexter — Agent Guide

This file is for AI agents working in this repository.

The full implementation contract is [`docs/mega-prompt.md`](docs/mega-prompt.md). Read it before starting any task.

## Current phase

Phase 4 — Notion import (implementation complete, under review). Next: Phase 5 — MVP-1 UI.

Phase 3 — Accounting core is accepted. Phase 4 owns only the import parser, staging, control reconciliation, commit/rollback, and the `/import` page. Do not implement the full dashboard, portfolio, trades, watchlist, or swap features until Phase 5 is started and scoped.

## Non-negotiable rules

1. No private keys, seed phrases, or signing keys on the server.
2. No public signup.
3. No wallet connection in MVP-1.
4. No swap execution in MVP-1.
5. Money is always decimal strings / Postgres `numeric`; never JS number/float.
6. Every mutation must be audited.
7. The ledger is append-only; corrections are new transactions.
8. No secrets in code, prompts, logs, or screenshots.
9. Agents have no production access.
10. Schema changes require an ADR and review.
11. No destructive migrations without a backup and explicit approval.
12. Tests, typecheck, and lint must pass before merge.
13. UI is Russian, dark theme, USD base currency.
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
