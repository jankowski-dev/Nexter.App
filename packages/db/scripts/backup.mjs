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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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

function dumpNative(databaseUrl, output) {
  run('pg_dump', [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    `--file=${output}`,
    `--dbname=${databaseUrl}`,
  ]);
}

function dumpDocker(databaseUrl, output) {
  const url = new URL(databaseUrl);
  const tempDir = dirname(output);
  const fileName = output.slice(tempDir.length + 1);
  const mount = `${tempDir}:/backup`;

  run('docker', [
    'run',
    '--rm',
    '--network',
    'host',
    '-v',
    mount,
    '-e',
    `PGPASSWORD=${url.password}`,
    'postgres:17-alpine',
    'pg_dump',
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--host',
    url.hostname,
    '--port',
    url.port || '5432',
    '--username',
    decodeURIComponent(url.username),
    '--dbname',
    url.pathname.slice(1),
    '--file',
    `/backup/${fileName}`,
  ]);
}

function selfTest() {
  const key = randomBytes(32);
  const plaintext = randomBytes(1024 * 1024);
  const encrypted = encryptBuffer(plaintext, key);
  const decrypted = decryptBuffer(encrypted, key);

  if (!decrypted.equals(plaintext)) {
    fail('Encryption self-test failed');
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

  console.log('Backup encryption self-test PASSED (round-trip + tamper rejection)');
}

function decryptCommand(input, output) {
  const key = parseKey(process.env.BACKUP_ENCRYPTION_KEY);
  if (!key) fail('BACKUP_ENCRYPTION_KEY is required for --decrypt');
  const encrypted = readFileSync(input);
  const plaintext = decryptBuffer(encrypted, key);
  writeFileSync(output, plaintext);
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

  const outputDir = process.env.BACKUP_OUTPUT_DIR
    ? resolve(process.env.BACKUP_OUTPUT_DIR)
    : resolve(process.cwd(), 'backups');
  mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const dumpPath = join(outputDir, `nexter-${timestamp}.dump`);
  const encryptedPath = `${dumpPath}.enc`;
  const mode = process.env.BACKUP_DUMP_MODE ?? 'auto';

  try {
    if (mode === 'native' || (mode === 'auto' && hasCommand('pg_dump'))) {
      dumpNative(databaseUrl, dumpPath);
    } else if (mode === 'docker' || (mode === 'auto' && hasDocker())) {
      dumpDocker(databaseUrl, dumpPath);
    } else {
      fail('pg_dump is not available and Docker is not running');
    }

    const plaintext = readFileSync(dumpPath);
    const encrypted = encryptBuffer(plaintext, key);
    writeFileSync(encryptedPath, encrypted);

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
    rmSync(dumpPath, { force: true });
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
  console.error(error);
  process.exitCode = 1;
}
