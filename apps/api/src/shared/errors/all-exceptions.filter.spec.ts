import { NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter';

function harness(url: string) {
  const reply = {
    header: vi.fn(),
    status: vi.fn(),
    send: vi.fn(),
  };
  reply.header.mockReturnValue(reply);
  reply.status.mockReturnValue(reply);

  const request = { url, id: 'req-test' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { reply, host };
}

describe('AllExceptionsFilter cache headers', () => {
  it('marks API error responses as no-store, including the icon proxy', () => {
    const { reply, host } = harness('/api/v1/watchlist/icon?url=https%3A%2F%2Fexample.com');

    new AllExceptionsFilter().catch(
      new NotFoundException({ code: 'NOT_FOUND', message: 'Icon not found' }),
      host,
    );

    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledTimes(1);
  });

  it('leaves the SPA fallback alone', () => {
    const { reply, host } = harness('/portfolio');

    new AllExceptionsFilter().catch(
      new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' }),
      host,
    );

    expect(reply.header).not.toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
