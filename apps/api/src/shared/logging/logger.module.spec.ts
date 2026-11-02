import { describe, expect, it } from 'vitest';
import { requestSerializer } from './logger.module';

describe('requestSerializer', () => {
  it('does not log secret headers or query strings', () => {
    const serialized = requestSerializer({
      id: 'req-1',
      method: 'POST',
      url: '/api/v1/login?token=super-secret',
      remoteAddress: '127.0.0.1',
      headers: {
        'x-api-key': 'super-secret',
        authorization: 'Bearer super-secret',
        cookie: 'session=super-secret',
        'user-agent': 'vitest',
      },
    });

    const value = JSON.stringify(serialized);

    expect(value).not.toContain('super-secret');
    expect(value).not.toContain('authorization');
    expect(value).not.toContain('cookie');
    expect(serialized).toMatchObject({
      id: 'req-1',
      method: 'POST',
      url: '/api/v1/login',
      remoteAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
  });
});
