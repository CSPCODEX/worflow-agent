import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { USER_DATA_DIR } from '../db/userDataDir';

const MASTER_KEY_PATH = path.join(USER_DATA_DIR, 'master.key');
const ALGORITHM = 'aes-256-gcm';

export function getMasterKey(): Buffer {
  if (existsSync(MASTER_KEY_PATH)) {
    const raw = readFileSync(MASTER_KEY_PATH, 'utf8').trim();
    return Buffer.from(raw, 'hex');
  }

  // First run — generate and persist the master key
  mkdirSync(path.dirname(MASTER_KEY_PATH), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(MASTER_KEY_PATH, key.toString('hex'), { mode: 0o600 });
  return key;
}

/**
 * Encrypts a plaintext API key with AES-256-GCM.
 * Returns a string in the format: "enc:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
export function encryptApiKey(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `enc:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a value if it starts with "enc:".
 * Returns the value unchanged if it is not encrypted (backwards-compatible).
 */
export function decryptIfNeeded(value: string): string {
  if (!value.startsWith('enc:')) return value;

  const parts = value.slice(4).split(':');
  if (parts.length !== 3) {
    throw new Error('Formato de clave encriptada inválido. Se esperaba "enc:<iv>:<authTag>:<ciphertext>".');
  }

  const ivHex = parts[0]!;
  const authTagHex = parts[1]!;
  const ciphertextHex = parts[2]!;
  const key = getMasterKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
