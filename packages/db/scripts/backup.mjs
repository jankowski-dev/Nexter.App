#!/usr/bin/env node
/**
 * Encrypted logical backup for Nexter.
 *
 * Produces a PostgreSQL custom-format dump and encrypts it with AES-256-GCM.
 * The output file layout is: "NEXTER1" | 12-byte IV | 16-byte tag | ciphertext.
 *
 * A scheduled job (Railway cron or an external scheduler) should run this with
 * production DATABASE_URL and BACKUP_ENCRYPTION_KEY, then upload the .enc file
 * to Cloudflare R2. See docs/runbooks/restore.md.
 *
 * Usage:
 *   BACKUP_ENCRYPTION_KEY=... DATABASE_URL=... node scripts/backup.mjs
 *   node scripts/backup.mjs --decrypt <file.enc> <file.dump>
 *   node scripts/backup.mjs --self-test
 */

import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const MAGIC = Buffer.from('NEXTER1');
const IV_BYTES = 12;
const TAG_BYTES = 16;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseKey(value) {
  if (!value) return undefined;
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 32 ? decoded : undefined;
}

function isWeakKey(key) {
  return key.length !== 32 || key.every((byte) => byte === key[0]);
}

function encryptBuffer(plaintext, key) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

function decryptBuffer(payload, key) {
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Not a Nexter encrypted backup');
  }

  const iv = payload.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = payload.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(MAGIC.length + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function hasCommand(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function hasDocker() {
  const result = spawnSync('docker', ['info'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}`);
  }

  return result;
}

function connectionParts(databaseUrl) {
  const url = new URL(databaseUrl);

  return {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username),
    database: url.pathname.slice(1),
    password: decodeURIComponent(url.password),
  };
}

function dumpNative(connection, output) {
  run(
    'pg_dump',
    [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--no-password',
      '--host',
      connection.host,
      '--port',
      connection.port,
      '--username',
      connection.user,
      '--dbname',
      connection.database,
      '--file',
      output,
    ],
    { env: { PGPASSWORD: connection.password } },
  );
}

function dumpDocker(connection, output, tempDir) {
  const fileName = output.slice(tempDir.length + 1);
  const mount = `${tempDir}:/backup`;

  run(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'host',
      '-v',
      mount,
      '-e',
      'PGPASSWORD',
      'postgres:17-alpine',
      'pg_dump',
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--no-password',
      '--host',
      connection.host,
      '--port',
      connection.port,
      '--username',
      connection.user,
      '--dbname',
      connection.database,
      '--file',
      `/backup/${fileName}`,
    ],
    { env: { PGPASSWORD: connection.password } },
  );
}

function selfTest() {
  const key = randomBytes(32);
  const plaintext = randomBytes(1024 * 1024);
  const encrypted = encryptBuffer(plaintext, key);
  const decrypted = decryptBuffer(encrypted, key);

  if (!decrypted.equals(plaintext)) {
    fail('Encryption self-test failed');
  }

  if (!isWeakKey(Buffer.alloc(32))) {
    fail('Weak-key self-test failed');
  }

  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 0xff;

  let rejected = false;

  try {
    decryptBuffer(tampered, key);
  } catch {
    rejected = true;
  }

  if (!rejected) {
    fail('Tampered ciphertext was accepted');
  }

  console.log(
    'Backup encryption self-test PASSED (round-trip, tamper rejection, weak-key rejection)',
  );
}

function decryptCommand(input, output) {
  const key = parseKey(process.env.BACKUP_ENCRYPTION_KEY);
  if (!key) fail('BACKUP_ENCRYPTION_KEY is required for --decrypt');
  const encrypted = readFileSync(input);
  const plaintext = decryptBuffer(encrypted, key);
  writeFileSync(output, plaintext, { mode: 0o600 });
  console.log(
    JSON.stringify(
      { decrypted: output, bytes: plaintext.length, sha256: sha256(plaintext) },
      null,
      2,
    ),
  );
}

function backupCommand() {
  const databaseUrl = process.env.DATABASE_URL;
  const key = parseKey(process.env.BACKUP_ENCRYPTION_KEY);

  if (!databaseUrl) fail('DATABASE_URL is required for backup');
  if (!key) {
    fail('BACKUP_ENCRYPTION_KEY must be 32 bytes as base64 or 64 hex characters');
  }
  if (isWeakKey(key)) {
    fail('BACKUP_ENCRYPTION_KEY must not be a single repeated byte');
  }

  const connection = connectionParts(databaseUrl);
  const outputDir = process.env.BACKUP_OUTPUT_DIR
    ? resolve(process.env.BACKUP_OUTPUT_DIR)
    : resolve(process.cwd(), 'backups');
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  chmodSync(outputDir, 0o700);

  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const encryptedPath = join(outputDir, `nexter-${timestamp}.dump.enc`);
  const tempDir = mkdtempSync(join(tmpdir(), 'nexter-backup-'));
  const dumpPath = join(tempDir, 'nexter.dump');
  const mode = process.env.BACKUP_DUMP_MODE ?? 'auto';

  chmodSync(tempDir, 0o700);

  const cleanup = () => {
    rmSync(tempDir, { recursive: true, force: true });
  };

  const onSignal = (signal) => {
    cleanup();
    console.error(`Backup interrupted by ${signal}`);
    process.exit(1);
  };

  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    if (mode === 'native' || (mode === 'auto' && hasCommand('pg_dump'))) {
      dumpNative(connection, dumpPath);
    } else if (mode === 'docker' || (mode === 'auto' && hasDocker())) {
      dumpDocker(connection, dumpPath, tempDir);
    } else {
      fail('pg_dump is not available and Docker is not running');
    }

    const plaintext = readFileSync(dumpPath);
    const encrypted = encryptBuffer(plaintext, key);
    writeFileSync(encryptedPath, encrypted, { mode: 0o600 });

    console.log(
      JSON.stringify(
        {
          file: encryptedPath,
          bytes: encrypted.length,
          dumpBytes: plaintext.length,
          sha256: sha256(plaintext),
          encryptedSha256: sha256(encrypted),
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    cleanup();
  }
}

const args = process.argv.slice(2);

try {
  if (args[0] === '--self-test') {
    selfTest();
  } else if (args[0] === '--decrypt') {
    if (!args[1] || !args[2]) fail('Usage: backup.mjs --decrypt <input.enc> <output.dump>');
    decryptCommand(args[1], args[2]);
  } else {
    backupCommand();
  }
} catch (error) {
  const databasePassword = (() => {
    try {
      return decodeURIComponent(new URL(process.env.DATABASE_URL ?? '').password);
    } catch {
      return '';
    }
  })();
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.replaceAll(databasePassword, '<redacted>'));
  process.exitCode = 1;
}
