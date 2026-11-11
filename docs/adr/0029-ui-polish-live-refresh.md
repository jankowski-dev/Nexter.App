# ADR 0029 — UI polish: scroll lock, navigation, portfolio sub-tabs, live refresh

## Status

Accepted for the owner UI-polish batch (2026-11-11). No schema changes.

## Context

The owner reported double scrolling behind open drawers/dialogs, wanted the dashboard outside the Crypto accordion, wanted the portfolio main list as a sub-tab next to positions rather than a third top-level tab, wanted the Buy action next to the token name, wanted the token-base chain selector to match the header and the token list to be compact rows, and could not tell whether live data was refreshing. The owner also asked for a way to cancel a pending wallet signature.

## Decision

- **Scroll lock.** `Dialog`, `Drawer`, `ConfirmDialog`, and `NoteImageViewer` use a reference-counted body scroll lock. While any overlay is open the body cannot scroll; nested overlays (confirm, TOTP, image viewer) keep the lock until the last one closes. Scrollable panels use `overscroll-contain`, and scrollbar width is compensated to avoid layout shift.
- **Navigation.** Dashboard and Tasks are top-level. The order is `Дашборд`, `Задачи`, `Крипта`, `Финансы`, `Заметки`, `Хранилище`, `Настройки`. The Crypto accordion keeps Portfolio, Operations, Watchlist, and Статистика. Mobile navigation follows the same order.
- **Portfolio.** Top-level tabs remain `Портфель` and `Сделки`. Inside `Портфель`, a second tab strip switches between `Позиции по активам` and `Основной список`. The legacy `#buy` hash opens the main list; `#list` is the new canonical hash.
- **Main list.** The Buy/manual action is the column immediately after the token name, not the far-right edge. Tokens outside the swap allowlist show `Вручную` and a short explanation. The allowlist is intentionally unchanged: enabling a token remains a reviewed registry change.
- **Token base.** The search network selector uses the shared header `ChainToggle` (BNB/ETH, active white segment, colored icon, green dot). Token cards become one-row entries similar to notes: icon, symbol/name/chain, group/tags, price, 24h, and a chevron to open the drawer.
- **Live refresh.** A header indicator appears only on live routes: Dashboard (10s), Portfolio (15s), Статистика (30s), Watchlist (30s), Operations (30s). It shows a countdown, switches to `Обновляю…` while a query is fetching, and briefly shows `Обновлено` after a successful refresh. The same pages briefly flash their data cards in green when fresh data arrives. Статистика and Operations gain 30s polling. The header indicator is desktop-only (`sm` and up) to avoid crowding the narrow mobile header; the data still refreshes on mobile.
- **Pending signature.** Cancelling a WalletConnect signature request reliably would require disconnecting the wallet. The owner chose not to change the current blocking flow. The drawer now explains that the request must be rejected in the wallet app. No cancel action is added.
- **Habits hard delete.** As a security hardening follow-up, `nexter_app` loses DELETE on `habits`; archive/restore remains the only UI path.

## Consequences

- Background page scrolling is disabled while any overlay is open; closing the last overlay restores the previous body styles.
- Dashboard is no longer part of the Crypto accordion, so crypto navigation highlights only Portfolio/Operations/Watchlist/Статистика.
- The main list is one click deeper inside Portfolio, but the top-level information architecture matches the owner's model.
- Live indicators are polling-based and approximate the next refresh from the active route interval; they reset only on successful updates of the live query keys for that route.
- `Основной список` continues to mark non-allowlisted tokens as manual-only; adding a token to the on-chain allowlist is still a reviewed server change.
- No migration; no API contract change except the existing statistics/operations polling on the client.
