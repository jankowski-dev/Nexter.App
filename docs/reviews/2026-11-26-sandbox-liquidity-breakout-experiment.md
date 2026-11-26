# Sandbox liquidity and breakout experiment — 2026-11-26

Owner-approved research experiment. No production defaults, Stage 3 runs, report hashes or real-money paths were changed.

## Method

- Six tokens: APR, BTCB, CAKE, ETH, LINK, WBNB.
- 180 days / 4,320 1h bars each, $1,000 initial capital, same seed (7), 25 bps fee, 10 bps slippage, default Stage 1B/1C settings.
- Baseline = current engine.
- `execution-liquidity` = `regime.liquidityMode: 'execution'`.
- `breakout` = `trendPullback.breakout` enabled with lookback 24h, volume ratio 1.5, max ATR 12%.
- `execution+breakout` = both.
- The experiment imported production `sandbox_candles` through a read-only tunnel; no writes to production.

## Results

| Token          |          Baseline | Execution liquidity |       Breakout | Execution + breakout |
| -------------- | ----------------: | ------------------: | -------------: | -------------------: |
| APR            | −6.07%, 10 trades |          −9.98%, 37 | **−1.42%, 12** |          −13.03%, 42 |
| BTCB           |        −9.44%, 63 |          −9.44%, 63 |     −9.29%, 71 |           −9.29%, 71 |
| CAKE           |     **+1.19%, 3** |          −2.25%, 55 |      −0.61%, 6 |           −4.37%, 53 |
| ETH            |        −6.82%, 65 |          −6.82%, 65 | **−4.27%, 73** |           −4.27%, 73 |
| LINK           |             0%, 0 |          −0.80%, 44 |          0%, 0 |       **+2.43%, 49** |
| WBNB           |    **−3.91%, 66** |          −3.91%, 66 |     −6.63%, 75 |           −6.63%, 75 |
| Average return |        **−4.18%** |              −5.53% |     **−3.70%** |               −5.86% |

Breakout configuration sweep (lookback 12/24/48, volume ratio 1.5/2, ATR cap 6/8/10/12) did not produce a configuration that improved all tokens. The APR result was identical across breakout configs because only the first August entry mattered; BTCB/ETH improved slightly with the tighter filters, while CAKE/WBNB remained worse than baseline.

## Liquidity measurement correction

The earlier "LINK ~4–9k" figure was **not LINK liquidity**. It was the average hourly volume of one GeckoTerminal BSC pool. DexScreener shows the BSC Binance-Peg LINK token with roughly $804k + $188k + smaller pools and ~$200k daily volume; Ethereum LINK is much larger again. A `minLiquidityUsd = 50,000` **average hourly volume** gate therefore requires ~$1.2M daily volume, which is why it excludes BSC LINK even though its pool depth is ample for $100–200 orders. The gate conflates depth, volume and chain/pool selection.

## Observations

- **Execution liquidity is not a good default.** It wakes LINK and CAKE, but adds many low-quality trades and worsens aggregate return.
- **Breakout is promising but not safe globally.** It gives APR +4.65 pp and ETH +2.55 pp, but CAKE −1.80 pp and WBNB −2.72 pp. A default switch would need a stronger trend/volatility filter and out-of-sample validation.
- **LINK needs a data/liquidity fix regardless.** Its top-pool 24h average is ~4–9k, so the current volume gate makes the Stage 3 LINK run effectively inactive. The next design should measure liquidity from aggregated pool depth or a broader source, not a single GeckoTerminal pool.
- **The system intentionally sleeps in CRASH/TREND_DOWN/ILLIQUID.** Volatility alone is not a signal; only TREND_UP/RANGE/RECOVERY have a strategy. Breakout adds an entry for the no-pullback TREND_UP case, not for CRASH.

## Liquidity assumed sufficient (sensitivity)

The owner asked what happens if liquidity is temporarily disabled as a factor. This is exactly `regime.liquidityMode: 'execution'` plus `paper.liquidityCapPct: 100`, i.e. no 24h-volume eligibility and no practical per-bar cap.

| Token   | Baseline |     Assume sufficient | Assume + breakout |
| ------- | -------: | --------------------: | ----------------: |
| APR     |   −6.07% | **+0.06%**, DD 15.42% | −5.05%, DD 16.45% |
| BTCB    |   −9.53% |                −9.52% |            −9.38% |
| CAKE    |   +1.19% |      +0.25%, DD 7.64% |            −4.40% |
| ETH     |   −6.89% |                −6.89% |            −4.34% |
| LINK    |       0% |      −4.76%, DD 8.19% |            −0.98% |
| WBNB    |   −4.04% |                −4.04% |            −6.75% |
| Average |   −4.22% |            **−4.15%** |            −5.15% |

Assumed-sufficient liquidity barely changes aggregate return, materially raises drawdown, and makes LINK lose money. It is useful as a **correctness/sensitivity test**, not as a default. Absolute values in this table were produced from a later 4,320-bar window than the first table (small shifts, <0.15 pp), because Stage 3 live runs keep appending candles.

## Recommendation

Do not change defaults. Keep the new fields opt-in for research. Next: design a proper liquidity measurement (aggregated depth/volume) and a selective breakout rule, then rerun six-token and walk-forward validation before any Stage 3 baseline change.
