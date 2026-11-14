import { describe, expect, it } from 'vitest';
import { createLockPin, isValidLockPin, verifyLockPin } from './app-lock-crypto';

describe('app lock PIN', () => {
  it('accepts only six digits', () => {
    expect(isValidLockPin('123456')).toBe(true);
    expect(isValidLockPin('12345')).toBe(false);
    expect(isValidLockPin('12345a')).toBe(false);
    expect(isValidLockPin('')).toBe(false);
  });

  it('stores a salted hash and verifies the correct PIN', async () => {
    const stored = await createLockPin('123456');

    expect(stored.hash).not.toContain('123456');
    expect(stored.salt).not.toHaveLength(0);
    await expect(verifyLockPin('123456', stored)).resolves.toBe(true);
    await expect(verifyLockPin('654321', stored)).resolves.toBe(false);
  });

  it('uses a different salt for every setup', async () => {
    const first = await createLockPin('123456');
    const second = await createLockPin('123456');

    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it('rejects malformed PINs before hashing', async () => {
    await expect(createLockPin('12345')).rejects.toThrow('6 цифр');
  });
});
