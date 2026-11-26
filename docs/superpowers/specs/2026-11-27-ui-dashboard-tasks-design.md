# UI cleanup: dashboard chrome, notifications and tasks

Status: approved direction 2026-11-27. Two implementation PRs.

## Intent

Reduce visual noise on the dashboard and make the task module match how the owner
actually uses it: a calendar-first, single-task workflow with files instead of
image-only attachments, no tags or recurrence controls, a readable date picker
and a compact header.

## Scope

### PR A — dashboard chrome and notifications

- Header split into four consistent control groups:
  1. light/dark theme;
  2. user icon only (email in a tooltip, no visible address);
  3. wallet connect/disconnect with a short address when connected;
  4. chain icons only (BNB/ETH with the active marker).
- A compact top-10 crypto ticker between the clock and the controls.
- Dashboard KPI cards in two columns: four Crypto cards on the left, four Finance
  cards on the right; remove the section headings and the `Торговля`/`Финансы`
  action links.
- Remove the dashboard header `Статистика` button; the Statistics tab stays.
- Move sidebar navigation slightly lower under the logo.
- Color closed-trade notification P&L red/green using the existing `pnlTone`.

### PR B — tasks

- Default view is Calendar; List remains available.
- Remove the task tags input, tag display in rows and dashboard rows. Existing
  `tasks.tags` data remains dormant.
- Remove recurrence controls and markers from the UI; no new recurring series
  are created. Existing recurring tasks stay as they are (owner decision), but
  no new recurrence is exposed.
- Replace `Картинки` with `Файлы`: images plus PDF/TXT/DOC/DOCX/XLS/XLSX/RAR/ZIP,
  up to 5 files, 1.5 MB each, same limits and download-only policy as Notes.
- Priority becomes a segmented radio control, default `Обычный`.
- Due date uses a custom calendar that opens when the whole `Срок` field is
  clicked, with keyboard support and a readable month grid.
- Description becomes borderless like the Notes editor.
- Remove the `Готово` footer button; autosave and X close remain.
- Right-click on a calendar task duplicates it for the next day (existing
  behavior, kept and documented).

## Approaches

- **Ticker:** reuse watchlist quotes would not provide native BTC/top-10. Chosen:
  a new read-only `GET /api/v1/market/ticker` backed by the existing CoinGecko
  client with a 60-second server cache. The browser never calls CoinGecko.
- **Tasks data:** a full removal of tags/recurrence from contracts/services
  would be a large, risky change with existing series rows. Chosen: remove the
  UI/creation path, keep columns and API compatibility dormant. No destructive
  migration.
- **Attachments:** reuse the proven Notes data-URL pattern and MIME allowlist.
  No object storage or multipart upload. To avoid inflating the task list
  payload, the list returns `attachmentCount` only; a new `GET /tasks/:id`
  returns full attachments. This follows the Notes architecture.
- **Date picker:** a shared custom component, not a native input, because the
  native calendar cannot be styled and only opens from the icon.

## Constraints

- No destructive migrations; `tasks.tags`, recurrence columns and
  `task_images` remain.
- Keep the Fastify 4 MB body limit and the existing 1.5 MB decoded attachment
  cap. Files larger than that need a separate storage decision.
- No Stage 3, sandbox, trading or ledger behavior changes.
- All mutations remain audited.
- UI copy is Russian; code identifiers/comments are English.
- One PR per area: dashboard/chrome/notifications, then tasks.

## Non-goals

- No Board view.
- No bulk task creation, tag management or recurrence redesign.
- No arbitrary/executable file types; SVG/HTML/scripts stay out of the allowlist.
- No new object storage or multipart upload.
- No changes to existing recurring rows in this batch.
