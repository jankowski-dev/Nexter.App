import type { SwapChainCode, SwapChainConfig, SwapToken } from '@nexter/contracts';

export const NATIVE_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
export const BSC_NATIVE_ADDRESS = NATIVE_ADDRESS;

const BSC_TOKENS: SwapToken[] = [
  {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    address: '0x55d398326f99059ff775485246999027b3197955',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'XNY',
    name: 'XNY',
    address: '0xe3225e11cab122f1a126a28997788e5230838ab9',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'BASED',
    name: 'BASED',
    address: '0x1d28d989f9e3ccb8b15d0cec601734514f958e4d',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'APR',
    name: 'APR',
    address: '0x299ad4299da5b2b93fba4c96967b040c7f611099',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'POP',
    name: 'POP',
    address: '0xa3cfb853339b77f385b994799b015cb04b208fe6',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'AKE',
    name: 'AKEDO',
    address: '0x2c3a8ee94ddd97244a93bc48298f97d2c412f7db',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'CLO',
    name: 'Clovis',
    address: '0x81d3a238b02827f62b9f390f947d36d4a5bf89d2',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'CYBER',
    name: 'Cyber',
    address: '0x14778860e937f509e651192a90589de711fb88a9',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'CYC',
    name: 'Cycle Network',
    address: '0x5845684b49aef79a5c0f887f50401c247dca7ac6',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'GWEI',
    name: 'ETHGas',
    address: '0x30117e4bc17d7b044194b76a38365c53b72f7d49',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'HOME',
    name: 'Defi App',
    address: '0x4bfaa776991e85e5f8b1255461cbbd216cfc714f',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'IRYS',
    name: 'Irys',
    address: '0x91152b4ef635403efbae860edd0f8c321d7c035d',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'ON',
    name: 'Orochi Network',
    address: '0x0e4f6209ed984b21edea43ace6e09559ed051d48',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'Q',
    name: 'Quack AI',
    address: '0xc07e1300dc138601fa6b0b59f8d0fa477e690589',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'SAHARA',
    name: 'Sahara AI',
    address: '0xfdffb411c4a70aa7c95d5c981a6fb4da867e1111',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'WARD',
    name: 'Warden Protocol',
    address: '0x6dc200b21894af4660b549b678ea8df22bf7cfac',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'LINK',
    name: 'ChainLink Token',
    address: '0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'BNB',
    name: 'BNB',
    address: NATIVE_ADDRESS,
    decimals: 18,
    native: true,
  },
];

const ETHEREUM_TOKENS: SwapToken[] = [
  {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    decimals: 6,
    native: false,
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    decimals: 6,
    native: false,
  },
  {
    symbol: 'LINK',
    name: 'ChainLink Token',
    address: '0x514910771af9ca656af840dff83e8264ecf986ca',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'BASED',
    name: 'BASED',
    address: '0x4f2b33840227ddd0e28da8d4185d6fa07adfed87',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'APR',
    name: 'APR',
    address: '0x5a9610919f5e81183823a2be4bd1beb2b4da2a20',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'ETH',
    name: 'Ether',
    address: NATIVE_ADDRESS,
    decimals: 18,
    native: true,
  },
];

export const SWAP_CHAINS: SwapChainConfig[] = [
  {
    code: 'bsc',
    chainId: 56,
    name: 'BNB Smart Chain',
    tokens: BSC_TOKENS,
    rpcConfigured: false,
    executionEnabled: false,
  },
  {
    code: 'ethereum',
    chainId: 1,
    name: 'Ethereum',
    tokens: ETHEREUM_TOKENS,
    rpcConfigured: false,
    executionEnabled: false,
  },
];

// KyberSwap uses the same deterministic router/executor addresses on BSC and Ethereum.
export const DEFAULT_BSC_ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';
export const DEFAULT_BSC_EXECUTOR = '0x8F10B468b06c6FD214B65F87778827F7D113f996';
export const DEFAULT_ETHEREUM_ROUTER = DEFAULT_BSC_ROUTER;
export const DEFAULT_ETHEREUM_EXECUTOR = DEFAULT_BSC_EXECUTOR;

export const DEFAULT_ROUTERS: Record<SwapChainCode, string> = {
  bsc: DEFAULT_BSC_ROUTER,
  ethereum: DEFAULT_ETHEREUM_ROUTER,
};

export const DEFAULT_EXECUTORS: Record<SwapChainCode, string> = {
  bsc: DEFAULT_BSC_EXECUTOR,
  ethereum: DEFAULT_ETHEREUM_EXECUTOR,
};

export function getSwapChain(code: string): SwapChainConfig | null {
  return SWAP_CHAINS.find((chain) => chain.code === code) ?? null;
}

export function getSwapToken(chainCode: string, address: string): SwapToken | null {
  const chain = getSwapChain(chainCode);
  if (!chain) return null;

  const normalized = address.toLowerCase();
  return chain.tokens.find((token) => token.address.toLowerCase() === normalized) ?? null;
}

export function isNativeToken(address: string): boolean {
  return address.toLowerCase() === NATIVE_ADDRESS.toLowerCase();
}

export function isCashEquivalentSymbol(symbol: string): boolean {
  return ['USDC', 'USDT', 'BUSD', 'FDUSD'].includes(symbol.toUpperCase());
}

export function parseAddressList(value: string | undefined): string[] {
  if (!value) return [];

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.toLowerCase());
}

export function nativeTokenForChain(chainCode: string): SwapToken {
  const chain = getSwapChain(chainCode);
  const native = chain?.tokens.find((token) => token.native);

  if (!native) {
    throw new Error(`Native token is not configured for ${chainCode}`);
  }

  return native;
}

export function defaultRouterForChain(chainCode: string): string {
  const router = DEFAULT_ROUTERS[chainCode as SwapChainCode];

  if (!router) {
    throw new Error(`Default router is not configured for ${chainCode}`);
  }

  return router;
}

export function defaultExecutorForChain(chainCode: string): string {
  const executor = DEFAULT_EXECUTORS[chainCode as SwapChainCode];

  if (!executor) {
    throw new Error(`Default executor is not configured for ${chainCode}`);
  }

  return executor;
}
