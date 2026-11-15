# ADR 0052 — Read-only system status

## Status

Accepted for UI-61/W3 on 2026-11-15. No migration.

## Context

Background services only logged failures to pino. Quote refresh, the transfer indexer, the swap tracker, snapshots and bot ticks had no owner-visible health signal. The worker is an empty pg-boss process, and `GET /health`/`/ready` only prove the API and database are alive.

## Decision

Add an owner-only `GET /api/v1/settings/system-status` and a `Настройки → Система` page.

The response contains:

- database latency;
- feature flags and intervals without secrets;
- quote coverage, stale count, last fetch and source distribution;
- running/stale bots, last tick and 24h error count;
- active, unaccounted, stuck and recently failed swaps;
- external provider calls/errors/p95/last status for 24h;
- last portfolio snapshot;
- latest reconciliation run and issue count;
- indexer address counts, last block/update and transfer counts;
- warnings for missing/stale quotes, stale bots, unaccounted/stuck swaps, failed reconciliation, disabled reconciliation and provider errors.

Implementation: `apps/api/src/modules/system`, owner-authenticated controller at `settings/system-status`, contract `packages/contracts/src/system.ts`, UI `features/settings/system-status-page.tsx`.

No table or background-service changes are required. Missing persisted job telemetry is returned indirectly from the data each job writes; a `job_runs` table remains a future enhancement.

## Consequences

- The owner can distinguish “API is down” from “quotes are stale”, “indexer is behind”, “swap tracker has unaccounted orders” or “Kyber is rate-limited”.
- The endpoint is read-only and never returns RPC URLs, API keys or raw provider bodies.
- The page polls every 30 seconds and has a manual refresh.
- If a job has never produced data, the field is `null` rather than a fabricated success.
- The empty pg-boss worker is not exposed as a fake queue; indexer/swap status comes from their own tables.

## Verification

- API e2e checks owner-only access, response shape and absence of secret strings.
- `format:check`, `typecheck`, `lint`, web tests, API tests and build pass.
- No migration.
