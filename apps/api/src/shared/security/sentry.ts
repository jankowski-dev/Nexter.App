import type { Breadcrumb, Event } from '@sentry/node';

export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.data) {
    delete breadcrumb.data.url;
    delete breadcrumb.data.headers;
    delete breadcrumb.data.query;
    delete breadcrumb.data.query_string;
    delete breadcrumb.data.body;
  }

  return breadcrumb;
}

export function scrubSentryEvent(event: Event): Event {
  if (event.request) {
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.query_string;
    delete event.request.data;
    delete event.request.url;
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubSentryBreadcrumb);
  }

  if (event.extra) {
    for (const key of Object.keys(event.extra)) {
      if (/token|secret|password|cookie|authorization|key/i.test(key)) {
        event.extra[key] = '[redacted]';
      }
    }
  }

  return event;
}
