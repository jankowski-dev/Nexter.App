# ADR 0063 — Production scope v2 and removal of the unused worker

## Status

Accepted. 2026-11-17.

## Context

The original implementation contract (`docs/mega-prompt.md` v1) described an MVP-1 accounting product with no wallet connection and no swap execution, followed by MVP-2 swaps. The shipped product is broader: live non-custodial swaps on BSC and Ethereum, paper-trading bots with backtesting and telemetry, AI settings, Viber audio notes, an encrypted vault, tasks, notes, finance, and a redesigned Russian UI. The contract was therefore behind the code, which violated the project's own "docs updated" definition of done.

The Railway `@nexter/worker` service also remained deployed even though it registered no pg-boss handlers. It only opened a database connection, logged `Nexter worker started`, and waited for shutdown. Background polling (quotes, indexer, swap tracking, snapshots, bot ticks, AI) already runs in the API process under advisory locks or interval guards.

## Decision

1. `docs/mega-prompt.md` becomes v2. A scope amendment near the top records the actual product and states that older MVP-1/MVP-2 sections are historical rationale. Current behavior is defined by the amendment, the ADRs, and `docs/decisions.md`.
2. The non-negotiable rules are updated: wallet connection is allowed but always non-custodial; swap execution is allowed only behind the existing allowlists, simulation, step-up TOTP, per-chain flags, and kill switch.
3. The unused `@nexter/worker` service, `apps/worker`, `railway.worker.json`, Docker image copies, CI worker checks, and the `smoke:worker` script are removed.
4. Background work stays in the API process. There is no separate queue or worker until a concrete job requires one; adding it back requires a new ADR.
5. Operational runbooks, the README, and the deployment configuration describe one deployable API service plus Postgres.

## Consequences

- The documentation matches the product that is actually deployed.
- One fewer Railway service, Docker layer, and deployment target to monitor and secure.
- If a future background job needs isolation, it must be designed with its own ADR, least-privilege database role, and operational plan.
- Historical ADRs that mention the worker remain as records; this ADR supersedes them for the current architecture.
