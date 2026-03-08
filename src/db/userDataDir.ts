import path from 'node:path';
import { mkdirSync } from 'node:fs';

function resolveUserDataDir(): string {
  const platform = process.platform;

  let dir: string;

  if (platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) throw new Error('APPDATA environment variable is not set');
    dir = path.join(appData, 'Worflow Agent');
  } else if (platform === 'darwin') {
    dir = path.join(process.env.HOME ?? '~', 'Library', 'Application Support', 'Worflow Agent');
  } else {
    dir = path.join(process.env.HOME ?? '~', '.config', 'worflow-agent');
  }

  mkdirSync(dir, { recursive: true });
  return dir;
}

export const USER_DATA_DIR = resolveUserDataDir();
export const DB_PATH = path.join(USER_DATA_DIR, 'worflow.db');
export const AGENTS_DIR = path.join(USER_DATA_DIR, 'agents');

export function getUserDataDir(): string {
  return USER_DATA_DIR;
}
