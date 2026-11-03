import { ServiceUnavailableException } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ARGON_OPTIONS = {
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  algorithm: Algorithm.Argon2id,
};

export class CryptoService {
  private readonly key: Buffer | undefined;

  constructor(keyValue: string | undefined) {
    this.key = this.parseKey(keyValue);
  }

  private parseKey(value: string | undefined): Buffer | undefined {
    if (!value) return undefined;

    if (/^[0-9a-f]{64}$/i.test(value)) {
      return Buffer.from(value, 'hex');
    }

    const decoded = Buffer.from(value, 'base64');
    return decoded.length === 32 ? decoded : undefined;
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new ServiceUnavailableException(
        'AUTH_ENCRYPTION_KEY is not configured or is not a 32-byte base64/hex key',
      );
    }

    return this.key;
  }

  async hashPassword(password: string): Promise<string> {
    return hash(password, ARGON_OPTIONS);
  }

  async verifyPassword(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password, ARGON_OPTIONS);
    } catch {
      return false;
    }
  }

  sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('hex');
  }

  safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  encryptSecret(plainText: string): string {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
  }

  decryptSecret(payload: string): string {
    const key = this.requireKey();
    const [ivEncoded, tagEncoded, ciphertextEncoded] = payload.split(':');

    if (!ivEncoded || !tagEncoded || !ciphertextEncoded) {
      throw new Error('Invalid encrypted secret format');
    }

    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivEncoded, 'base64'));
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  generateRecoveryCodes(count = 10): string[] {
    return Array.from({ length: count }, () => randomBytes(9).toString('base64url'));
  }

  hashRecoveryCode(code: string): string {
    return this.sha256(code);
  }
}
