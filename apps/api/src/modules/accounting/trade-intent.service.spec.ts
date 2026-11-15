import { describe, expect, it } from 'vitest';
import { TradeIntentService } from './trade-intent.service';

describe('TradeIntentService', () => {
  const service = new TradeIntentService();

  it('keeps a provided intent id and source', () => {
    const intent = service.create({
      channel: 'manual',
      kind: 'buy',
      source: 'main-list',
      intentId: 'intent-1',
    });

    expect(intent).toEqual({
      intentId: 'intent-1',
      channel: 'manual',
      kind: 'buy',
      source: 'main-list',
    });
    expect(service.audit(intent)).toEqual({
      intentId: 'intent-1',
      channel: 'manual',
      kind: 'buy',
      tradeSource: 'main-list',
    });
  });

  it('generates an id when none is provided', () => {
    const intent = service.create({ channel: 'onchain', kind: 'swap' });
    expect(intent.intentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(intent.source).toBeNull();
  });
});
