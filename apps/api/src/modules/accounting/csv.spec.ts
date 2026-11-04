import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('keeps negative numeric values numeric', () => {
    const csv = toCsv([{ realizedPnlUsd: '-60.00000000', returnPct: '-15.00' }]);
    expect(csv).toContain('"-60.00000000"');
    expect(csv).toContain('"-15.00"');
    expect(csv).not.toContain("'-60");
  });

  it('prefixes formula-like text values', () => {
    const csv = toCsv([{ notes: '=WEBSERVICE("http://x")' }]);
    expect(csv).toContain(`"'=WEBSERVICE(""http://x"")"`);
  });

  it('prefixes cells beginning with a line feed', () => {
    const csv = toCsv([{ notes: '\n=SUM(A1:A2)' }]);
    expect(csv).toContain(`"'\n=SUM(A1:A2)"`);
  });

  it('quotes commas and quotes', () => {
    const csv = toCsv([{ note: 'a,b"c' }]);
    expect(csv).toContain('"a,b""c"');
  });
});
