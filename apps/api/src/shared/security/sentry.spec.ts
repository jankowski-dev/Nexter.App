import { describe, expect, it } from 'vitest';
import { scrubSentryBreadcrumb, scrubSentryEvent } from './sentry';

describe('Sentry scrubbing', () => {
  it('removes request secrets', () => {
    const event = scrubSentryEvent({
      type: undefined,
      request: {
        url: 'https://example.com/?token=secret',
        headers: { authorization: 'Bearer secret' },
        cookies: { session: 'secret' },
        query_string: 'token=secret',
        data: { password: 'secret' },
      },
      extra: {
        apiKey: 'secret',
        safe: 'value',
      },
      breadcrumbs: [
        {
          data: {
            url: 'https://example.com/?token=secret',
            headers: { authorization: 'Bearer secret' },
          },
        },
      ],
    });

    const serialized = JSON.stringify(event);

    expect(serialized).not.toContain('secret');
    expect(event.extra?.safe).toBe('value');
  });

  it('removes breadcrumb request data', () => {
    const breadcrumb = scrubSentryBreadcrumb({
      data: {
        url: 'https://example.com/?token=secret',
        headers: { authorization: 'Bearer secret' },
        custom: 'kept',
      },
    });

    expect(JSON.stringify(breadcrumb)).not.toContain('secret');
    expect(breadcrumb.data?.custom).toBe('kept');
  });
});
