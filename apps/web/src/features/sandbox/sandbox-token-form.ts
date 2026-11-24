import {
  normalizeSandboxTokenKey,
  type SandboxChain,
  type SandboxTokenCreateRequest,
} from '@nexter/contracts';

export type SandboxTokenKeyMode = 'key' | 'chain';

export interface SandboxTokenFormValues {
  mode: SandboxTokenKeyMode;
  tokenKey: string;
  chain: SandboxChain;
  identifier: string;
  symbol: string;
  name: string;
  coingeckoId: string;
  enabled: boolean;
}

export function sandboxTokenFormDefaults(): SandboxTokenFormValues {
  return {
    mode: 'key',
    tokenKey: '',
    chain: 'bsc',
    identifier: '',
    symbol: '',
    name: '',
    coingeckoId: '',
    enabled: true,
  };
}

/**
 * Resolves the canonical provider key from either the direct key field or the
 * chain + contract/pair fields. Returns null when the input is unsupported so
 * the form can show a Russian validation message instead of calling the API.
 */
export function sandboxTokenKeyFromForm(values: SandboxTokenFormValues): string | null {
  if (values.mode === 'key') return normalizeSandboxTokenKey(values.tokenKey);

  const identifier = values.identifier.trim();
  if (identifier.length === 0) return null;
  if (values.chain === 'binance') {
    return normalizeSandboxTokenKey(`binance:${identifier.toUpperCase()}`);
  }
  return normalizeSandboxTokenKey(`${values.chain}:${identifier}`);
}

export function validateSandboxTokenForm(values: SandboxTokenFormValues): string[] {
  const errors: string[] = [];
  const tokenKey = sandboxTokenKeyFromForm(values);

  if (!tokenKey) {
    errors.push(
      'Укажите ключ вида bsc:0x…, ethereum:0x… или binance:BTCUSDT, либо выберите сеть и адрес/пару.',
    );
  }

  const symbol = values.symbol.trim();
  if (symbol.length === 0) errors.push('Укажите символ токена.');
  else if (symbol.length > 40) errors.push('Символ не длиннее 40 символов.');

  const name = values.name.trim();
  if (name.length === 0) errors.push('Укажите название токена.');
  else if (name.length > 80) errors.push('Название не длиннее 80 символов.');

  const coingeckoId = values.coingeckoId.trim();
  if (coingeckoId.length > 0) {
    if (coingeckoId.length > 80) errors.push('CoinGecko id не длиннее 80 символов.');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(coingeckoId)) {
      errors.push('CoinGecko id: строчные латинские буквы, цифры и дефис.');
    }
  }

  return errors;
}

export function sandboxTokenCreatePayload(
  values: SandboxTokenFormValues,
): SandboxTokenCreateRequest {
  const tokenKey = sandboxTokenKeyFromForm(values);
  if (!tokenKey) throw new Error('Unsupported sandbox token key');

  const coingeckoId = values.coingeckoId.trim();
  return {
    tokenKey,
    symbol: values.symbol.trim(),
    name: values.name.trim(),
    ...(coingeckoId.length > 0 ? { coingeckoId } : {}),
    enabled: values.enabled,
  };
}
