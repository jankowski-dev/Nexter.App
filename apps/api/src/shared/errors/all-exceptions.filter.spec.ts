import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
  type ArgumentsHost,
} from '@nestjs/common';
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

  it('preserves static-limit contract codes on 400 responses', () => {
    for (const code of ['BOT_STATIC_LIMIT_SINGLE_TOKEN', 'BOT_STATIC_LIMIT_PRICES']) {
      const { reply, host } = harness('/api/v1/trading-bots/bots');
      new AllExceptionsFilter().catch(new BadRequestException({ code, message: code }), host);
      const payload = reply.send.mock.calls[0]?.[0] as { error?: { code?: string } };
      expect(payload.error?.code).toBe(code);
    }
  });

  it('preserves sandbox replay contract codes on 400/404/409 responses', () => {
    const cases: Array<{
      exception: HttpException;
      status: number;
      code: string;
    }> = [
      {
        exception: new BadRequestException({
          code: 'SANDBOX_REPLAY_TOKEN_NOT_FOUND',
          message: 'Unknown replay token',
        }),
        status: 400,
        code: 'SANDBOX_REPLAY_TOKEN_NOT_FOUND',
      },
      {
        exception: new NotFoundException({
          code: 'SANDBOX_REPLAY_NOT_FOUND',
          message: 'Replay not found',
        }),
        status: 404,
        code: 'SANDBOX_REPLAY_NOT_FOUND',
      },
      ...[
        'SANDBOX_REPLAY_INVALID_STATUS',
        'SANDBOX_REPLAY_COVERAGE_MISSING',
        'SANDBOX_REPLAY_WINDOW_TOO_SHORT',
        'SANDBOX_REPLAY_CAPITAL_INVALID',
        'SANDBOX_REPLAY_STATE_INVALID',
        'SANDBOX_REPLAY_NOT_COMPLETED',
      ].map((code) => ({
        exception: new ConflictException({ code, message: code }),
        status: 409,
        code,
      })),
    ];

    for (const { exception, status, code } of cases) {
      const { reply, host } = harness('/api/v1/sandbox/replays');
      new AllExceptionsFilter().catch(exception, host);
      expect(reply.status).toHaveBeenCalledWith(status);
      const payload = reply.send.mock.calls[0]?.[0] as { error?: { code?: string } };
      expect(payload.error?.code).toBe(code);
    }
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
