# Phase 11 — Other modules

Status: implemented locally on 2026-11-09. Independent security review: PASS WITH CHANGES; all Medium findings fixed. Pending CI and merge.

## Scope

- End-to-end encrypted password vault.
- Tasks.
- Notes.
- Navigation and mobile layout for the new modules.

## Password vault

- Browser-only encryption: PBKDF2-SHA-256 (600,000 iterations) derives a master key; a random AES-256-GCM data key is wrapped by the master key; each item is encrypted with the data key.
- Server stores only the salt, iteration count, wrapped key, wrapping IV, item ciphertext, and item IV.
- The master password, derived master key, data key, and plaintext never reach the API.
- The vault locks on reload/navigation and has a manual lock action.
- No recovery: losing the master password loses the vault. The setup screen states this explicitly.
- Vault items are archived, not hard-deleted.
- Audit entries record vault/item ids and archive state only; ciphertext and plaintext are not audited.
- API: `GET /vault?includeArchived=`, `POST /vault/initialize`, `POST /vault/items`, `PATCH /vault/items/:id`.
- UI: `/vault` with setup, unlock, locked state, item cards, reveal/copy, generate password, edit, and archive.

## Tasks

- Fields: title, description, status (`open`/`done`/`cancelled`), priority 0–3, tags, due date, completion time, optional related asset, archive timestamp, recurrence (`daily`/`weekly`/`monthly`) and `seriesId`.
- Images: up to 5 per task in `task_images`, compressed in the browser, PNG/JPEG/WebP, max 1.5 MB after decoding.
- API: `GET /tasks`, `POST /tasks`, `PATCH /tasks/:id`, `POST/DELETE /tasks/:id/images`.
- UI: `/tasks` opens on the calendar; completed tasks stay visible and are green, active tasks are blue, overdue tasks are red. The compact list omits descriptions and row edit actions. Clicking a task opens a one-third-width view drawer with delete/complete/edit; creating/editing uses the same drawer with autosave and image upload. `Актуальные`/`Архивные` replaces the archive checkbox; delete is a confirmed soft archive. `GET /tasks` accepts `archivedOnly`.
- Completing sets `completedAt`; reopening clears it. Recurrence rows are generated occurrences, not an RRULE.

## Notes

- Fields: title, body, tags, pinned flag, optional related asset/trade group, archive timestamp.
- Images: up to 5 per note in `note_images`, compressed in the browser, PNG/JPEG/WebP, max 1.5 MB after decoding.
- API: `GET /notes` with `archivedOnly`, `offset`, `limit` (default 30) and `hasMore`; `POST /notes`, `PATCH /notes/:id`, `POST/DELETE /notes/:id/images`.
- UI: `/notes` is a journal. Cards show a notebook icon, title, dates, status, and right-side pin/delete/edit icons. Clicking opens a one-third-width side drawer in read mode; edit mode uses a lightweight Markdown editor with a slightly narrower text area and autosave every 10 seconds and on close. The save indicator sits in the footer left, opposite the actions. `Готово` saves and returns to read mode without closing. Photos have a full-screen viewer with arrows/Escape. Delete is a confirmed soft archive; `Актуальные`/`Архивные` filters and `Загрузить ещё` paginate 30 notes.
- Markdown rendering is a safe React subset (headings, lists, quotes, bold/italic/code, http/https links); no HTML is stored or injected.

## Crypto/habits overhaul (UI-12)

- Main dashboard combines crypto KPIs (month net P&L, positive/negative unrealized, equity), finance KPIs (average daily income/expense, month income/expense), today's tasks including overdue, and habit streaks. The finance page dashboard is unchanged.
- Reported page is renamed `Статистика`; detailed crypto statistics remain there.
- Portfolio tabs: positions, `Основной список` (default watchlist group with buy buttons), trades.
- Token-first buy/sell drawer: live `POST /swap/preview` every 10s, CoinGecko vs Kyber rate difference, one-click build/approval/sign, post-buy trade summary and automatic sell mode. Manual trade entry is separate.
- Single-trade close only, full or partial. Partial close uses FIFO within the selected trade group and keeps the remaining position.
- Trade tabs: active (default), profitable, losing, closed. Mass selection and mass close are removed.
- Manual operations dialog: exchange, deposit, withdrawal, income, adjustment. Manual exchange records a normal swap transaction and appears in the journal.
- On-chain exchange uses a dedicated automatic drawer.
- Live polling: positions/trades/dashboard every 10–15s; small prices use `formatPrice`.
- BNB/ETH header switch is a labeled segmented control with a clear active state.
- Background asset-logo backfill fills missing `assets.logo_url` from CoinGecko.
- `habits` table, API, dashboard form and streak cards; migration `0027`.

## UI-12 production release (2026-11-11)

