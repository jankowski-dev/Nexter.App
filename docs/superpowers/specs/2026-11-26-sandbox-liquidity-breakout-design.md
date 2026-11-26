# Sandbox liquidity measurement and breakout entry — experiment design

Date: 2026-11-26
Status: owner-approved experiment (opt-in only; no default or Stage 3 change)

## Intent

The APR replay exposed two problems: the regime's liquidity gate marked most bars `ILLIQUID` (especially LINK), and the long-only strategies missed a vertical 3x move because none of them buys a breakout. This slice adds two **optional research controls** so both can be tested on the six Stage 3-era tokens before any default changes.

## Decisions

1. **Liquidity mode.** `regime.liquidityMode?: 'volume' | 'execution' | 'ignored'`.
   - Missing field / `volume`: current behavior, 24h average volume below `minLiquidityUsd` → `ILLIQUID`; ranking drops below the same minimum.
   - `execution`: the token is not rejected by the 24h volume gate; actual fills remain capped by `liquidityCapPct` of the latest 1h volume and can partially fill. Ranking uses a zero liquidity minimum, so a low-volume token can still be ranked and sized down by execution.
   - `ignored`: research-only "assume sufficient liquidity". The gate and ranking minimum are removed and the API freezes the effective paper cap at 100%; `PaperRunner` also applies that cap for direct/live calls. The report config shows the effective 100% cap.
   - No schema migration: settings are JSON. Existing rows and their `settingsVersion` stay byte-identical because the field is optional and **no default is injected on parse**.
2. **Breakout entry.** `strategies.trendPullback.breakout?: { enabled, lookbackHours, minVolumeRatio, maxAtrPct }`.
   - Disabled when absent. When enabled and there is no position, a TREND_UP token may enter if close > highest high of the prior `lookbackHours`, current volume ≥ `minVolumeRatio` × prior average volume, and ATR% ≤ `maxAtrPct`. Stop/trailing remain the existing ATR/trailing rules.
   - New reason code `TREND_PULLBACK_BREAKOUT`.
   - No default is injected, so old settings and report hashes are unchanged.
3. **Validation.** Run baseline, execution-liquidity, breakout and both variants on APR, BTCB, CAKE, ETH, LINK and WBNB over 180 days / 4,320 1h bars, same capital/fees/seed. Report return, drawdown, trades, wins, exposure and regime counts.
4. **No default switch.** The experiment does not change `DEFAULT_SETTINGS`, Stage 3 runs, real-money rules, wallets or signing.

## Non-goals

- No UI controls in this slice; runs are created through the API/research harness until the owner accepts a default.
- No Stage 3 restart or edit.
- No schema migration or table change.
- No change to existing replay hashes; optional fields are absent from old settings.

## Acceptance

- Contract tests prove old settings parse identically and new optional fields parse/validate.
- Core tests prove execution mode bypasses only the volume gate and breakout requires prior-high, volume-ratio and ATR conditions.
- Full typecheck/test/build pass.
- Six-token comparison is recorded in the final report; no production deploy is implied.
