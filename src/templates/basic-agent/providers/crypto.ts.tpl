/**
 * Minimal crypto utilities for decrypting API keys stored with the "enc:" prefix.
 * The master key lives in the same userData directory as the app database.
 */
import {
  createDecipheriv,
} from 'node:crypto';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

function resolveMasterKeyPath(): string {
  const platform = process.platform;
  let dir: string;

  if (platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) throw new Error('APPDATA environment variable is not set');
    dir = path.join(appData, 'Worflow Agent');
  } else if (platform === 'darwin') {
    const home = process.env.HOME;
    if (!home) throw new Error('HOME environment variable is not set');
    dir = path.join(home, 'Library', 'Application Support', 'Worflow Agent');
  } else {
    const home = process.env.HOME;
    if (!home) throw new Error('HOME environment variable is not set');
    dir = path.join(home, '.config', 'worflow-agent');
  }

  return path.join(dir, 'master.key');
}

function getMasterKey(): Buffer {
  const keyPath = resolveMasterKeyPath();
  if (!existsSync(keyPath)) {
    throw new Error(
      `master.key no encontrado en ${keyPath}. Asegúrate de haber creado el agente desde la aplicación.`
    );
  }
  const raw = readFileSync(keyPath, 'utf8').trim();
  return Buffer.from(raw, 'hex');
}

/**
 * Decrypts a value if it starts with "enc:".
 * Returns the value unchanged if it is not encrypted (backwards-compatible).
 */
export function decryptIfNeeded(value: string): string {
  if (!value || !value.startsWith('enc:')) return value;

  const parts = value.slice(4).split(':');
  if (parts.length !== 3) {
    throw new Error('Formato de clave encriptada inválido. Se esperaba "enc:<iv>:<authTag>:<ciphertext>".');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = getMasterKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
