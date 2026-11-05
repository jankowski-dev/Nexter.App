import { describe, expect, it } from 'vitest';
import {
  BSC_NATIVE_ADDRESS,
  DEFAULT_BSC_ROUTER,
  DEFAULT_ETHEREUM_ROUTER,
  SWAP_CHAINS,
  defaultExecutorForChain,
  defaultRouterForChain,
  getSwapChain,
  getSwapToken,
  isNativeToken,
  nativeTokenForChain,
  parseAddressList,
} from './token-registry';

describe('swap token registry', () => {
  it('exposes the verified BSC and Ethereum allowlists', () => {
    expect(SWAP_CHAINS.map((chain) => chain.code)).toEqual(['bsc', 'ethereum']);
    expect(getSwapChain('bsc')?.chainId).toBe(56);
    expect(getSwapChain('ethereum')?.chainId).toBe(1);
    expect(getSwapChain('bsc')?.tokens.map((token) => token.symbol)).toEqual([
      'USDC',
      'XNY',
      'BASED',
      'APR',
      'POP',
      'LINK',
      'BNB',
    ]);
    expect(getSwapChain('ethereum')?.tokens.map((token) => token.symbol)).toEqual([
      'USDC',
      'LINK',
      'BASED',
      'APR',
      'ETH',
    ]);
    expect(getSwapToken('ethereum', '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')?.decimals).toBe(
      6,
    );
    expect(nativeTokenForChain('bsc').symbol).toBe('BNB');
    expect(nativeTokenForChain('ethereum').symbol).toBe('ETH');
  });

  it('resolves addresses case-insensitively and rejects unknown tokens', () => {
    expect(getSwapToken('bsc', '0x8AC76A51CC950D9822D68B83FE1AD97B32CD580D')?.symbol).toBe('USDC');
    expect(getSwapToken('bsc', '0x2222222222222222222222222222222222222222')).toBeNull();
    expect(getSwapToken('ethereum', '0x514910771af9ca656af840dff83e8264ecf986ca')?.symbol).toBe(
      'LINK',
    );
    expect(getSwapChain('solana')).toBeNull();
  });

  it('recognizes the native sentinel', () => {
    expect(isNativeToken(BSC_NATIVE_ADDRESS)).toBe(true);
    expect(isNativeToken(BSC_NATIVE_ADDRESS.toLowerCase())).toBe(true);
    expect(isNativeToken('0x2222222222222222222222222222222222222222')).toBe(false);
  });

  it('parses address lists and exposes chain-specific defaults', () => {
    expect(parseAddressList(' 0xAAA, 0xBBB , ')).toEqual(['0xaaa', '0xbbb']);
    expect(parseAddressList(undefined)).toEqual([]);
    expect(DEFAULT_BSC_ROUTER).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(DEFAULT_ETHEREUM_ROUTER).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(defaultRouterForChain('ethereum')).toBe(DEFAULT_ETHEREUM_ROUTER);
    expect(defaultExecutorForChain('ethereum')).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
