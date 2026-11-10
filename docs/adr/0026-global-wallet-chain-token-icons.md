# ADR 0026 — Global wallet chain, finance periods, and token icons

## Status

Accepted for the UI-10 owner feedback batch (2026-11-10).

## Context

The owner asked for six changes: make the vault a separate top-level service, replace the finance month field with period presets, remove remaining English finance labels, choose category colors from a visual marker list, move wallet/chain controls into the global header, and show token icons from the token base with a manual override.

## Decision

- **Vault navigation.** `Хранилище` leaves the Crypto accordion and becomes a top-level navigation item. It remains an independent encrypted service and is not grouped with crypto accounting.
- **Finance periods.** The finance page uses the same preset pattern as crypto reports: `Текущий месяц`, `Прошлый месяц`, `Выбрать месяц`, `За год`, and `За всё время`. The custom preset keeps the month picker. `GET /finance/summary` accepts inclusive `from`/`to` dates and `all=true`; `month` remains for the existing monthly trend and backward compatibility. The journal uses the same range. Cancelled operations remain excluded from every period.
- **Russian labels.** Visible finance labels use Russian (`Чистый капитал`, `Сальдо`, `Категории периода`). Obvious English labels in the touched shell and finance-adjacent screens were also translated. Currency codes and product names are not translated.
- **Category colors.** The category dialog offers a fixed palette of nine color markers with Russian names. The stored `color` remains a short string key, so existing imported categories keep working; the UI no longer accepts free text.
- **Global wallet and chain.** WalletConnect state moves into a `WalletProvider` mounted by the app shell. The header owns theme, owner email, connect/disconnect, and BNB/ETH toggles. Connecting defaults to BNB when no chain has been explicitly selected; an open embedded trade keeps its chain so connecting cannot silently retarget it. Selecting ETH (or BNB) updates one global chain used by the embedded swap and trade flow; a connected wallet is asked to switch networks, and a failed switch reverts the header selection. Signing still re-checks the order chain and switches again if necessary, so the header is a UI selector, not a security boundary.
- **Removed header actions.** The global `+ Операция` button and `MVP-1 · BSC/Ethereum` status text are removed. The operation modal still opens from Portfolio (`Новая сделка`) and from the asset drawer.
- **Token icons.** `assets.logo_url` is the canonical token icon, and the asset contract now exposes `logoUrl`. Portfolio, trades, the asset drawer, and the token base render a shared `TokenIcon` with initials as the fallback. CoinGecko HTTPS URLs continue through the server-side icon proxy; uploaded icons are compressed in the browser to a 128×128 WebP/PNG data URL (decoded limit 250 KB) and stored in the same column. Only CoinGecko HTTPS URLs or image data URLs are accepted, preserving the proxy host allowlist and avoiding browser-side third-party requests.
- **Manual icon mutation.** The token-base edit dialog adds `logoUrl` to `PATCH /watchlist/:id`; updating it writes the shared asset row and records the before/after icon in the existing `watchlist.updated` audit entry. The change is owner-scoped through the watchlist entry.

## Consequences

- The header is the single place to connect the wallet and choose the active chain; duplicate chain/disconnect controls were removed from the swap panel, while the panel keeps a connect button for the embedded flow.
- The global chain starts at BNB; a fresh connect without an explicit selection stays on BNB. Explicit selections survive connect/disconnect, while a failed wallet switch reverts the header to the previous chain.
- Manual token icons are global to the token-base asset, which is appropriate for the single-owner deployment. A future multi-user deployment would need a per-user icon override.
- Data-URL icons slightly enlarge asset responses; the browser compression keeps them small.
- No database migration is needed. Finance summary range support is additive, and the icon override reuses `assets.logo_url`.
- Opening a trade asset on another chain moves the global chain to that asset so the embedded swap and trade stay consistent. If the chain changes from outside that flow, the trade form clears its asset and amount and returns to manual mode instead of silently quoting another token pair.
