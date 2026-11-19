# ADR 0071 — AI Trading Control Center

Status: accepted (Phase 1–3 implemented); partially superseded by ADR 0072
Date: 2026-11-18

> **2026-11-19 update:** the owner removed autonomous worker creation and auto-approvals. The recommendation-only flow, short-swing 1–10 day horizon, purged walk-forward search and transparent statistics are defined in [ADR 0072](0072-recommendation-only-short-swing.md). This ADR remains authoritative for the data/analyst/backtest foundation, sandbox boundary, audit and no-keys rules.

## Context

The owner wants an AI trading module inside the Crypto workspace. It is a sandbox first: real market data and realistic math, but virtual money. A later phase may move to fully automatic real execution; that is out of scope here and requires a separate signer architecture.

The original sketch used a “Mainbot” that manages “ServiceBots” and “WorkerBots” by talking to them. The owner clarified that “bots” are figurative: the system is a set of services that interact. The AI provides analysis and evaluation; it must not be the executor. Hard-coded services are the “hands”.

The existing repository already has:

- paper `trading_bots` with strategies, positions, trades, equity, signals and events;
- a backtest engine and `bot_backtest_runs`;
- market quotes, daily history and provider clients;
- settings, notifications and audit;
- a Postgres database with an app role that has no arbitrary DELETE.

The module must be fast, reliable, resumable and observable without introducing a separate worker service in the first phase.

## Decision

### 1. No Mainbot entity

There is no `Mainbot` table or bot process. The module consists of:

- a **Control Center** UI and profile settings;
- a deterministic **Orchestrator** service that owns the job graph and policy;
- **Services** (Data, Analyst, Backtest, Risk, Reporter) implemented as idempotent job handlers;
- **WorkerBots**, reusing the existing paper bot engine;
- **Approvals** and a decision journal.

### 2. Services are jobs, not autonomous bots

Services do not call each other. Each stage reads an artifact produced by the previous stage and writes its own artifact. The orchestrator schedules the next job. Communication is through a Postgres job queue and `ai_artifacts`.

This avoids a fragile agent mesh, makes retries safe and allows the pipeline to resume after a restart.

### 3. AI is analysis only

The AI service receives a structured market/feature profile and returns a validated JSON analysis: regime, candidate strategies from a fixed registry, parameter suggestions within ranges, confidence, rationale and risks.

The AI does not:

- generate executable code;
- change risk limits or budgets;
- create workers;
- execute orders;
- run on every worker tick.

The policy engine combines deterministic scoring, backtest metrics and the AI assessment. Every AI call stores prompt version, model, usage, cost and response.

### 4. Worker model

One worker = one strategy + up to five tokens + one evaluation timeframe. It reuses `trading_bots` and the `bot_*` tables, extended with `origin='ai'`, `ai_profile_id`, `ai_candidate_id`, `evaluation_timeframe`, `allocation_usd` and `isolated_budget`.

The worker is paper-only. It never touches the real ledger, wallet or signing.

### 5. Timeframes and data

MVP timeframes are `1h` and `1d`. The next order is `4h`, `15m`, `5m`. OHLCV data is stored in `market_candles` keyed by asset, timeframe and open time. Data quality, coverage, gaps, synthetic candles and provider limits are explicit artifacts.

A worker has one signal timeframe. Execution and equity use current quotes. Intraday data availability is validated per token/timeframe before a worker is created.

### 6. Sandbox and capital

The module runs with real market data and realistic fees/slippage, but virtual money and a separate paper ledger. It must not mix with the real ledger.

The profile has a shared virtual pool. Worker allocations are reservations; an optional isolated budget can be enabled per worker. Risk Service prevents double-spending and enforces exposure, daily loss, drawdown, stale data and correlation limits.

### 7. Approvals and automation

In paper mode all actions can auto-run, controlled by explicit toggles. Every automatic action produces a notification and an audit record. Risk stops (pause/close on breach) may run automatically.

In the future real mode, every order and every worker/budget change requires owner approval and step-up TOTP. No real execution is implemented in this ADR.

### 8. Re-optimization

Re-optimization is weekly plus event-driven, with a seven-day cooldown per token. Events include drawdown breach, underperformance versus buy-and-hold, profit factor degradation, regime change, new token and data-quality failure.

New candidates run as one or two shadow workers with a small allocation for 7–14 days. The existing worker keeps running until the shadow candidate is promoted by OOS and paper results. Risk stops do not wait for re-optimization.

### 9. Reliability and performance

- Postgres job queue with `FOR UPDATE SKIP LOCKED`, statuses, heartbeat, retries with backoff, dead-letter and cancellation.
- Advisory locks for singleton jobs.
- Idempotency keys and unique constraints on `(profile, run, stage, asset, timeframe)`.
- Artifacts are versioned (data, features, prompt, registry) and hash-addressed.
- AI and backtests are outside the worker tick path.
- In v1 the job runner lives in the API process; a separate worker process is a later step if backtests block the event loop.

### 10. Future real execution

The API will only create execution intents. A separate signer (HSM/KMS, dedicated signer service or ERC-4337 session key) will validate policy and sign. Private keys, seed phrases and signing keys must not live in the API or database. This supersedes any “keys in the system” plan and requires a separate ADR and security review.

## Consequences

- The module is a controlled pipeline with clear artifacts, not a swarm of autonomous agents.
- AI improves analysis but cannot bypass deterministic risk and scoring.
- Paper and real ledgers stay isolated; the future real mode is a separate security project.
- The design reuses most of the existing paper bot and backtest engine, keeping the first implementation smaller.
- Multi-timeframe data and job orchestration add schema and infrastructure work, but avoid provider bursts and overfitting shortcuts.
- Existing `automation_*` tables are not used.

## Alternatives considered

- **LLM Mainbot with free-form decisions**: rejected; not reproducible and unsafe.
- **Direct bot-to-bot calls**: rejected; no durability, hard to retry and audit.
- **Autonomous ServiceBots with independent loops**: deferred; more complexity than value for the first version.
- **AI-generated strategy code**: rejected for this phase; only registry strategies and bounded parameters.
- **Reuse `market_history` only**: rejected; it stores daily closes, not multi-timeframe OHLCV.
- **Real execution with server keys**: rejected; violates the project rule. External signer/AA is the only acceptable future path.

## Rollout

1. ADR and schema/contracts review.
2. Control Center shell, profile, AI universe, service configs.
3. `market_candles` and Data Service.
4. Analyst and Backtest services plus the lab UI.
5. Orchestrator, Risk Service and worker creation.
6. Approvals, reports, journal and monitoring.
7. Shadow tournament, re-optimization and multi-profile.
8. Hardening and, separately, real-execution readiness with an external signer.

No implementation begins before the schema and contracts are approved.
