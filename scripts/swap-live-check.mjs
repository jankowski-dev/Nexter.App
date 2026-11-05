#!/usr/bin/env node
/**
 * Opt-in live/fork check for Phase 9.
 *
 * Verifies the configured EVM RPC chain id and router bytecode, then optionally
 * requests a read-only KyberSwap quote. It never signs or submits a transaction
 * and never prints API keys, RPC URLs, or wallet secrets.
 *
 * Usage:
 *   BSC_RPC_URL=... node scripts/swap-live-check.mjs bsc
 *   ETHEREUM_RPC_URL=... KYBERSWAP_API_KEY=... node scripts/swap-live-check.mjs ethereum
 */

const chain = process.argv[2] ?? process.env.SWAP_LIVE_CHECK_CHAIN ?? 'bsc';
const chains = {
  bsc: {
    rpcUrl: process.env.BSC_RPC_URL,
    chainId: 56,
    tokenIn: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
    tokenOut: '0x1d28d989f9e3ccb8b15d0cec601734514f958e4d',
    amountIn: '1000000000000000000',
  },
  ethereum: {
    rpcUrl: process.env.ETHEREUM_RPC_URL,
    chainId: 1,
    tokenIn: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    tokenOut: '0x514910771af9ca656af840dff83e8264ecf986ca',
    amountIn: '1000000',
  },
};

const selected = chains[chain];

if (!selected) {
  console.error(`Unsupported chain: ${chain}`);
  process.exit(1);
}

const apiKey = process.env.KYBERSWAP_API_KEY;
const gateway =
  process.env.KYBERSWAP_BASE_URL ??
  (apiKey ? 'https://api.kyberswap.com/swap' : 'https://aggregator-api.kyberswap.com');
const router = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';

if (!selected.rpcUrl) {
  console.error(`${chain === 'ethereum' ? 'ETHEREUM_RPC_URL' : 'BSC_RPC_URL'} is required`);
  process.exit(1);
}

async function rpc(method, params) {
  const response = await fetch(selected.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });

  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(`${method} failed: ${body.error?.message ?? response.status}`);
  }

  return body.result;
}

async function main() {
  const chainId = Number.parseInt(await rpc('eth_chainId', []), 16);

  if (chainId !== selected.chainId) {
    throw new Error(`RPC chain id is ${chainId}, expected ${selected.chainId}`);
  }

  const code = await rpc('eth_getCode', [router, 'latest']);
  if (typeof code !== 'string' || code === '0x') {
    throw new Error('Router has no bytecode at the configured RPC');
  }

  console.log(`Chain: ${chain} (${chainId})`);
  console.log(`Router bytecode: ${Math.max(0, (code.length - 2) / 2)} bytes`);

  if (!apiKey) {
    console.log('KYBERSWAP_API_KEY is not set; quote probe skipped');
    return;
  }

  const params = new URLSearchParams({
    tokenIn: selected.tokenIn,
    tokenOut: selected.tokenOut,
    amountIn: selected.amountIn,
    saveGas: '0',
    gasInclude: '1',
    isAggregator: 'true',
    slippageTolerance: '50',
  });
  const response = await fetch(`${gateway}/${chain}/api/v1/routes?${params.toString()}`, {
    headers: { Accept: 'application/json', 'X-Api-Key': apiKey, 'X-Client-Id': 'nexter' },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();

  if (!response.ok || body.code !== 0 || !body.data?.routeSummary) {
    throw new Error(`Kyber quote failed with HTTP ${response.status}`);
  }

  console.log(
    JSON.stringify(
      {
        quote: {
          amountIn: body.data.routeSummary.amountIn,
          amountOut: body.data.routeSummary.amountOut,
          amountOutUsd: body.data.routeSummary.amountOutUsd,
          gasUsd: body.data.routeSummary.gasUsd,
          priceImpact: body.data.routeSummary.priceImpact,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Swap live check failed');
  process.exitCode = 1;
});
