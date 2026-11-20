# ADR 0074 — One-click AI cycle with auto-drafted bots

Status: accepted, 2026-11-21.

## Context

ADR 0072 requires the owner to create and start paper bots manually and forbids autonomous bot creation. In practice the owner had to visit separate tabs for data, search, recommendations and bots, and had no single place to see where a long run failed.

The owner approved a one-page workspace and a one-click research cycle, with one boundary unchanged: **the owner starts every bot**.

## Decision

Add `POST /api/v1/ai-trading/cycle` and a single-page AI workspace.

The cycle:

1. checks or refreshes 180 days of data for the selected token/timeframe;
2. runs the existing deterministic mass search;
3. stores/reads recommendations;
4. creates up to `maxDrafts` prefilled **draft** bots from the best recommendations;
5. never calls `startBot`, `stopBot`, a signer or a real order.

The cycle records four steps in `ai_pipeline_runs.summary` and one `ai_jobs` row per step, stops at the first failure and audits start/complete/failure. `ai_jobs` is reused; no schema migration.

The UI becomes one page: toolbar + cycle card + recommendations + AI bot health. `Вселенная`, `Данные`, `Настройки` and manual search are drawers. The legacy `Панель`, `Лаборатория` and `Сервисы` sections and the top stat cards are removed.

Search folds now include warmup candles before each OOS window so indicators have history; scoring still starts at the OOS boundary. Rejection statistics include negative/failed holdout so a zero-recommendation run is explainable.

## Consequences

- One click can take several minutes for 5,000 variants; the UI shows step progress and the cycle has a 15-minute cap.
- Auto-draft creation is a deliberate exception to ADR 0072's “owner creates” wording. Auto-start remains forbidden.
- A token must be an active default-group watchlist entry before drafts are created; the cycle rejects early otherwise.
- A 20-cycle/24h limit and a single active cycle prevent duplicate CPU-heavy runs.
- Stale cycles older than 20 minutes are marked failed on boot.
- Search still runs in the API process; event-loop yielding is a first mitigation, with a worker as a later hardening option.

## Rollback

Redeploy the previous API/web images. Cycle rows in `ai_pipeline_runs`/`ai_jobs` are telemetry and may remain.
