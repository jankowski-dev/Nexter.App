import { describe, expect, it } from 'vitest';
import {
  createSalt,
  decryptVaultItem,
  deriveMasterKey,
  encryptVaultItem,
  generateDataKey,
  generatePassword,
  unwrapDataKey,
  wrapDataKey,
} from './vault-crypto';

const item = {
  title: 'Test Login',
  username: 'user@example.com',
  password: 's3cret-password',
  url: 'https://example.com',
  notes: 'note',
};

async function createVault(password: string) {
  const salt = createSalt();
  const masterKey = await deriveMasterKey(password, salt, 1_000);
  const dataKey = await generateDataKey();
  const wrapped = await wrapDataKey(dataKey, masterKey);

  return { salt, masterKey, dataKey, wrapped };
}

describe('vault crypto', () => {
  it('round-trips the wrapped data key and an item', async () => {
    const vault = await createVault('correct horse battery staple');
    const key = await unwrapDataKey(vault.wrapped.ciphertext, vault.wrapped.iv, vault.masterKey);
    const encrypted = await encryptVaultItem(key, item);

    await expect(decryptVaultItem(key, encrypted.ciphertext, encrypted.iv)).resolves.toEqual(item);
  });

  it('rejects a wrong master password', async () => {
    const vault = await createVault('correct horse battery staple');
    const wrong = await deriveMasterKey('wrong password', vault.salt, 1_000);

    await expect(
      unwrapDataKey(vault.wrapped.ciphertext, vault.wrapped.iv, wrong),
    ).rejects.toBeDefined();
  });

  it('uses a fresh IV for every encryption', async () => {
    const vault = await createVault('correct horse battery staple');
    const first = await encryptVaultItem(vault.dataKey, item);
    const second = await encryptVaultItem(vault.dataKey, item);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('rejects malformed ciphertext', async () => {
    const vault = await createVault('correct horse battery staple');

    await expect(decryptVaultItem(vault.dataKey, 'not-base64', '!!!')).rejects.toBeDefined();
  });

  it('generates passwords with all character classes', () => {
    const value = generatePassword(20);

    expect(value).toHaveLength(20);
    expect(value).toMatch(/[a-z]/);
    expect(value).toMatch(/[A-Z]/);
    expect(value).toMatch(/[0-9]/);
    expect(value).toMatch(/[!@#$%^&*\-_=+]/);
  });
});
