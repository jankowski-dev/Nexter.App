# Stage 3 incident log

Window: 2026-11-25 → 2027-01-20. Record every data/runner/risk incident, owner
intervention and code change. No real money.

| #   | Time (UTC)             | Type | Summary                                                                                                             | Impact                                                                               | Action / status                                                                              |
| --- | ---------------------- | ---- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 1   | 2026-11-25 06:33       | data | Binance HTTP 451 from the Railway US region; `binance:BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `LINKUSDT` returned 0 candles | Four draft runs could not start; Binance live data is not sustainable in this region | Disabled the Binance tokens; created BSC equivalents via GeckoTerminal; recorded in baseline |
| 2   | 2026-11-25 06:33–06:54 | data | GeckoTerminal 429 rate limits during sequential 180-day refreshes; WBNB refresh retries exhausted once (fetched 0)  | WBNB draft not started on the first attempt                                          | Retried WBNB after the rate limit cleared: 4320/4320 `ok`, run started 06:58:27              |
| 3   | 2026-11-25 06:55       | data | LINK coverage reported `partial`: 4,320 bars with 18 extra pre-window hours (first bar 2026-05-28 12:00)            | No missing evaluation tail; start required explicit `allowPartial`                   | Accepted and recorded; monitor for gaps/staleness                                            |
| 4   | 2026-11-25 06:35–06:58 | ops  | Five Stage 3 runs created/started: CAKE, BTCB, ETH, LINK, WBNB                                                      | Stage 3 active                                                                       | Baseline recorded in `docs/sandbox/stage-3-baseline.md`                                      |

## Owner interventions (manual close)

| #   | Time (UTC) | Run | Token | Reason   | Result |
| --- | ---------- | --- | ----- | -------- | ------ |
| —   | —          | —   | —     | none yet | —      |

## Code changes during Stage 3

| #   | Time (UTC) | Commit/deployment | Change   | Reason | Impact |
| --- | ---------- | ----------------- | -------- | ------ | ------ |
| —   | —          | —                 | none yet | —      | —      |

## Templates

**Incident:** time, type (data/runner/risk/report/security), run/token, what
happened, impact, action, owner decision, follow-up.

**Intervention:** time, run/token, action (`manual close`, pause, resume,
stop), reason, result, whether it was discretionary.

**Change:** commit, deployment, what changed, why, review/CI evidence, impact
on Stage 3, whether a new baseline is required.
