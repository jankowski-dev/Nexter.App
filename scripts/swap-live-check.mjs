#!/usr/bin/env node
/**
 * Opt-in live/fork check for Phase 7.
 *
 * Verifies the configured BSC RPC chain id and router bytecode, then optionally
 * requests a read-only KyberSwap quote. It never signs or submits a transaction
 * and never prints API keys, RPC URLs, or wallet secrets.
 *
 * Usage:
 *   BSC_RPC_URL=... KYBERSWAP_API_KEY=... node scripts/swap-live-check.mjs
 */

const rpcUrl = process.env.BSC_RPC_URL;
const apiKey = process.env.KYBERSWAP_API_KEY;
const gateway =
  process.env.KYBERSWAP_BASE_URL ??
  (apiKey ? 'https://api.kyberswap.com/swap' : 'https://aggregator-api.kyberswap.com');
const router = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';
const usdc = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const based = '0x1d28d989f9e3ccb8b15d0cec601734514f958e4d';

if (!rpcUrl) {
  console.error('BSC_RPC_URL is required');
  process.exit(1);
}

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
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

  if (chainId !== 56) {
    throw new Error(`RPC chain id is ${chainId}, expected 56`);
  }

  const code = await rpc('eth_getCode', [router, 'latest']);
  if (typeof code !== 'string' || code === '0x') {
    throw new Error('Router has no bytecode at the configured RPC');
  }

  console.log(`RPC chain id: ${chainId}`);
  console.log(`Router bytecode: ${Math.max(0, (code.length - 2) / 2)} bytes`);

  if (!apiKey) {
    console.log('KYBERSWAP_API_KEY is not set; quote probe skipped');
    return;
  }

  const params = new URLSearchParams({
    tokenIn: usdc,
    tokenOut: based,
    amountIn: '1000000000000000000',
    saveGas: '0',
    gasInclude: '1',
    isAggregator: 'true',
    slippageTolerance: '50',
  });
  const response = await fetch(`${gateway}/bsc/api/v1/routes?${params.toString()}`, {
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
