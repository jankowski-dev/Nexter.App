# ADR 0072 — Recommendation-only AI trading and short-swing search

- **Status:** accepted
- **Date:** 2026-11-19
- **Supersedes in part:** ADR 0071 (autonomous orchestrator/approval parts)
- **Related:** `docs/plans/ai-trading-2026-11.md`, `docs/plans/ai-trading-schema-contracts-2026-11.md`

## Context

The owner reviewed the Phase 1–3 foundation and rejected autonomous worker creation. The AI pipeline is useful as a research and decision-support system, but the owner wants to create, start and stop every paper bot manually. The product also narrows to short swing: a 1–10 day holding horizon rather than long-term buy-and-hold.

The previous plan assumed an orchestrator that creates WorkerBots, auto-approval toggles, and an `ai_approvals` lifecycle. Those parts no longer match the product. Global automation (`automation_*`) was already removed from the UI in UI-73 and is dead code.

The owner also requires transparent mass-search statistics: how many parameter variants were tested, the distribution of results, the best/average/worst outcomes, and how the final recommendation was selected.

## Decision

### 1. Recommendation-only AI

The AI pipeline ends with a **recommendation**, never with an automatically created or started bot.

```text
Data → Analyst → Search/Backtest → Risk → Recommendation
                                               │
                                     owner reviews the card
                                               │
                                  «Создать робота» / «Отклонить»
                                               │
                                     prefilled draft bot
                                               │
                                        owner starts it
```

- The system may run searches, backtests and analysis automatically, but it does not write `trading_bots`, start bots, stop bots or reallocate budgets.
- A recommendation is linked to a candidate/search and carries a TTL, invalidation rules and suggested allocation.
- Creating a bot from a recommendation opens a prefilled draft; the owner reviews and starts it.
- Every recommendation acceptance/rejection and every bot start/stop is audited.

### 2. Remove abandoned autonomy/automation code

- Remove `apps/api/src/modules/automation` and `packages/contracts/src/automation.ts`.
- Drop `automation_rules`, `automation_rule_state`, `automation_runs`.
- Drop `ai_approvals` and the `ai_profiles.auto_approve_*` columns.
- Remove the auto-approval switches from the AI settings UI and contracts.
- Keep `trading_bots.origin`, `ai_profile_id`, `ai_candidate_id`, `evaluation_timeframe`, `allocation_usd`, `isolated_budget`, `strategy_source`: they link manual paper bots to recommendations.
- Keep `ai_jobs`, `ai_artifacts`, `ai_candidates`, `ai_pipeline_runs`, `ai_usage`, `ai_reports`, `ai_service_configs`, `ai_profile_tokens`, `market_candles`.

### 3. Short-swing horizon

- Primary trading/evaluation timeframe: `1h`.
- Confirmation/context: `4h`.
- Regime filter: `1d`.
- `15m` may be used later for entry timing on liquid tokens; `5m` is out of scope for the short-swing product.
- Target holding period: 1–10 days, with a time stop at the upper bound.

### 4. Purged walk-forward search

For a 180-day dataset:

- Reserve the last **30 days** as a final holdout that is never used for parameter selection.
- Use the first **150 days** for purged walk-forward:
  - train 60 days;
  - purge/embargo 2 days;
  - OOS 10 days;
  - step 10 days;
  - 8 folds.
- Evaluate every parameter variant on every fold. Rank by aggregate OOS metrics and fold stability, not by one best in-sample run.
- A recommendation is emitted only if the variant passes the OOS filters and the final 30-day holdout.
- Parameter search budget: up to **5,000 variants per search**, configurable; searches are asynchronous with progress, ETA and cancellation.
- The search stores aggregate statistics, a top-N table, a histogram and the selection rationale. It does not persist 5,000 separate backtest artifacts; those are search evaluations, separate from the 200 persisted manual backtests/day.

### 5. Transparent statistics

Every search result must show:

