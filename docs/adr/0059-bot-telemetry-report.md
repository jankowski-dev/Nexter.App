# ADR 0059 — Bot telemetry report for AI analysis

## Status

Accepted for UI-63 on 2026-11-16. No migration.

## Context

The owner wants an AI-agent journal for paper bots: detailed telemetry of trades, stop-losses, take-profits, prices, strategy decisions and equity, downloadable as a file for external analysis. AI integration itself is out of scope for this version.

## Decision

Add a read-only report endpoint and a UI tab.

**API**

`GET /api/v1/trading-bots/bots/:id/telemetry?from=<ISO>&to=<ISO>`

- Owner-only, bot must belong to the owner.
- Default range: last 7 days; maximum 180 days; invalid/reversed ranges return `VALIDATION_ERROR`.
- `schemaVersion: 1` for future evolution.

The JSON report contains:

- `bot`: config, settings, strategy key/params, full strategy description/guide/risks/defaults, lifecycle timestamps;
- `tokens`: bot tokens with the latest signal per token;
- `positions`: current paper positions;
- `summary`: trade/buy/sell/TP/SL/trailing-stop counts, realized P&L, fees, slippage, equity start/end, event/signal/quote-point counts;
- `trades`: every trade in the range with amount, price, USD value, fee, slippage, realized P&L, reason and the signal snapshot stored at execution;
- `signals`: latest signal per token (the DB keeps only the latest row per bot/token);
- `events`: bot lifecycle/trade/error events;
- `equity`: downsampled equity snapshots (max 1000);
- `quotes`: price/24h-change samples per token, downsampled to max 500 points per asset.

**UI**

`Портфель → Журнал ИИ` lets the owner choose a bot and period, build the report, see summary counters and download `nexter-ai-<bot>-<from>-<to>.json`.

## Consequences

- No schema change: the report is assembled from existing bot tables and quote samples.
- `bot_signals` has no history; per-decision context is preserved in `bot_trades.signal`, while quote and event series provide surrounding context.
- Large ranges are capped by downsampling; the report states that it is a sampled series, not every tick.
- No AI API key, prompt or external call is added. The file is the integration boundary.
- No secrets, signing keys or unrelated ledger data are included.

## Verification

- API e2e builds a bot with a buy and a take-profit sell, then asserts schema version, bot/strategy metadata, summary counts, tokens, trades, equity, quotes and event presence, plus a reversed-range 400.
- E2E opens the `Журнал ИИ` tab and checks the panel.
