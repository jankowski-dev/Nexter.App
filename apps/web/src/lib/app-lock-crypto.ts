const PIN_ITERATIONS = 210_000;
const SALT_BYTES = 16;

export interface StoredLockPin {
  salt: string;
  hash: string;
  iterations: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function isValidLockPin(value: string): boolean {
  return /^\d{6}$/.test(value);
}

async function derivePinHash(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    256,
  );

  return bytesToBase64(new Uint8Array(bits));
}

export async function createLockPin(pin: string): Promise<StoredLockPin> {
  if (!isValidLockPin(pin)) throw new Error('Код должен состоять из 6 цифр');

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derivePinHash(pin, salt, PIN_ITERATIONS);

  return { salt: bytesToBase64(salt), hash, iterations: PIN_ITERATIONS };
}

export async function verifyLockPin(pin: string, stored: StoredLockPin): Promise<boolean> {
  if (!isValidLockPin(pin)) return false;

  const derived = await derivePinHash(pin, base64ToBytes(stored.salt), stored.iterations);

  return derived === stored.hash;
}
