# ADR 0062 — Explicit task time and recurrence conversion

## Status

Accepted for UI-66 on 2026-11-17. Migration `0042` is additive.

## Context

Tasks stored only `dueAt`. The app used 12:00 local as the legacy “all-day” marker, so a real 12:00 deadline could not be represented: the editor cleared it, `formatTaskDue` omitted it and `isTaskOverdue` treated it as a day task.

Tasks also could not be converted from a one-off into a recurring series: the recurrence fields were only shown on creation, and the update endpoint did not create series rows.

## Decision

Add `tasks.due_has_time` (boolean, default false, migration `0042`).

- New/edited tasks send `dueHasTime` from the editor. The editor sets it to true whenever the user picks a time, including 12:00; clearing the time sets false.
- The API defaults a new `dueAt` without an explicit flag to timed (true) and preserves the flag on updates unless provided.
- Backfill: existing tasks whose local Europe/Minsk time is not 12:00 become timed; legacy 12:00 tasks remain all-day.
- `isTaskOverdue`, `taskTimeLabel` and `formatTaskDue` use the flag instead of the 12:00 heuristic.
- The Viber reminder endpoint returns only tasks with `dueHasTime = true`, so all-day tasks no longer get a five-minute reminder.

Extend `taskUpdateRequestSchema` with `recurrence` and `recurrenceEndsAt`. When a non-series task is updated with a recurrence, the API:

1. uses the new or existing `dueAt` as the anchor;
2. creates a new `seriesId`;
3. turns the existing row into occurrence 0, preserving its images and status;
4. inserts future occurrences up to `recurrenceEndsAt` or the 12-month horizon;
5. audits `task.series_created`.

Changing the recurrence type of an existing series is rejected; use the existing series editor for title/date/status changes.

## Consequences

- 12:00 can be a real deadline and an all-day task without ambiguity.
- The editor always shows the recurrence selector for non-series tasks, including persisted ones.
- Calendar cells render every task; the grid row stretches to the busiest day instead of hiding tasks behind “+N ещё”.
- Migration `0042` is additive; rollback is dropping the column (old code ignores it).
- `nexter_app` already has the needed task privileges.

## Verification

- API e2e: all-day `dueHasTime=false`, conversion of a one-off to a daily series with a bounded end date, all series rows timed and recurring.
- Web unit tests: explicit 12:00 shows a time; all-day 12:00 does not.
- E2E: calendar rendering and task dialog.
