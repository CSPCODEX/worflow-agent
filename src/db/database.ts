import { Database } from 'bun:sqlite';
import { DB_PATH } from './userDataDir';
import { migrations } from './migrations';

let _db: Database | null = null;

export function initDatabase(): Database {
  if (_db) return _db;

  const db = new Database(DB_PATH);

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  applyMigrations(db);

  _db = db;
  return db;
}

export function getDatabase(): Database {
  if (!_db) throw new Error('Database not initialized. Call initDatabase() first.');
  return _db;
}

function applyMigrations(db: Database): void {
  // Ensure schema_version table exists before querying it
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  const row = db.query<{ version: number }, []>(
    'SELECT MAX(version) as version FROM schema_version'
  ).get([]);

  const currentVersion = row?.version ?? 0;

  const pending = migrations.filter((m) => m.version > currentVersion);

  for (const migration of pending) {
    try {
      db.exec(migration.up);
    } catch (err: any) {
      if (typeof err?.message === 'string' && err.message.includes('duplicate column name')) {
        // Column already exists — migration already applied partially; safe to continue.
      } else {
        throw err;
      }
    }
    db.run('INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [migration.version]);
  }
}
