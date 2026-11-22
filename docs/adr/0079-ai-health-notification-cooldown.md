# ADR 0079 — AI bot health notification cooldown and transition policy

Status: accepted, 2026-11-22.

## Context

The AI health monitor runs every five minutes. Its notification decision compared only the latest `ai_bot_health` payload signature with the current reason set, and it emitted a recovery notification for any previous non-`ok` level. A transiently missing or stale quote therefore produced a `QUOTE_STALE` stop, then a recovery when the quote refreshes, then another stop roughly every 15–20 minutes for the same bot. The owner receives a stream of duplicate stop/restored notifications and cannot distinguish it from a new problem.

The `notifications` table already stores owner, type, creation time and a JSON payload with `botId`, `level`, `signature` and reason codes. No new state or schema is required to make the decision transition-based.

## Decision

Implement the notification policy in `ai-health.notifications.ts` and use existing `ai_bot_health` rows as the state:

- Cooldown: `AI_HEALTH_NOTIFICATION_COOLDOWN_MS = 6 hours` (named constant, no migration).
- Load the owner's latest `ai_bot_health` notification for the bot and every such notification inside the cooldown window.
- Reason history is the union of reason codes reported inside the window, so an `A → B → A` flap does not count as a new problem the second time.
- Notify when:
  - the bot has no prior health notification (first stop/review);
  - a reason code was not reported in the cooldown window (new problem, even inside the cooldown);
  - the level escalates from `review` to `stop`;
  - the latest notification is older than the cooldown (reminder for a persistent problem).
- Suppress repeats of the same reason inside the cooldown and downgrades from `stop` to `review`.
- Recovery is sent only when the latest notification was a **stop** and that stop is outside the cooldown. No recovery is sent when no stop was notified, when the previous notification was only `review`, or while the cooldown is active.
- One notification per bot evaluation, with all current reasons grouped into one body. The payload adds `newReasons` for diagnostics but keeps the existing `botId`/`level`/`signature`/`reasons` shape.
- The health endpoint and monitor remain read-only and advisory; suppressed notifications never change or hide the current health displayed on the AI page.

## Consequences

- Positive: stop/recovery flaps caused by transient quotes are reduced to one notification per six hours while the condition persists.
- Positive: new reason codes and `review → stop` escalations still surface immediately.
- Positive: no schema change, no new service state, and the owner still sees the live health evaluation on the AI page.
- Neutral: a recovery after a stop can be delayed until the cooldown expires; this is intentional to avoid oscillation noise.
- Negative: a review-only condition does not produce a recovery notification. This is deliberate; recovery notifications are reserved for previously notified stop-level problems.
- Rollback: revert the service/helper change and deploy the previous API build. Existing notifications remain valid because the payload shape is unchanged.
