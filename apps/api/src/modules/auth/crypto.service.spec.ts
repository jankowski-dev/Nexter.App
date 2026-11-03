import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CryptoService } from './crypto.service';

const service = new CryptoService(randomBytes(32).toString('base64'));

describe('CryptoService', () => {
  it('hashes and verifies passwords', async () => {
    const passwordHash = await service.hashPassword('correct horse battery staple');

    await expect(
      service.verifyPassword(passwordHash, 'correct horse battery staple'),
    ).resolves.toBe(true);
    await expect(service.verifyPassword(passwordHash, 'wrong password')).resolves.toBe(false);
  });

  it('encrypts and decrypts TOTP secrets', () => {
    const payload = service.encryptSecret('JBSWY3DPEHPK3PXP');

    expect(payload).not.toContain('JBSWY3DPEHPK3PXP');
    expect(service.decryptSecret(payload)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('generates unique recovery codes and hashes them', () => {
    const codes = service.generateRecoveryCodes(10);

    expect(new Set(codes).size).toBe(10);
    expect(service.hashRecoveryCode(codes[0] ?? '')).toHaveLength(64);
  });

  it('compares strings safely', () => {
    expect(service.safeEqual('abc', 'abc')).toBe(true);
    expect(service.safeEqual('abc', 'abd')).toBe(false);
    expect(service.safeEqual('abc', 'abcd')).toBe(false);
  });
});
