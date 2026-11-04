import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { parseTrustProxy } from './trust-proxy';

describe('parseTrustProxy', () => {
  it('converts documented values', () => {
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(typeof parseTrustProxy('1')).toBe('function');
    expect(parseTrustProxy('127.0.0.1/8')).toBe('127.0.0.1/8');
  });

  it('uses the Railway-appended client IP with one trusted hop', async () => {
    const app = Fastify({ trustProxy: parseTrustProxy('1') });
    app.get('/ip', (request) => ({ ip: request.ip }));

    const spoofed = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': '8.8.8.8, 203.0.113.7' },
    });
    expect(spoofed.json()).toEqual({ ip: '203.0.113.7' });

    const direct = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(direct.json()).toEqual({ ip: '203.0.113.7' });

    await app.close();
  });

  it('ignores forwarding headers when trust proxy is disabled', async () => {
    const app = Fastify({ trustProxy: parseTrustProxy('false') });
    app.get('/ip', (request) => ({ ip: request.ip }));

    const response = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(response.json()).toEqual({ ip: '10.0.0.1' });

    await app.close();
  });
});
