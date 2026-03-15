import { Database } from 'bun:sqlite';
import { migrations } from '../../src/db/migrations';

// Module-level singleton for the current test DB.
// Each test file that uses repositories must call setupTestDb() in beforeEach
// and teardownTestDb() in afterEach to isolate state.
let _testDb: Database | null = null;

export function getTestDb(): Database {
  if (!_testDb) throw new Error('testDb not initialized — call setupTestDb() in beforeEach');
  return _testDb;
}

export function setupTestDb(): Database {
  _testDb = new Database(':memory:');
  _testDb.exec('PRAGMA foreign_keys = ON');
  applyTestMigrations(_testDb);
  return _testDb;
}

export function teardownTestDb(): void {
  if (_testDb) {
    _testDb.close();
    _testDb = null;
  }
}

function applyTestMigrations(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);`);

  const row = db.query<{ version: number }, never[]>(
    'SELECT MAX(version) as version FROM schema_version'
  ).get();

  const currentVersion = row?.version ?? 0;
  const pending = migrations.filter((m) => m.version > currentVersion);

  for (const migration of pending) {
    try {
      db.exec(migration.up);
    } catch (e: any) {
      if (!e?.message?.includes('duplicate column name')) throw e;
    }
    db.run('INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [migration.version]);
  }
}
