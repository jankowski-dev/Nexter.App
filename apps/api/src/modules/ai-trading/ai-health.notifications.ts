import type { AiBotHealthLevel } from '@nexter/contracts';

/**
 * Minimum time between reminders for the same AI bot health problem.
 * New reason codes bypass this window because they describe a new problem.
 */
export const AI_HEALTH_NOTIFICATION_COOLDOWN_MS = 6 * 60 * 60_000;

export interface AiHealthNotificationState {
  level: AiBotHealthLevel;
  reasonCodes: string[];
  createdAt: Date;
}

export interface AiHealthNotificationDecision {
  kind: 'stop' | 'review' | 'recovered' | null;
  signature: string;
  reasonCodes: string[];
  newReasonCodes: string[];
  cooldownActive: boolean;
}

export interface AiHealthNotificationInput {
  level: AiBotHealthLevel;
  reasons: ReadonlyArray<{ code: string }>;
  latest: AiHealthNotificationState | null;
  recent: ReadonlyArray<AiHealthNotificationState>;
  now: Date;
  cooldownMs?: number;
}

function readReasonCodes(payload: Record<string, unknown>): string[] {
  if (payload.level === 'ok') return [];
  if (Array.isArray(payload.reasons)) {
    return [
      ...new Set(
        payload.reasons.filter(
          (code: unknown): code is string => typeof code === 'string' && code.length > 0,
        ),
      ),
    ];
  }
  if (typeof payload.signature === 'string') {
    return [...new Set(payload.signature.split(',').filter((code) => code.length > 0))];
  }
  return [];
}

export function toAiHealthNotificationState(
  payload: Record<string, unknown> | null | undefined,
  createdAt: Date,
): AiHealthNotificationState | null {
  if (!payload) return null;
  if (payload.level !== 'ok' && payload.level !== 'review' && payload.level !== 'stop') {
    return null;
  }
  if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) return null;
  return {
    level: payload.level,
    reasonCodes: readReasonCodes(payload),
    createdAt,
  };
}

/**
 * Decides whether the current health evaluation should produce a notification.
 *
 * The previous notification is the source of truth, so suppressed checks do not
 * reset the cooldown. Recovery is only reported for a previously notified stop
 * and never while that stop is still inside the cooldown window.
 */
export function decideAiHealthNotification(
  input: AiHealthNotificationInput,
): AiHealthNotificationDecision {
  const cooldownMs = input.cooldownMs ?? AI_HEALTH_NOTIFICATION_COOLDOWN_MS;
  const nowMs = input.now.getTime();
  const reasonCodes = [...new Set(input.reasons.map((reason) => reason.code))].sort();
  const signature = reasonCodes.join(',');
  const latest = input.latest;
  const cooldownActive = latest !== null && nowMs - latest.createdAt.getTime() < cooldownMs;

  if (input.level === 'ok') {
    const shouldRecover = latest?.level === 'stop' && !cooldownActive;
    return {
      kind: shouldRecover ? 'recovered' : null,
      signature,
      reasonCodes: [],
      newReasonCodes: [],
      cooldownActive,
    };
  }

  if (!latest) {
    return {
      kind: input.level,
      signature,
      reasonCodes,
      newReasonCodes: reasonCodes,
      cooldownActive: false,
    };
  }

  const notifiedWithinCooldown = new Set<string>();
  for (const entry of input.recent) {
    if (nowMs - entry.createdAt.getTime() >= cooldownMs) continue;
    for (const code of entry.reasonCodes) notifiedWithinCooldown.add(code);
  }
  const newReasonCodes = reasonCodes.filter((code) => !notifiedWithinCooldown.has(code));

  const escalated = input.level === 'stop' && latest.level === 'review';
  if (latest.level === 'ok' || newReasonCodes.length > 0 || escalated || !cooldownActive) {
    return {
      kind: input.level,
      signature,
      reasonCodes,
      newReasonCodes,
      cooldownActive,
    };
  }

  return {
    kind: null,
    signature,
    reasonCodes,
    newReasonCodes,
    cooldownActive,
  };
}