- PR #70 merged to `main` as `c1839c7`; API deployment succeeded (healthcheck `/ready`), worker stayed online (its deployment was skipped because no worker-specific code changed).
- Live SPA bundle: `assets/index-BFRB8_I4.js`. `/health` and `/ready` return 200 with `database: "ok"`.
- Backup: encrypted PostgreSQL custom dump, 862,557 bytes. Plaintext SHA-256 `0ed88af6cb631d41d4c75739d9efbafcd776ced0bb26c20221d64387b20000bc`; encrypted SHA-256 `747ea86b52f3f438d2e4ab6441cddd834e90662e0fd414d03f6ec5cb763f5b6a`.
- Restore check: restored into a scratch database on the production Postgres instance; counts matched (856 transactions, 3,406 postings, 433 lots, 431 trade groups, 45 assets, 249 finance transactions), realized P&L `55.61024691`, lot remaining `9001602.010317392293953545`, fees `0.19681704`, and zero orphan postings/lots/consumptions. Scratch database was dropped.
- Backup storage: the encrypted dump is kept outside the repository at `~/.nexter/backups/nexter-2026-11-11-ui12.dump.enc`; the encryption key is at `~/.nexter/backup-key` (mode 600). The plaintext dump was deleted after verification.
- Migration `0027`: applied through a Railway SSH tunnel using the owner connection. Verified `habits` exists, `habits_user_name_unique` is partial on `archived_at IS NULL`, `nexter_app` has SELECT/INSERT/UPDATE/DELETE, and 28 migrations are recorded.
- Asset logo backfill filled 38 assets (including BNB, ETH, BASED, POP, APR, XNY, USDC, USDT). Production dashboard, portfolio, `Основной список`, buy drawer, Статистика, Operations, Tasks, Notes, and Vault were opened; no console errors. Habits API returned `{"data":[]}` and the create form rendered.

## UI-13 UI polish (2026-11-11)

- Dialog/Drawer gained a reference-counted body scroll lock with scrollbar-width compensation and `overscroll-contain`; background scrolling is disabled until the last overlay closes.
- Navigation order is now Дашборд, Задачи, Крипта, Финансы, Заметки, Хранилище, Настройки; Dashboard and Tasks are top-level.
- Portfolio keeps Портфель/Сделки at the top and adds Позиции по активам/Основной список below the summary cards. The legacy `#buy` hash maps to the main list; `#list` is canonical.
- The Buy/manual action is the column immediately after the token name. Non-allowlisted tokens show `Вручную` and an explanation; the allowlist itself is unchanged.
- Token base uses the shared header BNB/ETH switch and one-row token entries with icon, symbol/name/chain, group/tags, price, and 24h.
- A header live indicator appears on Dashboard/Portfolio/Статистика/Watchlist/Operations, shows a countdown, `Обновляю…`, and `Обновлено`; updated cards flash green briefly. Статистика and Operations poll every 30 seconds.
- Pending wallet-signature cancellation is intentionally unchanged: the owner chose not to disconnect WalletConnect; the drawer explains that the request must be rejected in the wallet.
- No migration. See ADR 0029.
- Production: PR #74 deployed on 2026-11-11, bundle `assets/index-Dzy6ybJW.js`, `/ready` green. Verified on production: menu order, portfolio sub-tabs, Buy column placement, token-base rows/chain switch, header countdown, body scroll lock (`overflow: hidden` while open, restored after close), and no console errors.

## UI-14 unified market quotes and live values (2026-11-11)

- Root cause fixed: portfolio/dashboard/trades/reports used manual `prices` rows while the token base used CoinGecko, so XNY showed 0.00571055 vs 0.00502655 and the dashboard could stay stale.
- Added `market_quotes` (one row per asset) with `price_usd`, `change_24h_pct`, `source`, `liquidity_usd`, `fetched_at`, `changed_at`. `PricingService` now prefers quotes and falls back to manual prices only when no quote exists.
- DexScreener is primary for BSC/Ethereum contract tokens with at least $25k liquidity, refreshed every 60 seconds. CoinGecko is fallback for native/low-liquidity tokens every 10 minutes. Cash equivalents are fixed at $1.
- Dashboard, positions, trades, reports, and watchlist share the same quote source. Positions/trades/main list/token base show relative last-update times with exact change/check/source tooltips; the dashboard shows the newest position quote time.
- Whole-card flashing is removed. `LiveValue` flashes only the displayed value that changed.
- Header countdown is replaced by a small fan that spins while live queries are fetching and stops when idle or failing.
- WalletConnect now restores an existing session silently on page load and persists the selected chain; header and drawers share the same provider. Session expiry still requires one reconnect.
- Monthly net profit remains realized Net P&L by design; unrealized P&L and capital are price-driven.
- Migration `0028` is additive. Pending signature cancellation remains unchanged per owner decision.
- See ADR 0030.
- Production: PR #76 deployed on 2026-11-11, bundle `assets/index-4eVw9zSV.js`, `/ready` green. Migration `0028` applied; `market_quotes` had 45 rows, XNY 0.005035 from DexScreener, `nexter_app` DELETE = false. Dashboard equity moved from 1845.89 to 1757.46 and negative unrealized from 672.74 to 768.92 as quotes replaced stale manual prices. Backup `nexter-2026-11-11-ui14.dump.enc` was restore-verified (counts and sums matched) before deploy.

