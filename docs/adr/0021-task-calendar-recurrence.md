# ADR 0021 — Task calendar and recurring occurrences

## Status

Accepted for UI-7 stage 5 (2026-11-09).

## Context

Tasks already have a title, description, status, priority, due date, related asset, and soft archive. The owner wants a Notion-like calendar view, moving tasks between days, and recurring tasks. Recurrence is a personal planning aid, not a financial or tax rule.

A full RRULE engine would add significant complexity for a single-owner app. The calendar must stay responsive, and completing or moving one occurrence must not rewrite the rest of the series.

## Decision

- **Generated occurrences, not RRULE.** Creating a recurring task generates individual task rows, one per occurrence, linked by a shared `series_id`. Each row carries `recurrence` (`daily`, `weekly`, `monthly`) and `occurrence_index`. There is no background scheduler and no RRULE expansion at read time.
- **Generation horizon.** Occurrences are generated from the first due date until `recurrence_ends_at`, or for 12 months when no end date is given, capped at 366 rows per series. The API stores `recurrence_ends_at` on every occurrence for display.
- **Calendar-date arithmetic.** Daily and weekly occurrences add fixed UTC durations. Monthly occurrences add calendar months and clamp to the last valid day (for example, 31 January → 28 February → 31 March in a non-leap year).
- **Occurrence isolation.** Completing, editing, archiving, or dragging one occurrence affects only that row. The rest of the series remains unchanged. Editing the series as a whole is not part of this slice.
- **Calendar view.** The tasks page gains `Список`/`Календарь` tabs. The calendar shows one month, Monday-first, with weekday headers, previous/next/today controls, a `+` per day, and colored task chips. Clicking a chip opens the existing task dialog prefilled with that occurrence.
- **Drag and drop.** Dropping a chip on a day updates only that task's `due_at` to 12:00 local time on the target date. The update is audited like any other task mutation.
- **Range queries.** `GET /tasks` accepts optional `from`/`to` ISO timestamps (inclusive) so the calendar can fetch only the visible month. The existing list view keeps the current filters and 200-row default; the calendar requests up to 500 rows.
- **Validation.** A recurring task requires a due date. `recurrenceEndsAt` requires `recurrence` and must be on or after the first due date. A recurring create with no valid occurrences is rejected.
- **Migration.** Migration `0021` adds `series_id`, `recurrence`, `recurrence_ends_at`, and `occurrence_index` (default 0) to `tasks`, plus an index on `(user_id, series_id)`. It is additive; existing tasks get `occurrence_index = 0` and no series.
- **No financial effect.** Tasks never create transactions and never affect balances or P&L.

## Consequences

- Recurring tasks are ordinary rows, so they participate in search, filters, audit, archive, and exports without special cases.
- A daily series creates up to 366 rows; the 12-month horizon keeps the table bounded. Extending a series later means creating a new recurring task.
- Moving one occurrence does not keep the original cadence for that occurrence; this is intentional and matches occurrence-level editing.
- Time zones follow the browser's local calendar for display and drag/drop, while the API stores UTC timestamps. Due dates created from the date input are anchored at 12:00 local to avoid date shifts.
