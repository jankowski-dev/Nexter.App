# UI cleanup implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the approved dashboard/header/notifications cleanup and the calendar-first task simplification with file attachments.

**Architecture:** PR A adds one read-only CoinGecko-backed ticker endpoint and rewrites the existing header/dashboard markup with shared control styling. PR B keeps the existing task schema but makes the task list count-only for attachments, adds a detail read, expands the attachment allowlist, and simplifies the task drawer/page.

**Tech Stack:** React 19, TanStack Query/Router, Tailwind, NestJS/Fastify, Zod, Drizzle, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-27-ui-dashboard-tasks-design.md`

## Global Constraints

- No destructive migrations; keep task tags/recurrence columns and `task_images`.
- Existing recurring tasks remain unchanged; only new recurrence UI/creation is removed.
- Files use the Notes allowlist and limits: 5 files, 1.5 MB decoded each.
- No client-side CoinGecko calls; ticker is server-cached and read-only.
- No Stage 3, sandbox, swap, ledger or bot behavior changes.
- Russian UI copy; English identifiers/comments.
- One PR for dashboard/chrome/notifications, one for tasks.

## Review Focus

- Ticker failure/timeout must not break the header.
- Header controls must stay usable at `md`, `lg` and wide widths.
- Task list must not embed base64 attachments after the count-only change.
- File MIME prefix/size checks must remain server-side.
- Custom date picker must not shift dates across timezones.
- Removing recurrence UI must not mutate existing series rows.

---

# PR A — dashboard chrome and notifications

### Task A1: Market ticker endpoint

**Files:**

- Modify: `packages/contracts/src/market.ts` (or create if absent), `packages/contracts/src/index.ts`
- Modify: `apps/api/src/modules/market-data/coingecko.client.ts`
- Create: `apps/api/src/modules/market-data/market-ticker.controller.ts`
- Modify: `apps/api/src/modules/market-data/market-data.module.ts`
- Test: `apps/api/src/modules/market-data/market-ticker.spec.ts`
- Modify: `apps/web/src/lib/api.ts`

**Steps:**

- [ ] Add a Zod `marketTickerResponseSchema` with `{ items: [{ id, symbol, name, priceUsd, change24hPct }] }` and a `MarketTickerResponse` type.
- [ ] Add `CoinGeckoClient.getTopMarkets(limit)` calling `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&price_change_percentage=24h`, with the existing 5-minute cache pattern or a dedicated 60-second cache.
- [ ] Add `GET /api/v1/market/ticker` returning the top 10; no auth secrets, no DB writes. It must return a typed 503/SWAGGER-safe empty list on provider failure rather than break the header.
- [ ] Add `fetchMarketTicker()` in the web API with a 60-second `refetchInterval` at the call site.
- [ ] Unit test: maps the provider response, caps at 10, handles an empty/error response.

### Task A2: Header controls and ticker

**Files:**

- Modify: `apps/web/src/app/root-layout.tsx`
- Modify: `apps/web/src/components/chain-toggle.tsx` (add `iconOnly`/`showDot` props)
- Create: `apps/web/src/components/header-ticker.tsx`
- Modify: `apps/web/src/styles.css` (marquee keyframes + reduced-motion)
- Test: `apps/web/src/components/header-ticker.test.tsx` (pure formatting helper or static render)

**Steps:**

- [ ] Add `iconOnly?: boolean` to `ChainToggle`; in header render only BNB/ETH icons with the active emerald dot; keep labels in Tokens.
- [ ] Refactor header right side into four sibling groups with one shared class (`h-9 rounded-xl border border-zinc-200 bg-white`) and `gap-2`.
- [ ] User group: circular icon button, `aria-label`/`title` with email; no visible email.
- [ ] Wallet group: connect/disconnect button; when connected show shortened `0x1234…abcd` and a tooltip.
- [ ] Theme group: two icon buttons with the existing light/dark state and styling normalized to the group.
- [ ] Add a center ticker slot between `HeaderClock` and the groups; hide below `lg`. `HeaderTicker` fetches the endpoint, formats `SYMBOL price [±x.x%]`, colors change with `pnlTone`, uses `overflow-hidden` and `motion-reduce:animate-none`.
- [ ] Test the ticker formatting helper (positive/negative/zero, empty list) and header snapshot if practical.

### Task A3: Dashboard grid, Stats button, sidebar offset

**Files:**

- Modify: `apps/web/src/features/dashboard/dashboard-page.tsx`
- Modify: `apps/web/src/app/root-layout.tsx`
- Test: `apps/web/src/features/dashboard/dashboard-page.test.tsx` (static render or helper assertions)

**Steps:**

- [ ] Replace the two `section` blocks with a `grid gap-3 lg:grid-cols-2` and two `div className="space-y-3"` columns; four Crypto cards left, four Finance cards right.
- [ ] Remove the `Крипта`/`Финансы` headings and `Торговля`/`Финансы` links; keep `aria-label`s for accessibility.
- [ ] Remove the `Статистика` header action.
- [ ] Add `mt-4`/`pt-2` (or `mb-8` on the logo) so the sidebar nav starts lower.
- [ ] Test that eight cards render and the Stats link is absent.

### Task A4: Notification P&L colors

**Files:**

- Modify: `apps/web/src/features/notifications/notifications-page.tsx`
- Create: `apps/web/src/features/notifications/notifications-page.test.tsx` or add a pure helper test

**Steps:**

- [ ] Add `tradePnl(notification)` for `trade_closed`, `bot_trade_closed`, `bot_positions_closed`, reading `payload.realizedPnlUsd` only when it is a string.
- [ ] Split the body at the first `·` and color only the P&L segment with `pnlTone`; leave the suffix neutral.
- [ ] Keep unread card styling unchanged; legacy rows without P&L stay neutral.
- [ ] Test positive/negative/legacy/other notification types.

### Task A5: Docs and verification

- [ ] Update `docs/decisions.md` with the header/ticker/dashboard/notification batch.
- [ ] Run `format:check`, `lint`, `typecheck`, `test`, `build`.
- [ ] Open PR A, wait for CI, deploy only with owner approval policy, verify health/ready and the ticker endpoint.

---

# PR B — tasks

### Task B1: Count-only task list + task detail endpoint + file allowlist

**Files:**

- Modify: `packages/contracts/src/tasks.ts`
- Modify: `apps/api/src/modules/tasks/tasks.service.ts`, `tasks.controller.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/features/tasks/task-dialog.tsx`
- Tests: `apps/api/test/phase11.e2e.spec.ts`, `apps/e2e/tests/phase11.spec.ts`

**Steps:**

- [ ] Add `attachmentCount: number` to `taskSchema` (or a list summary schema) and stop embedding full `images` in `GET /tasks` list responses; keep full `images` on create/update and add `GET /api/v1/tasks/:id`.
- [ ] Change the task list query to select attachment counts. Keep the existing 200/500 limits.
- [ ] Update the web `fetchTasks`/types and add `fetchTask(id)`; opening a task fetches details (or uses the full create/update response).
- [ ] Expand `taskImageMimeSchema` to the Notes allowlist: PNG/JPEG/WebP, PDF, TXT, DOC/DOCX, XLS/XLSX, RAR/ZIP. Keep the 2,000,000-char data URL cap and 1.5 MB decoded cap.
- [ ] Add API e2e: PDF/zip data URL accepted, MIME mismatch rejected, list returns `attachmentCount` and no data URLs, detail returns full attachment.
- [ ] Keep `task_images` table/route names for compatibility.

### Task B2: File attachment UI

**Files:**

- Modify: `apps/web/src/features/tasks/task-dialog.tsx`
- Modify: `apps/web/src/lib/image.ts` (extract `readDataUrl` or add a file helper)
- Tests: web helper tests, e2e file upload

**Steps:**

- [ ] Rename the section to `Файлы` and the button to `Добавить файл`; `accept` uses the allowlist.
- [ ] Compress only images; read other allowed files as data URLs, enforce 1.5 MB client-side.
- [ ] Render non-images as file cards with name/size and a download link; keep image thumbnails and the remove overlay.
- [ ] Keep max 5 files; disable the button at 5; require a persisted title/id.
- [ ] Add a PDF/zip e2e upload and download assertion.

### Task B3: Task form simplification

**Files:**

- Modify: `apps/web/src/features/tasks/task-dialog.tsx`
- Modify: `apps/web/src/features/tasks/task-row.tsx`
- Create: `apps/web/src/components/ui/date-picker.tsx`
- Maybe modify: `apps/web/src/components/ui/textarea.tsx` (local class only)
- Tests: date picker unit test, e2e form test

**Steps:**

- [ ] Remove tags state/input/view and tag display in rows/dashboard rows; stop sending `tags`.
- [ ] Remove recurrence state/UI, recurrence badges/markers and series-specific delete copy; keep existing series rows untouched.
- [ ] Replace priority `Select` with a `role="radio"` segmented control (`Низкий/Обычный/Высокий/Критичный`), default `Обычный`.
- [ ] Build a custom `DatePicker` with month grid, weekday headers, today/selected states, previous/next/current month, keyboard/Escape, portal/inline expansion inside the drawer. Keep the `YYYY-MM-DD` state contract.
- [ ] Open the picker when clicking anywhere on the `Срок` field; keep the visible formatted date and a hidden/form-compatible value for e2e.
- [ ] Make the description textarea borderless/transparent with no focus ring, matching Notes.
- [ ] Remove the `Готово` button; autosave/X close remain.
- [ ] Update e2e/API tests for tags/recurrence removal and the new date picker.

### Task B4: Tasks page and calendar

**Files:**

- Modify: `apps/web/src/features/tasks/tasks-page.tsx`
- Modify: `apps/web/src/features/tasks/task-calendar.tsx`
- Modify: `apps/web/src/features/tasks/task-row.tsx`
- Tests: `apps/e2e/tests/phase11.spec.ts`, web helper tests

**Steps:**

- [ ] Change initial view to `calendar`; keep List switch and filter behavior.
- [ ] Remove recurrence markers from calendar chips and rows.
- [ ] Keep right-click duplicate +1 day and document it; ensure tags/images count are removed/changed to attachment count.
- [ ] Update the default-view e2e assertion (Calendar selected) and any tag/recurrence assertions.
- [ ] Run full checks and open PR B.

### Task B5: Docs and verification

- [ ] Update `docs/decisions.md` and task API docs for count-only list, detail endpoint, file allowlist, tags/recurrence UI removal and legacy series behavior.
- [ ] Run `format:check`, `lint`, `typecheck`, `test`, `build`.
- [ ] Open PR B, wait for CI, deploy with owner policy, verify task create/edit/file upload/detail and calendar default.
