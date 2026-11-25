import { describe, expect, it } from 'vitest';
import {
  sandboxReplayChartActionSchema,
  sandboxReplayChartResponseSchema,
  sandboxReplayDecisionsQuerySchema,
  sandboxReplayReportIdentitySchema,
  sandboxTokenCandidateSchema,
} from './index';

describe('sandbox visual contracts', () => {
  it('parses a replay chart with candles and actions', () => {
    const parsed = sandboxReplayChartResponseSchema.parse({
      replayId: '00000000-0000-4000-8000-000000000001',
      tokens: [
        {
          tokenId: 'bsc:0x1111111111111111111111111111111111111111',
          candles: [
            {
              time: 1_760_000_000_000,
              openUsd: '1.00',
              highUsd: '1.10',
              lowUsd: '0.90',
              closeUsd: '1.05',
            },
          ],
        },
      ],
      actions: [
        {
          id: 'intent-1',
          tokenId: 'bsc:0x1111111111111111111111111111111111111111',
          time: 1_760_000_000_000,
          kind: 'buy',
          priceUsd: '1.05',
          amountUsd: '100.00',
          pnlUsd: null,
          reasonCode: 'FILL_FILLED',
          reasonText: 'filled',
          intentId: 'intent-1',
          tradeId: 'trade-1',
        },
      ],
      note: 'evaluation window only',
    });

    expect(parsed.actions[0]?.kind).toBe('buy');
    expect(parsed.tokens[0]?.candles).toHaveLength(1);
  });

  it('rejects an unknown action kind', () => {
    const result = sandboxReplayChartActionSchema.safeParse({
      id: 'x',
      tokenId: 'bsc:0x1111111111111111111111111111111111111111',
      time: 1,
      kind: 'hold',
      priceUsd: null,
      amountUsd: '0',
      pnlUsd: null,
      reasonCode: 'X',
      reasonText: 'x',
      intentId: null,
      tradeId: null,
    });
    expect(result.success).toBe(false);
  });

  it('defaults decision pagination and clamps it', () => {
    expect(sandboxReplayDecisionsQuerySchema.parse({})).toEqual({ limit: 100, offset: 0 });
    expect(sandboxReplayDecisionsQuerySchema.parse({ limit: '20' }).limit).toBe(20);
    expect(sandboxReplayDecisionsQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
  });

  it('validates report identity and token candidates', () => {
    expect(
      sandboxReplayReportIdentitySchema.parse({
        reportHash: 'a'.repeat(64),
        eventHash: 'b'.repeat(64),
        eventCount: 10,
        dataSnapshotId: 'c'.repeat(64),
        candleSnapshotHash: 'c'.repeat(64),
        configVersion: 'v1',
        settingsVersion: 's1',
        seed: 7,
      }).seed,
    ).toBe(7);

    expect(
      sandboxTokenCandidateSchema.parse({
        assetId: '00000000-0000-4000-8000-000000000001',
        tokenKey: 'bsc:0x1111111111111111111111111111111111111111',
        symbol: 'CAKE',
        name: 'PancakeSwap',
        chain: 'bsc',
        contractAddress: '0x1111111111111111111111111111111111111111',
        eligible: true,
        reason: null,
      }).eligible,
    ).toBe(true);
  });
});
