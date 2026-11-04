import type { SwapChainConfig, SwapToken } from '@nexter/contracts';

export const BSC_NATIVE_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

const BSC_TOKENS: SwapToken[] = [
  {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
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
    symbol: 'LINK',
    name: 'ChainLink Token',
    address: '0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd',
    decimals: 18,
    native: false,
  },
  {
    symbol: 'BNB',
    name: 'BNB',
    address: BSC_NATIVE_ADDRESS,
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
  },
];

export const DEFAULT_BSC_ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';
export const DEFAULT_BSC_EXECUTOR = '0x8F10B468b06c6FD214B65F87778827F7D113f996';

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
  return address.toLowerCase() === BSC_NATIVE_ADDRESS.toLowerCase();
}

export function parseAddressList(value: string | undefined): string[] {
  if (!value) return [];

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.toLowerCase());
}
