import type { FastifyServerOptions } from 'fastify';

export type TrustProxySetting = FastifyServerOptions['trustProxy'];

/**
 * Fastify accepts a boolean, a hop count, or a CIDR list. The environment is a
 * string, so convert numeric hop counts instead of passing "1" through as a
 * literal address list (which would not do what the operator expects).
 */
export function parseTrustProxy(value: string): TrustProxySetting {
  if (value === 'false') return false;
  if (value === 'true') return true;

  if (/^\d+$/.test(value)) {
    const hops = Number(value);

    // Fastify passes a function through to proxy-addr. Trusting `hops` entries
    // from the socket keeps client-supplied X-Forwarded-For values untrusted.
    return (_address: string, hop: number) => hop < hops;
  }

  return value;
}
