# ADR 0025 — Notes as a journal

## Status

Accepted for the notes redesign (2026-11-10).

## Context

Notes started as a small modal with a title, plain text, tags, and an archive checkbox. The owner uses notes as a journal: longer entries, formatting, photos, quick reading, and editing without a Save button. The list should stay compact and show only title, dates, status, and actions.

## Decision

- **Side drawer.** A note opens in a right-side drawer sized to one third of the viewport on desktop and full width on mobile. The list card opens the note in read mode; the edit icon opens the same drawer in edit mode.
- **Read and edit modes.** Read mode renders the note as a journal entry with Markdown formatting, photos, tags, and dates. Edit mode exposes the title, a lightweight Markdown editor, tags, pin, and photo management. The edit button carries a pencil icon and the drawer title repeats it.
- **Autosave.** Edit mode saves every 10 seconds and on close (X, Escape, or outside click). There is no Save button. Creates are serialized like tasks: the first successful save stores the note id, and later saves update it. Empty titles are not created.
- **Lightweight Markdown.** The editor has toolbar actions for bold, italic, headings, lists, quotes, code, and links. Rendering is a safe React subset (headings, lists, quotes, bold, italic, inline code, http/https links); no HTML is stored or rendered. `body` remains the same text column.
- **Photos.** Migration `0026` adds `note_images` with the same constraints as task images: PNG/JPEG/WebP, max 5 per note, max 1.5 MB after decoding, browser-side compression, owner-scoped add/remove endpoints, and audits. Photos open in a full-screen viewer with a dim backdrop, previous/next buttons, arrow keys, Escape, and a counter.
- **Delete is archive.** The card and drawer expose a trash action. The drawer dims and shows a confirmation; confirming archives the note and closes the drawer, cancelling leaves the drawer open. Archived notes are restored from the `Архивные` view. Nothing is hard-deleted through the UI.
- **List.** Cards show only the title, created/updated dates, pinned/archive status, pin icon, edit icon, and delete icon. The body is not shown in the list.
- **Filters and pagination.** `Актуальные`/`Архивные` is a segmented switch to the right of search. `GET /notes` accepts `archivedOnly` and `offset`, returns `hasMore`, and the UI loads 30 notes per page with `Загрузить ещё`.
- **Security.** Notes stay plaintext and owner-scoped. Images are validated by MIME and size, links are limited to http/https, Markdown is rendered as React nodes rather than `dangerouslySetInnerHTML`, and mutations remain audited.

## Consequences

- The notes list is dense and journal-like; reading requires opening a note, which is the intended interaction.
- Markdown is a deliberate subset, not a full CommonMark implementation. Content remains portable plain text.
- Note images are stored in Postgres like task images; backups cover them, and the same size limits apply.
- Archived notes are excluded from the active list but remain available for restore; no hard delete is offered.
- Migration `0026` is additive and conditionally grants DML on `note_images` to `nexter_app`.
