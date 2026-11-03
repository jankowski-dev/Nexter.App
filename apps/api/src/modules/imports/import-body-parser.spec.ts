import { describe, expect, it } from 'vitest';
import { parseNotionImportBody } from './import-body-parser';

describe('parseNotionImportBody', () => {
  it('preserves numeric lexemes as strings', () => {
    const parsed = parseNotionImportBody(
      '{"orders":[{"amount":123456789012345678.123456789012345678}]}',
    ) as { orders: Array<{ amount: unknown }> };

    expect(parsed.orders[0]?.amount).toBe('123456789012345678.123456789012345678');
  });

  it('rejects invalid JSON', () => {
    expect(() => parseNotionImportBody('{')).toThrow();
  });
});