## UI-15 cosmetic batch (2026-11-11)

- Buy/sell and exchange drawers no longer render the bottom quote-status/`Готово` footer. They close on header X or backdrop mousedown; unsafe execution phases keep the close guard.
- The trade journal drops the quality/reconciled column and keeps only the source.
- The live-refresh fan has no bordered background and is slightly larger.
- The vault list is full width with instant client-side search by title, login, or URL.
- Task and note drawers show a transient three-second `Сохранение…` indicator with a moving loader; the permanent autosave/status text is removed. The note drawer no longer offers pin/unpin; pinning stays in the compact list.
- No migration. Production: PR #78 deployed on 2026-11-11, bundle `assets/index-DuPzXk-4.js`, `/ready` green. Backup `nexter-2026-11-11-ui15.dump.enc` was restore-verified (transactions 856, postings 3406, lots 433, trade groups 431, quotes 45, users 1; counts matched) before merge.

## UI-16 multi-period changes and icon cache (2026-11-11)

- `market_quotes` gains nullable 7-day, 30-day, 1-year percentage changes and market cap. CoinGecko `/coins/markets` requests 24h/7d/30d/1y; period/cap values merge into DexScreener-priced tokens, while DexScreener remains the primary price and 24-hour source.
- New quote values are exposed on positions, portfolio asset quotes, and watchlist entries. `Позиции по активам`, `Основной список`, and the token base show 24h/7d/30d/1y; the token base sorts by cap or any period with an ascending/descending toggle.
- Three-month history is intentionally omitted; the UI never labels a different period as three months.
- The icon proxy caches images in memory for 24 hours with in-flight coalescing and an 8 MB/200-entry bound. The global API no-store hook exempts exactly `/api/v1/watchlist/icon`, so the existing public 24-hour browser cache header survives.
- Migration `0029` is additive. See ADR 0031.

## Database

Migrations `0019_remarkable_songbird.sql` (vault/tasks/notes), `0020` (token base), `0021` (task recurrence), `0022` (task tags/images), `0023`–`0025` (personal finance), `0026` (note images), `0027` (habits), `0028` (market quotes), and `0029` (multi-period quote fields) are additive. `0019` adds:

- `vault_configs` (unique per user).
- `vault_items` (owner-scoped ciphertext).
- `tasks`.
- `notes`.

`0027` adds `habits` (`name`, `started_on`, `archived_at`) with a partial unique index on active names per user and a conditional DML grant for `nexter_app`. `0028` adds `market_quotes` (one row per asset: price, 24h change, source, liquidity, fetched/changed timestamps) and conditionally grants SELECT/INSERT/UPDATE plus revokes DELETE for `nexter_app`. `0029` adds nullable `change_7d_pct`, `change_30d_pct`, `change_1y_pct`, and `market_cap_usd` to `market_quotes`; existing table-level grants cover the new columns.

All tables are additive; no existing table or ledger row is changed.

## Tests

- API `phase11.e2e.spec.ts`: vault setup, item archive/restore listing, ciphertext/IV pairing and base64-length validation, tasks lifecycle, notes search/update/archive, related-link validation, audit actions, and no ciphertext in audit.
- E2E `phase11.spec.ts`: vault setup, item creation, server-side plaintext absence, reload lock, wrong password, unlock, manual lock, navigation lock, lock-with-dialog clearing, generate-password, archive/restore, task create/complete, note create/search.
- UI-16 unit tests cover CoinGecko period merge, new-asset refresh between ticks, stale-period preservation/clearing, icon cache hit/dedup/TTL/host/content-type, and the exact icon cache-control exemption.
- Full API and E2E suites are run before merge.

## Security notes

- The vault threat model assumes the server or database may be read by an attacker; ciphertext alone does not reveal plaintext without the master password.
- PBKDF2 work factor is fixed at 600,000 for new vaults; existing configs carry their own iteration count.
- The server still sees access patterns and item counts/timestamps.
- Tasks and notes are not end-to-end encrypted; they rely on application auth and database controls.
- No third-party crypto, analytics, or network calls are added.

## Residuals

- Master-password rotation/re-wrap is deferred; no server key-replacement endpoint is exposed in this slice.
- No vault import/export, sharing, or recovery.
- Vault list is capped at 500 items (active by default; `includeArchived=true` uses the same cap).
- Vault item search is not implemented in this slice.
- List caps (500 vault items, 200 tasks by default) are not surfaced as a truncation indicator in the UI; notes paginate 30 at a time with `Загрузить ещё`.
- Vault ciphertext is authenticated but not bound to item id/user id with AAD; a party controlling the database could swap ciphertexts between items.
