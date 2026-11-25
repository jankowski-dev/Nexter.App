import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(...candidates: string[]): string {
  for (const candidate of candidates) {
    for (const base of [process.cwd(), resolve(process.cwd(), '../..')]) {
      try {
        return readFileSync(resolve(base, candidate), 'utf8');
      } catch {
        // Try the next location; the suite can run from the repo root or the package.
      }
    }
  }
  throw new Error(`${candidates.join(' or ')} was not found`);
}

const provisioningSource = readRepoFile('packages/db/scripts/provision-app-role.mjs');

describe('app-role provisioning keeps the new tables immutable', () => {
  it('revokes DELETE on the Viber outbox and hourly equity points', () => {
    expect(provisioningSource).toMatch(/revoke delete on[^;]*\bviber_notifications\b/);
    expect(provisioningSource).toMatch(/revoke delete on[^;]*\bportfolio_equity_points\b/);
  });

  it('verifies that the application role cannot DELETE either new table', () => {
    expect(provisioningSource).toContain("'viber_notifications',");
    expect(provisioningSource).toContain("'portfolio_equity_points',");
  });
});
