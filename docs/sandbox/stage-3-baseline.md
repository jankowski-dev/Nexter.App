# Stage 3 baseline — forward paper validation

Date: 2026-11-25
Window: 2026-11-25 → 2027-01-20 (8 weeks)
Owner approval: 2026-11-25 (8 weeks, different token set, current capital/settings, separate clean runs, manual close logged, code changes allowed)

## Runs

| Name           | Token | Token key                                        |   Capital | Started (UTC)       | Run ID                                 | Start coverage                                             |
| -------------- | ----- | ------------------------------------------------ | --------: | ------------------- | -------------------------------------- | ---------------------------------------------------------- |
| Stage 3 — CAKE | CAKE  | `bsc:0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82` | $1,000.00 | 2026-11-25 06:35:25 | `ab8e3adf-7ce7-429b-ab84-739f411a50c3` | 4320/4320 `ok`                                             |
| Stage 3 — BTCB | BTCB  | `bsc:0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c` | $1,000.00 | 2026-11-25 06:47:49 | `d0b24abd-b4bf-4134-9ee4-5d8fa8071b95` | 4320/4320 `ok`                                             |
| Stage 3 — ETH  | ETH   | `bsc:0x2170ed0880ac9a755fd29b2688956bd959f933f8` | $1,000.00 | 2026-11-25 06:50:13 | `1b5f2983-28b4-4c3d-ae15-7cb418077e3f` | 4320/4320 `ok`                                             |
| Stage 3 — LINK | LINK  | `bsc:0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd` | $1,000.00 | 2026-11-25 06:55:07 | `179f0ee7-025c-41b8-88e9-75e8d4808807` | 4320 bars, `partial` (18 extra pre-window hours, accepted) |
| Stage 3 — WBNB | WBNB  | `bsc:0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c` | $1,000.00 | 2026-11-25 06:58:27 | `6e7fcda0-6dd8-4cc7-a14c-8ded1a7d7d9e` | 4320/4320 `ok`                                             |

Each run uses the current Stage 1B/1C defaults and is a separate clean run. The
owner's `Quack AI` run is excluded from Stage 3.

## Token universe changes

- `binance:BTCUSDT`, `binance:ETHUSDT`, `binance:SOLUSDT`,
  `binance:LINKUSDT` were created during setup, then disabled because Binance
  returned HTTP 451 from the production Railway region.
- BSC equivalents BTCB/ETH/LINK/WBNB now provide the majors via GeckoTerminal.
- `Stage 3 — SOL` was repurposed as `Stage 3 — WBNB`; no separate SOL run.

## Data

- BSC 1h GeckoTerminal, 180-day warmup.
- CAKE/BTCB/ETH/WBNB: 4,320/4,320 `ok`, gaps 0, not stale, not synthetic.
- LINK: 4,320 bars but `partial` because the first bar is 2026-05-28 12:00
  (18 extra pre-window hours); the evaluation tail is present. Start accepted
  with `allowPartial`, recorded as an incident note.
- GeckoTerminal 429 retries observed during setup; no fabricated candles.

## Audit

The five Stage 3 runs were created/started through the audited service path:
`sandbox.run_created`, `sandbox.run_started`, `sandbox.run_updated`,
`sandbox.token_created`, `sandbox.token_refreshed`, `sandbox.token_updated`.
No real money, wallet, key, signing or exchange execution is involved.

## Cadence

Weekly checkpoints on Wednesdays: 2026-12-02, 12-09, 12-16, 12-23, 12-30,
2027-01-06, 01-13, 01-20. Final stop/report 2027-01-20.
