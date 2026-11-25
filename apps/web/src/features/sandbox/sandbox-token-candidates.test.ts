import { describe, expect, it } from 'vitest';
import type { SandboxTokenCandidate } from '@nexter/contracts';
import {
  eligibleSandboxCandidates,
  sandboxTokenCandidatePayload,
} from './sandbox-token-candidates';

function candidate(overrides: Partial<SandboxTokenCandidate> = {}): SandboxTokenCandidate {
  return {
    assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tokenKey: 'bsc:0x1111111111111111111111111111111111111111',
    symbol: 'CAKE',
    name: 'PancakeSwap',
    chain: 'bsc',
    contractAddress: '0x1111111111111111111111111111111111111111',
    eligible: true,
    reason: null,
    ...overrides,
  };
}

describe('sandbox token candidates', () => {
  it('keeps only selectable favorites', () => {
    const list = [
      candidate(),
      candidate({ tokenKey: 'tron:0x2', symbol: 'TRX', eligible: false, reason: 'no chain' }),
    ];
    expect(eligibleSandboxCandidates(list).map((item) => item.symbol)).toEqual(['CAKE']);
  });

  it('builds a create payload from the candidate without free-form fields', () => {
    expect(sandboxTokenCandidatePayload(candidate())).toEqual({
      tokenKey: 'bsc:0x1111111111111111111111111111111111111111',
      symbol: 'CAKE',
      name: 'PancakeSwap',
      contractAddress: '0x1111111111111111111111111111111111111111',
    });
  });

  it('refuses an ineligible candidate even if the UI was bypassed', () => {
    expect(() =>
      sandboxTokenCandidatePayload(
        candidate({ eligible: false, reason: 'Укажите контракт токена.' }),
      ),
    ).toThrow('Укажите контракт токена.');
  });
});
