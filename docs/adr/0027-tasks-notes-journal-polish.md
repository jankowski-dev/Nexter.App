# ADR 0027 — Task and note journal polish

## Status

Accepted for the tasks/notes feedback batch (2026-11-10).

## Context

The owner asked for a unified journal-like interaction between tasks and notes: calendar-first tasks, compact list rows without description text, side drawers for view/edit, soft delete with an archive view, completed/overdue colors in the calendar, notes with a notebook icon and pin actions on the right, and smooth page/dialog/drawer transitions.

## Decision

- **Calendar-first tasks.** `/tasks` opens in the calendar view. The calendar ignores the status filter so open, done, and cancelled tasks remain on their due dates. Chips are blue for active tasks, green for completed tasks, red for overdue open tasks, and gray for cancelled tasks. A legend is shown above the grid. The status filters are only shown in the list view.
- **Compact task list.** List rows show a clipboard icon, title, status, priority, due date, recurrence marker, image count, and tags as a tag icon plus comma-separated text. The description and image thumbnails are not shown in the list. Rows open the task view on click. The only row actions are complete/reopen, delete, and restore in the archive view; editing lives inside the full view.
- **Task drawer.** Creating, viewing, and editing a task use a one-third-width right drawer, matching notes. View mode shows status, priority, due date, description, tags, images, and actions delete/complete/edit. Edit mode uses the existing autosave (every 10 seconds and on close) with a footer save indicator and `Готово`; `Готово` saves and returns to view mode instead of closing the drawer. Delete is a confirmed soft archive.
- **Task archive.** The archive checkbox is removed. `Актуальные`/`Архивные` is a segmented switch; `GET /tasks` gains `archivedOnly`, and the archive view shows all archived tasks regardless of the status filter. Deleting a task moves it to the archive; the archive view restores it.
- **Notes journal alignment.** Every note card gets a notebook icon next to the title. The pin action moves to the right action group with delete and edit. The save indicator moves to the left side of the drawer footer, opposite delete/edit. The note editor textarea is narrowed by roughly two line heights (`2.5rem`) while the toolbar stays full width.
- **Notes edit completion.** `Готово` in a note drawer saves and switches to read mode; it no longer closes the drawer. Closing via X, Escape, or the backdrop still saves and closes.
- **Motion.** Route content fades in on pathname changes. Standard dialogs fade the backdrop and scale/fade the panel; side drawers fade the backdrop and slide in from the right; the image viewer and TOTP/confirm overlays use the same motion tokens. `prefers-reduced-motion` disables the animations. Page motion is opacity-only so it does not create a transformed containing block that would trap fixed drawers inside the page.
- **Shared confirmation.** Notes and tasks use one `ConfirmDialog` component for the dimmed delete confirmation, keeping labels and animation consistent.

## Consequences

- No database migration. The only API contract change is the additive `archivedOnly` task filter.
- Deleting tasks and notes remains a soft archive; nothing is hard-deleted through the UI.
- The calendar can show more chips because completed tasks are no longer filtered out; the existing `MAX_VISIBLE` overflow indicator still applies per day.
- Task and note drawers share the one-third-width layout and footer conventions, at the cost of more vertical scrolling for long task forms.
- The page transition is a fade rather than a slide to keep fixed overlays anchored to the viewport.
