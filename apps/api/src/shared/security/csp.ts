/**
 * WalletConnect/Reown AppKit origins required by the QR connection flow.
 * Keep in sync with https://docs.reown.com/advanced/security/content-security-policy
 */
const WALLETCONNECT_CONNECT_SRC = [
  'https://rpc.walletconnect.com',
  'https://rpc.walletconnect.org',
  'https://relay.walletconnect.com',
  'https://relay.walletconnect.org',
  'wss://relay.walletconnect.com',
  'wss://relay.walletconnect.org',
  'https://pulse.walletconnect.com',
  'https://pulse.walletconnect.org',
  'https://api.web3modal.com',
  'https://api.web3modal.org',
  'https://keys.walletconnect.com',
  'https://keys.walletconnect.org',
  'https://notify.walletconnect.com',
  'https://notify.walletconnect.org',
  'https://echo.walletconnect.com',
  'https://echo.walletconnect.org',
  'https://push.walletconnect.com',
  'https://push.walletconnect.org',
  'https://explorer-api.walletconnect.com',
  'wss://www.walletlink.org',
  'https://cca-lite.coinbase.com',
];

const WALLETCONNECT_FRAME_SRC = [
  'https://verify.walletconnect.com',
  'https://verify.walletconnect.org',
  'https://secure.walletconnect.com',
  'https://secure.walletconnect.org',
];

const connectSrc = ["'self'", ...WALLETCONNECT_CONNECT_SRC];
const frameSrc = ["'self'", ...WALLETCONNECT_FRAME_SRC];

export const HELMET_CSP_DIRECTIVES: Record<string, readonly string[]> = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  fontSrc: ["'self'", 'https:', 'data:'],
  imgSrc: ["'self'", 'data:', 'https:'],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  connectSrc,
  frameSrc,
  frameAncestors: ["'none'"],
};

function kebabCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Serialized form for responses that bypass the helmet hook (rate limiting).
 * Derived from the same directives so the two policies cannot drift.
 */
export const CONTENT_SECURITY_POLICY = Object.entries(HELMET_CSP_DIRECTIVES)
  .map(([name, values]) => `${kebabCase(name)} ${values.join(' ')}`)
  .join('; ');
