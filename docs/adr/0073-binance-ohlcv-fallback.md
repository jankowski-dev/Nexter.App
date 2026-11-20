# ADR 0073 — Binance OHLCV fallback for AI research

Status: accepted, 2026-11-20.

## Context

The recommendation-only short-swing search requires 180 days of `1h` candles. In practice:

- CoinGecko returns hourly history for at most 90 days on the current plan.
- GeckoTerminal returns only the history of the selected pool; many pools are younger than 180 days or the token has no contract address in the token base.
- Native/major assets such as XRP and ZEC are tracked by CoinGecko without a BSC contract, so GeckoTerminal is not used at all.
- As a result, the production AI universe had at most ~90 days of `1h` data and every search was blocked by `AI_DATA_INSUFFICIENT`.

## Decision

Add a read-only Binance public-klines fallback for a curated allowlist of symbols (`XRP`, `LINK`, `ZEC`, `ETH`, `BNB`, `SOL`, and other majors). It is used only when the existing sources return fewer candles than requested.

- Intervals: `1h`, `4h`, `1d`; up to 5,000 candles per request set.
- Candles are stored in `market_candles` with `source = 'binance'` and `quality = 'ok'`.
- No API key, no signing, no orders, no account access; only `GET /api/v3/klines`.
- The allowlist prevents symbol collisions between a DEX token and an unrelated CEX asset.
- GeckoTerminal/CoinGecko remain the primary DEX/aggregated sources; Binance is a fallback for long history.

## Consequences

- `XRP`, `LINK`, `ZEC` and other majors can satisfy the 180-day `1h` search window.
- DEX-only tokens without 180 days of pool history still cannot run the search; the UI must say so instead of looping on data loads.
- CEX prices may differ slightly from a specific DEX pool. The source is stored per candle, and the search remains research-only paper trading.
- Rate limits are low-volume (a handful of requests per refresh); no keys or production credentials are involved.
- No schema migration.

## Rollback

Remove the fallback injection and redeploy the previous API image. Existing `source = 'binance'` candles can remain; they are ordinary market candles.
