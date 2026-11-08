# ADR 0017 — Watchlist groups and contract-address token discovery

## Status

Accepted for UI-3 (2026-11-09).

## Context

The watchlist is currently a flat list of assets with a thesis and tags. The owner wants user-defined groups (main, watch, prospective), a group-scoped token list, and the ability to add a token by its contract address. The app has no market-data provider; prices were manual/imported snapshots.

The owner also wants token icons and live metrics. Client-side calls to third-party image or market endpoints would leak the user's IP and violate the no-third-party-trackers rule.

## Decision

- **Groups.** Migration `0018` adds `watchlist_groups` and a nullable `watchlist.group_id`. Every user gets a default `Основная` group. Existing entries are backfilled to that group. A token belongs to one group; moving it updates `group_id`. The default group cannot be deleted; deleting another group moves its entries to the default.
- **Group API.** Owner-scoped CRUD under `/watchlist/groups`, with entry counts. Mutations are audited.
- **Token discovery.** `GET /watchlist/search?chain=&address=` reads ERC-20 `name`, `symbol`, and `decimals` from the chain RPC and enriches the result with CoinGecko metadata (id, icon, price, 24h change, market cap, volume). `POST /watchlist/from-contract` creates/reuses the asset and adds it to the selected group.
- **Metadata storage.** `assets.logo_url` stores the icon URL; `coingecko_id` stores the provider id. Stable metadata is persisted; volatile metrics are fetched live/cached. The asset is created as unverified (`is_verified=false`) until reviewed; manual bookkeeping is allowed, while on-chain swap execution still requires the swap allowlist.
- **Duplicate handling.** `assets_chain_symbol_unique` remains in place. If a token with the same symbol but a different contract already exists, the create request fails with `ASSET_SYMBOL_CONFLICT` instead of silently reusing the wrong asset.
- **Icons.** The browser loads icons from `/api/v1/watchlist/icon?url=...`. The server allows only `coin-images.coingecko.com` and `assets.coingecko.com` over HTTPS, caps the response size, and sets a long cache header. No client request goes to CoinGecko.
- **Provider behavior.** CoinGecko is optional: on timeout, 404, 429, or missing data, search still returns on-chain metadata and the watchlist falls back to the latest stored price. Provider calls are disabled in `NODE_ENV=test`.
- **Rollout.** Migration `0018` is additive with a default-group backfill. No ledger or swap rows are changed. `COINGECKO_BASE_URL`, optional `COINGECKO_API_KEY`, and `COINGECKO_TIMEOUT_MS` configure the provider.

## Consequences

- Groups are simple one-group-per-token collections; a token cannot be in two groups at once.
- Unknown tokens can be recorded manually but cannot be swapped on-chain until allowlisted.
- Duplicate symbols on the same chain are rejected with an actionable conflict.
- Icons are cached/proxied by the server; market data availability depends on CoinGecko and the RPC.
- The watchlist read path may call CoinGecko once per cache window; failures degrade to stored prices, not errors.
