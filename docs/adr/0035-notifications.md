# ADR 0035 — Durable notification center

## Status

Accepted for UI-27 on 2026-11-13. Migration `0033` is additive and was applied to production after an encrypted backup and restore check.

## Context

The app had transient success banners on several pages. They disappeared on navigation/reload and were not useful as a durable signal for background work. The owner wants a standard notification center for bot stops, forced position closes, long-running operations, and future integrations.

## Decision

- Add owner-scoped `notifications` with `type`, `title`, `body`, `href`, `payload`, `read_at`, and `created_at`.
- Expose `GET /notifications`, `GET /notifications/unread-count`, and `POST /notifications/read-all`.
- Show a global unread badge next to the Notifications menu item. Opening `/notifications` marks all notifications read and clears the badge.
- Create notifications when:
  - a bot is stopped manually;
  - a bot is stopped automatically because its strategy is missing or its parameters are invalid;
  - all open positions are force-closed.
- `NotificationsService.create` is an internal, reusable service for future long-running operations. Notifications are not user-created via a public endpoint.
- Remove transient green success banners from Testing, Finance, Vault, Settings, and Import. Keep inline validation/error feedback.
- Notification rows are operational records; they are not written to `audit_log` (the underlying user mutations are already audited).

## Consequences

- `0033` adds only a table and indexes; `nexter_app` receives SELECT/INSERT/UPDATE (no DELETE).
- Notifications are per owner and exposed only through authenticated endpoints.
- The unread badge polls every 30 seconds; opening the page marks all read. A future retention/cleanup policy is still needed.
- Bot stop/close notifications are best-effort: a notification insert failure does not roll back the bot mutation.
