import type { Breadcrumb, Event } from '@sentry/node';
import {
  scrubSentryBreadcrumb as scrubBreadcrumb,
  scrubSentryEvent as scrubEvent,
} from '@nexter/contracts';

export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return scrubBreadcrumb(breadcrumb as unknown as Record<string, unknown>) as unknown as Breadcrumb;
}

export function scrubSentryEvent(event: Event): Event {
  return scrubEvent(event as unknown as Record<string, unknown>) as unknown as Event;
}
