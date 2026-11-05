import { env } from '../../shared/config/env';
import { defaultExecutorForChain, defaultRouterForChain, parseAddressList } from './token-registry';

function configuredForChain(
  chain: string,
  bscValue: string | undefined,
  ethereumValue: string | undefined,
): string[] {
  if (chain === 'bsc') return parseAddressList(bscValue);
  if (chain === 'ethereum') return parseAddressList(ethereumValue);

  throw new Error(`Unknown swap chain: ${chain}`);
}

export function routerAllowlist(chain: string): string[] {
  const specific = configuredForChain(
    chain,
    env.SWAP_BSC_ROUTER_ALLOWLIST,
    env.SWAP_ETHEREUM_ROUTER_ALLOWLIST,
  );

  if (specific.length > 0) return specific;

  // Legacy global list is BSC-only; never reuse a BSC trust decision on Ethereum.
  if (chain === 'bsc') {
    const legacy = parseAddressList(env.SWAP_ROUTER_ALLOWLIST);
    if (legacy.length > 0) return legacy;
  }

  return [defaultRouterForChain(chain).toLowerCase()];
}

export function executorAllowlist(chain: string): string[] {
  const specific = configuredForChain(
    chain,
    env.SWAP_BSC_EXECUTOR_ALLOWLIST,
    env.SWAP_ETHEREUM_EXECUTOR_ALLOWLIST,
  );

  if (specific.length > 0) return specific;

  if (chain === 'bsc') {
    const legacy = parseAddressList(env.SWAP_EXECUTOR_ALLOWLIST);
    if (legacy.length > 0) return legacy;
  }

  return [defaultExecutorForChain(chain).toLowerCase()];
}

export function selectorAllowlist(): string[] {
  return (env.SWAP_SELECTOR_ALLOWLIST ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}
