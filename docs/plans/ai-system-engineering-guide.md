# AI System Engineering Guide — final PDF plan

Status: **produced 2026-11-22**. Source: `docs/guides/ai-system-engineering-guide.md`; print HTML: `docs/guides/ai-system-engineering-guide.html`; PDF: `docs/guides/nexter-ai-system-engineering.pdf`; build: `node scripts/docs/build-ai-engineering-guide.mjs`. This is not the user-facing product manual; it explains the algorithm and data flow from first principles.

## Goal

A reader with no prior knowledge of Nexter should understand, by the end, how the AI research system works internally: where candles come from, how folds are built, how a strategy is evaluated, how money/P&L are calculated, how candidates are filtered, what OOS and holdout mean, how recommendations and drafts are created, and how risk/invalidation work.

Tone: “explain the internal combustion engine”, not “explain the dashboard”. Every diagram must explain a mechanism, not a screen.

## Planned chapters

1. **Big picture** — API, Postgres, worker threads, Viber bot, web UI; what is stored where; what is advisory vs executable.
2. **Data layer** — GeckoTerminal/CoinGecko/Binance, `market_candles`, open/high/low/close/volume, `source`/`quality`, coverage, gaps, synthetic candles, adaptive 140–180-day windows.
3. **Research cycle** — one click: data preflight → search → recommendations → draft bots; step logs, cancellation, stale recovery; no auto-start.
4. **Universe and profile** — enabled tokens/timeframes, budget, max workers, allocation/token exposure/max invested, daily caps.
5. **Variant generation** — strategy registry, parameter fields, seeded RNG, quotas, deduplication, why 5,000 is not 5,000 saved backtests.
6. **Walk-forward** — 180-day timeline; 60-day train context, 2-day purge, 10-day OOS, 8 folds; warmup; final 30-day holdout; why the holdout is last.
7. **Backtest engine** — cash, position, average cost, fees, slippage, intrabar stop/take, gaps, forced close, equity curve, drawdown, P&L, win rate, profit factor; decimal arithmetic; full-ISO dates.
8. **Strategies and indicators** — SMA, rolling high/low, RSI, ATR, Bollinger, regime; trend/grid/breakout/mean-reversion/DCA/trailing/crash-grid; stateful strategies and warmup.
9. **Search execution** — worker-thread pool, variant chunks, progress, cancellation, sequential fallback, CPU/event-loop trade-offs.
10. **Filters and scoring** — trades → OOS median → positive folds → drawdown → worst fold; policy score; why “too few trades” dominates; per-variant observability.
11. **Holdout** — warmup-prefixed 30-day scoring; negative return vs excessive drawdown; top-10 multiple-testing guard; why top-N is not widened.
12. **Recommendations** — TTL, allocation, invalidation rules, accept/reject, draft linkage, manual start boundary.
13. **Risk layer** — worker slots, free budget, per-bot allocation, max invested, token exposure; skip reasons.
14. **Paper bots** — runner ticks, quotes, decisions, fills, positions, equity snapshots, trade/event journals; owner-only start/stop.
15. **Invalidation** — drawdown, daily loss, stale ticks, stale/malformed quotes, stop/take, horizon, negative P&L, errors, missing recommendation; regime/correlation as planned extension; advisory only.
16. **Reliability** — DB pool, advisory locks, cycle/search cancellation, stale recovery, audit log, encrypted backups/PITR, no keys on server.
17. **Worked examples** — one healthy recommendation, one holdout rejection, one 0-recommendation run, one risk-limited draft skip.
18. **Formulas and glossary** — return, drawdown, median, stability, policy score, fee/slippage, allocation.
19. **Appendix** — file map, thresholds, env vars, ADR index.

## Diagrams (vector, Mermaid → SVG)

- Service/data-flow map.
- Data acquisition and quality pipeline.
- 180-day fold timeline with warmup/purge/OOS/holdout.
- Backtest engine state machine (cash → position → stop/take/exit).
- Variant funnel (5,000 → filters → top-10 → holdout → recommendation).
- Worker-pool orchestration and progress/cancel sequence.
- Risk allocation and token-exposure diagram.
- Bot runner tick and invalidation state machine.
- Sequence: cycle start → data → search → recommendations → drafts.

## Production constraints

- Russian text, A4, vector diagrams, code references to current files/ADRs.
- PDF generated from Markdown/HTML with a reproducible script in `scripts/docs/` or `docs/guides/`.
- No secrets or production data; use synthetic examples and the audit fixtures.
- Include the independent audit findings and the final decisions (what was fixed, what was deliberately not changed).

## Output

`docs/guides/nexter-ai-system-engineering.pdf` plus its source Markdown and diagram sources.

## Generated 2026-11-22

- 23-page A4 PDF, Russian, vector SVG diagrams, print header/footer and page numbers.
- Covers the data pipeline, adaptive walk-forward, Decimal backtest engine, 11 strategies, signal screen/funnel/control samples, native fast engine and parity, H5 next-open execution, filters/holdout, recommendations/risk, paper bots/invalidation, reliability and worked examples.
- Source Markdown is the editable text; the build script converts it to print HTML and renders the PDF through Playwright Chromium.
- Synthetic examples only; no secrets or production data.
