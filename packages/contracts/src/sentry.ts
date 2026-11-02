const secretKey = /token|secret|password|cookie|authorization|api[-_]?key/i;
const secretText =
  /(?:bearer\s+[a-z0-9._-]+|api[-_]?key\s*[:=]\s*\S+|token\s*[:=]\s*\S+|password\s*[:=]\s*\S+)/i;

function redactRecord(record: Record<string, unknown> | undefined): void {
  if (!record) return;

  for (const key of Object.keys(record)) {
    if (secretKey.test(key)) {
      record[key] = '[redacted]';
      continue;
    }

    const value = record[key];
    if (typeof value === 'string' && secretText.test(value)) {
      record[key] = '[redacted]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      redactRecord(value as Record<string, unknown>);
    }
  }
}

function redactText(value: string): string {
  return secretText.test(value) ? '[redacted]' : value;
}

export function scrubSentryBreadcrumb(
  breadcrumb: Record<string, unknown>,
): Record<string, unknown> {
  if (breadcrumb.data && typeof breadcrumb.data === 'object') {
    redactRecord(breadcrumb.data as Record<string, unknown>);
  }

  if (typeof breadcrumb.message === 'string') {
    breadcrumb.message = redactText(breadcrumb.message);
  }

  return breadcrumb;
}

export function scrubSentryEvent(event: Record<string, unknown>): Record<string, unknown> {
  if (event.request && typeof event.request === 'object') {
    const request = event.request as Record<string, unknown>;
    delete request.headers;
    delete request.cookies;
    delete request.query_string;
    delete request.data;
    delete request.url;
  }

  if (event.extra && typeof event.extra === 'object') {
    redactRecord(event.extra as Record<string, unknown>);
  }

  if (event.tags && typeof event.tags === 'object') {
    redactRecord(event.tags as Record<string, unknown>);
  }

  if (event.contexts && typeof event.contexts === 'object') {
    redactRecord(event.contexts as Record<string, unknown>);
  }

  if (typeof event.message === 'string') {
    event.message = redactText(event.message);
  }

  if (event.exception && typeof event.exception === 'object') {
    const exception = event.exception as { values?: Array<Record<string, unknown>> };
    for (const value of exception.values ?? []) {
      if (typeof value.value === 'string') {
        value.value = redactText(value.value);
      }
    }
  }

  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) =>
      scrubSentryBreadcrumb(breadcrumb as Record<string, unknown>),
    );
  }

  return event;
}
