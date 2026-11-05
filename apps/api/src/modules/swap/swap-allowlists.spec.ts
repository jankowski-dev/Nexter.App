import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../../shared/config/env';
import { executorAllowlist, routerAllowlist } from './swap-allowlists';
import { defaultExecutorForChain, defaultRouterForChain } from './token-registry';

const legacyRouter = `0x${'a'.repeat(40)}`;
const legacyExecutor = `0x${'b'.repeat(40)}`;
const ethereumRouter = `0x${'c'.repeat(40)}`;
const ethereumExecutor = `0x${'d'.repeat(40)}`;

afterEach(() => {
  env.SWAP_ROUTER_ALLOWLIST = undefined;
  env.SWAP_EXECUTOR_ALLOWLIST = undefined;
  env.SWAP_BSC_ROUTER_ALLOWLIST = undefined;
  env.SWAP_ETHEREUM_ROUTER_ALLOWLIST = undefined;
  env.SWAP_BSC_EXECUTOR_ALLOWLIST = undefined;
  env.SWAP_ETHEREUM_EXECUTOR_ALLOWLIST = undefined;
});

describe('swap allowlists', () => {
  it('never reuses the legacy BSC list on Ethereum', () => {
    env.SWAP_ROUTER_ALLOWLIST = legacyRouter;
    env.SWAP_EXECUTOR_ALLOWLIST = legacyExecutor;

    expect(routerAllowlist('bsc')).toEqual([legacyRouter]);
    expect(executorAllowlist('bsc')).toEqual([legacyExecutor]);
    expect(routerAllowlist('ethereum')).toEqual([defaultRouterForChain('ethereum').toLowerCase()]);
    expect(executorAllowlist('ethereum')).toEqual([
      defaultExecutorForChain('ethereum').toLowerCase(),
    ]);
  });

  it('uses per-chain overrides and falls back to chain defaults', () => {
    env.SWAP_ETHEREUM_ROUTER_ALLOWLIST = ethereumRouter;
    env.SWAP_ETHEREUM_EXECUTOR_ALLOWLIST = ethereumExecutor;

    expect(routerAllowlist('ethereum')).toEqual([ethereumRouter]);
    expect(executorAllowlist('ethereum')).toEqual([ethereumExecutor]);
    expect(routerAllowlist('bsc')).toEqual([defaultRouterForChain('bsc').toLowerCase()]);
    expect(executorAllowlist('bsc')).toEqual([defaultExecutorForChain('bsc').toLowerCase()]);
  });

  it('fails closed for unknown chains even with BSC lists configured', () => {
    env.SWAP_BSC_ROUTER_ALLOWLIST = legacyRouter;
    env.SWAP_BSC_EXECUTOR_ALLOWLIST = legacyExecutor;

    expect(() => routerAllowlist('solana')).toThrow('Unknown swap chain');
    expect(() => executorAllowlist('solana')).toThrow('Unknown swap chain');
  });
});
