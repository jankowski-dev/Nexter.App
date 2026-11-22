import { HttpException, HttpStatus } from '@nestjs/common';
import type { AiCycleRequest } from '@nexter/contracts';
import type { Database } from '@nexter/db';
import { describe, expect, it, vi } from 'vitest';
import { AiCycleService } from './ai-cycle.service';

const userId = '11111111-1111-4111-8111-111111111111';
const assetId = '22222222-2222-4222-8222-222222222222';

function serviceWithDailyCount(count: number) {
  const select = vi
    .fn()
    .mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    })
    .mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ count }]),
      })),
    });

  return new AiCycleService(
    { select } as unknown as Database,
    {
      getProfile: vi.fn().mockResolvedValue({
        id: '33333333-3333-4333-8333-333333333333',
        modelSettings: { cycleLimit: { perDay: 1, unlimited: false } },
      }),
      listTokens: vi.fn().mockResolvedValue([
        {
          enabled: true,
          asset: { id: assetId },
          timeframes: ['1h'],
        },
      ]),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { log: vi.fn() } as never,
  );
}

const request: AiCycleRequest = {
  assetId,
  timeframe: '1h',
  horizonDays: 5,
  variants: 100,
  maxDrafts: 0,
  execution: 'next-open',
};

describe('AiCycleService cycle limit', () => {
  it('returns 429 AI_CYCLE_LIMIT when the finite daily limit is reached', async () => {
    const service = serviceWithDailyCount(1);

    await expect(service.start(userId, request, {})).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(exception.getResponse()).toMatchObject({
        code: 'AI_CYCLE_LIMIT',
        message: expect.stringContaining('1 за 24 часа'),
      });
      return true;
    });
  });
});