- total, valid and rejected variants;
- best, average, median and worst result;
- percentage of profitable variants/folds;
- best/median/worst OOS;
- train→OOS degradation;
- stability across folds;
- final holdout;
- top-N table with parameters and metrics;
- rejection reasons;
- comparison with buy-and-hold and default parameters;
- data coverage/quality and the exact search configuration.

The AI confidence is not treated as a probability of profit. The recommendation is justified by OOS, stability, holdout and risk, not by the model's self-reported confidence alone.

### 6. Invalidation and bot linkage

- A bot created from a recommendation stores `ai_candidate_id`; the recommendation stores the created bot id/status.
- A monitor evaluates linked bots and emits **stop/review recommendations** (notification + audit); it does not stop bots automatically.
- Hard signals: stop/take hit, max drawdown, daily loss, stale data, bot error.
- Soft signals: horizon/TTL expiry, regime change, strategy degradation, rising correlation.
- The bot UI shows the linked recommendation, expected horizon, current health and invalidation reasons.

### 7. UI structure

`ИИ-торговля` becomes:

- `Обзор` — profile, budget, active recommendations, linked bots, alerts.
- `Рекомендации` — recommendation cards/table with TTL and actions.
- `Поиск` — mass search, progress, statistics, top variants, export.
- `Мои ИИ-роботы` — AI-origin bots, recommendation link and invalidation status.
- `Данные` — coverage, quality, refresh.
- `Настройки` — profile, limits, search budgets, model settings.

`Лаборатория` is replaced by `Поиск`. Manual paper bots remain in `Крипта → Роботы`.

## Implementation status (2026-11-20)

- Search: 5,000 seeded variants, 8 purged walk-forward folds, 30-day holdout, distribution/candidate/rejection statistics, async API and `ИИ-торговля → Поиск`.
- Data: GeckoTerminal pagination and 180-day `1h`/`4h` lookbacks; per-token data load in the search tab.
- Recommendation: candidate acceptance creates a prefilled `draft` bot with `ai_candidate_id` and `evaluation_timeframe`; the owner starts it manually. The candidate stores the linked bot id and becomes `accepted`.
- Invalidation: `GET /ai-trading/bots/health` plus a five-minute monitor for drawdown, daily loss, stale ticks, horizon expiry, P&L below the worst OOS fold, bot errors and missing recommendations. It writes notifications/audit and never stops a bot.
- History and TTL: `GET /ai-trading/search/runs` lists recent runs so results survive refresh; candidates expose `expiresAt`/`expired`, expire after `horizonDays` (default 7 days), and stale acceptance returns `AI_RECOMMENDATION_EXPIRED`.
- One-page workspace (ADR 0074): cycle toolbar/card, recommendations and AI bot health; `Вселенная`/`Данные`/`Настройки`/manual search are drawers. Search results export JSON and show an eight-bucket OOS histogram.
- The recommendation-only short-swing loop is complete for this ADR's MVP scope. ADR 0074 adds one-click auto-drafted bots with manual start; auto-start remains forbidden.

## Consequences

- Safer product: no autonomous trading, no runaway worker creation, no approvals machinery.
- The owner is the bottleneck and must review recommendations; the UI must keep the number of active recommendations small and expire stale ones.
- Mass search increases multiple-testing risk; the walk-forward, final holdout, stability filters and transparent statistics are mandatory, not optional.
- Intraday/short-swing data requirements are higher: `1h` history must cover at least 180 days for search, with pagination where providers cap a single request.
- Destructive migration `0050` drops abandoned tables/columns verified empty on 2026-11-19 (automation_rules=0, automation_rule_state=0, automation_runs=0, ai_approvals=0, modified automation settings=0); pre-cleanup encrypted backup `nexter-2026-11-19-pre-ai-cleanup.dump.enc` SHA-256 `ed35dc9b283ff9714fac3dfca07a7c011fc79dd5c9d3fb5f57f153c44aac1a5a`; migration `0050` was applied successfully to a restored production copy.
- Future real execution still requires an external signer/HSM/AA, approvals and step-up TOTP; it is not part of this ADR.
