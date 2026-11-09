const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const VAULT_ITERATIONS = 600_000;
export const MAX_VAULT_PLAINTEXT_BYTES = 11_984;

export interface VaultItemData {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
}

export interface EncryptedValue {
  ciphertext: string;
  iv: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function createSalt(): string {
  return bytesToBase64(randomBytes(16));
}

export async function deriveMasterKey(
  password: string,
  salt: string,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: base64ToBytes(salt),
      iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

export async function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function wrapDataKey(
  dataKey: CryptoKey,
  masterKey: CryptoKey,
): Promise<EncryptedValue> {
  const iv = randomBytes(12);
  const wrapped = await crypto.subtle.wrapKey('raw', dataKey, masterKey, {
    name: 'AES-GCM',
    iv,
  });

  return {
    ciphertext: bytesToBase64(new Uint8Array(wrapped)),
    iv: bytesToBase64(iv),
  };
}

export async function unwrapDataKey(
  wrappedKey: string,
  wrappedKeyIv: string,
  masterKey: CryptoKey,
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    base64ToBytes(wrappedKey),
    masterKey,
    { name: 'AES-GCM', iv: base64ToBytes(wrappedKeyIv) },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptVaultItem(
  dataKey: CryptoKey,
  data: VaultItemData,
): Promise<EncryptedValue> {
  const iv = randomBytes(12);
  const encoded = textEncoder.encode(JSON.stringify(data));

  if (encoded.byteLength > MAX_VAULT_PLAINTEXT_BYTES) {
    throw new Error('VAULT_ITEM_TOO_LARGE');
  }

  const plaintext = toArrayBuffer(encoded);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, plaintext);

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  };
}

function parseItem(value: unknown): VaultItemData {
  if (!value || typeof value !== 'object') throw new Error('Invalid vault item');

  const row = value as Record<string, unknown>;
  return {
    title: typeof row.title === 'string' ? row.title : '',
    username: typeof row.username === 'string' ? row.username : '',
    password: typeof row.password === 'string' ? row.password : '',
    url: typeof row.url === 'string' ? row.url : '',
    notes: typeof row.notes === 'string' ? row.notes : '',
  };
}

export async function decryptVaultItem(
  dataKey: CryptoKey,
  ciphertext: string,
  iv: string,
): Promise<VaultItemData> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    dataKey,
    base64ToBytes(ciphertext),
  );

  return parseItem(JSON.parse(textDecoder.decode(plaintext)) as unknown);
}

export function generatePassword(length = 20): string {
  const groups = [
    'abcdefghijkmnopqrstuvwxyz',
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    '23456789',
    '!@#$%^&*-_=+',
  ];
  const all = groups.join('');

  function randomIndex(max: number): number {
    const limit = 256 - (256 % max);
    let byte = 256;

    while (byte >= limit) {
      byte = randomBytes(1)[0] ?? 0;
    }

    return byte % max;
  }

  const size = Math.max(length, groups.length);
  const chars = groups.map((group) => group[randomIndex(group.length)]);

  while (chars.length < size) {
    chars.push(all[randomIndex(all.length)]);
  }

  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = randomIndex(index + 1);
    [chars[index], chars[swap]] = [chars[swap], chars[index]];
  }

  return chars.join('');
}
