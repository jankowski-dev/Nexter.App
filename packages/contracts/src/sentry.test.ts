import { describe, expect, it } from 'vitest';
import { scrubSentryBreadcrumb, scrubSentryEvent } from './sentry';

describe('Sentry scrubbing', () => {
  it('removes request, extra, tag, context, and exception secrets', () => {
    const event = scrubSentryEvent({
      request: {
        url: 'https://example.com/?token=secret',
        headers: { authorization: 'Bearer secret' },
        cookies: { session: 'secret' },
        query_string: 'token=secret',
        data: { password: 'secret' },
      },
      extra: { apiKey: 'secret', safe: 'value', list: [{ token: 'secret' }] },
      tags: { token: 'secret', environment: 'test' },
      contexts: { runtime: { name: 'node', password: 'secret' } },
      user: { email: 'user@example.com', token: 'secret' },
      message: 'request failed with token=secret',
      exception: { values: [{ value: 'Authorization: Bearer secret' }] },
      breadcrumbs: [
        {
          message: 'token=secret',
          data: {
            url: 'https://example.com/?token=secret',
            headers: { authorization: 'Bearer secret' },
            custom: 'kept',
          },
        },
      ],
    });

    const serialized = JSON.stringify(event);

    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('user@example.com');
    expect((event.extra as Record<string, unknown>).safe).toBe('value');
    expect((event.tags as Record<string, unknown>).environment).toBe('test');
  });

  it('removes breadcrumb request data', () => {
    const breadcrumb = scrubSentryBreadcrumb({
      data: {
        url: 'https://example.com/?token=secret',
        headers: { authorization: 'Bearer secret' },
        custom: 'kept',
      },
      message: 'api-key=secret',
    });

    expect(JSON.stringify(breadcrumb)).not.toContain('secret');
    expect((breadcrumb.data as Record<string, unknown>).custom).toBe('kept');
    expect(breadcrumb.message).toBe('[redacted]');
  });
});
