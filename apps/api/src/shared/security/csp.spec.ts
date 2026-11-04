import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY, HELMET_CSP_DIRECTIVES } from './csp';

describe('content security policy', () => {
  it('allows the WalletConnect relay and AppKit origins', () => {
    for (const origin of [
      'wss://relay.walletconnect.com',
      'wss://relay.walletconnect.org',
      'https://api.web3modal.com',
      'https://pulse.walletconnect.org',
      'https://explorer-api.walletconnect.com',
    ]) {
      expect(CONTENT_SECURITY_POLICY).toContain(origin);
    }

    expect(CONTENT_SECURITY_POLICY).toContain("frame-src 'self' https://verify.walletconnect.com");
  });

  it('keeps scripts locked to self and serializes every directive', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");

    for (const name of Object.keys(HELMET_CSP_DIRECTIVES)) {
      expect(CONTENT_SECURITY_POLICY).toContain(
        name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
      );
    }
  });
});
