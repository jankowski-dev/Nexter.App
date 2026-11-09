# ADR 0022 — Task tags, image attachments, and autosave

## Status

Accepted for UI-8 owner feedback (2026-11-10).

## Context

Tasks support a title, description, status, priority, due date, recurrence, and archive. The owner asked for tags, attached images, a taller description field, and a Notion-style dialog that saves automatically instead of requiring a Save button. The app is single-owner and has no object storage; adding a third-party upload service would violate the no-third-party-tracker rule.

## Decision

- **Tags.** Migration `0022` adds `tasks.tags text[] not null default '{}'`. Tags are trimmed, 1–40 characters, at most 20 per task, and returned with every task. They are displayed as badges above the title in the list.
- **Images in PostgreSQL.** Migration `0022` adds `task_images` with `user_id`, `task_id`, `name`, `mime_type`, `data_url`, `size_bytes`, and `created_at`. Images are compressed in the browser, sent as base64 data URLs, and stored as text. At most 5 images per task, each at most 1.5 MB after decoding. MIME types are limited to PNG/JPEG/WebP and must match the data URL prefix.
- **Client compression.** The browser resizes images to at most 1400 px on the long side, draws them on a white canvas, and encodes JPEG at quality 0.82. Source files are capped at 15 MB and unsupported types are rejected before upload.
- **API.** `POST /tasks/:id/images` adds an image; `DELETE /tasks/:id/images/:imageId` removes it. Both are owner-scoped and audited (`task.image_added`, `task.image_removed`) without logging image bytes. Tasks returned by the list/create/update endpoints include their images. The Fastify body limit is raised to 4 MB for image payloads.
- **Autosave.** The task dialog has no Save button. It saves changed fields every 10 seconds and when the dialog is closed by the X, Escape, or a click outside. A save is skipped when the title is empty or nothing changed. Saves are serialized to avoid duplicate creates; the first successful save stores the task id and later saves update that task. A failed save keeps the dialog open and shows the error.
- **Recurrence with autosave.** A new recurring task is generated on its first successful save. After that, the recurrence controls are locked and later autosaves update only the current occurrence.
- **Dialog.** The description field is at least 208 px tall, images show as thumbnails with remove actions, and the footer shows autosave status instead of action buttons.
- **List layout.** Status, priority, recurrence, and tags are rendered above the title so they do not move with title length. The description is clamped to one line, the title to two, and the card has a stable minimum height. Image thumbnails appear in the footer.

## Consequences

- Attachments are covered by the same database backup/restore process as the rest of the data; no external storage or credentials are needed.
- Base64 storage is larger than binary storage, so the size and count limits are deliberately conservative.
- Autosave can create a task before the user explicitly finishes editing. Closing with an empty title does not create anything; clearing a title after an autosave leaves the existing task unchanged until a new title is entered.
- Deleting an image is a hard delete of that attachment row; the task itself is never hard-deleted. The action is audited.
