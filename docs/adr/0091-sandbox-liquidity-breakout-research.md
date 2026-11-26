# ADR 0091 — Optional sandbox liquidity and breakout research controls

Status: experimental, opt-in; defaults unchanged.
Date: 2026-11-26.

## Context

The APR historical replay showed two gaps:

- `regime.minLiquidityUsd = 50,000` (24h average 1h volume) marked most bars `ILLIQUID`; LINK averaged ~9.3k and never reached the strategy layer.
- `trend_pullback` only buys a pullback to the fast SMA, so a vertical trend (APR moved ~0.19 → 0.63 in August) never triggers an entry.

The sandbox rules are frozen for Stage 3, and existing replay hashes must remain reproducible.

## Decision

1. Add `regime.liquidityMode?: 'volume' | 'execution' | 'ignored'`.
   - Missing / `volume` is the current gate.
   - `execution` removes the 24h-volume eligibility and ranking gate; fills remain bounded by `liquidityCapPct` of the current 1h volume and may partially fill.
   - `ignored` additionally removes the practical per-bar cap: the API freezes `paper.liquidityCapPct = 100` and `PaperRunner` uses the same effective cap. This is explicitly a research-only "assume sufficient liquidity" mode and its report config shows 100%.
2. Add `strategies.trendPullback.breakout?: { enabled, lookbackHours, minVolumeRatio, maxAtrPct }`.
   - Missing / disabled is the current behavior.
   - When enabled and flat in `TREND_UP`, buy a close above the prior lookback high only if current volume ≥ the prior average × `minVolumeRatio` and ATR% ≤ `maxAtrPct`.
   - Reuse the existing ATR stop/trailing; new reason code `TREND_PULLBACK_BREAKOUT`.
3. Both fields are optional and **must not be injected when absent**. This keeps old `settingsVersion` hashes, replay identities and Stage 3 frozen settings byte-identical.
4. Defaults remain unchanged. UI exposure is deliberately deferred until the owner reviews the six-token experiment.

## Consequences

- Experiments can be run through the API/research harness without changing production defaults.
- Old replays continue to re-derive the same report hash.
- The first six-token experiment showed that `execution` liquidity is worse on aggregate and breakout is mixed; neither should become a default without a new baseline and owner approval.
- No schema migration: settings are JSONB. No real money, wallets or signing.
