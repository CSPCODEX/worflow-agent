import { getDatabase } from './database';

const DEFAULTS: Record<string, string> = {
  lmstudio_host: 'ws://127.0.0.1:1234',
  enhancer_model: '',
  default_provider: 'lmstudio',
  default_provider_config: '{}',
};

export const settingsRepository = {
  get(key: string): string {
    const db = getDatabase();
    const row = db.query<{ value: string }, [string]>(
      'SELECT value FROM settings WHERE key = ?'
    ).get(key);
    return row?.value ?? DEFAULTS[key] ?? '';
  },

  set(key: string, value: string): void {
    const db = getDatabase();
    db.run(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      [key, value]
    );
  },

  getAll(): { lmstudioHost: string; enhancerModel: string; defaultProvider: string; defaultProviderConfig: string } {
    const db = getDatabase();
    const rows = db.query<{ key: string; value: string }, [string, string, string, string]>(
      'SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?)'
    ).all('lmstudio_host', 'enhancer_model', 'default_provider', 'default_provider_config');
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      lmstudioHost: map.get('lmstudio_host') ?? 'ws://127.0.0.1:1234',
      enhancerModel: map.get('enhancer_model') ?? '',
      defaultProvider: map.get('default_provider') ?? 'lmstudio',
      defaultProviderConfig: map.get('default_provider_config') ?? '{}',
    };
  },
};
