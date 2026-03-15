import { Database } from 'bun:sqlite';

let _historyTestDb: Database | null = null;

export function setupHistoryTestDb(): Database {
  _historyTestDb = new Database(':memory:');
  _historyTestDb.exec('PRAGMA foreign_keys = ON');
  applyMonitorMigrations(_historyTestDb);
  return _historyTestDb;
}

export function getHistoryTestDb(): Database {
  if (!_historyTestDb) throw new Error('historyTestDb not initialized -- call setupHistoryTestDb() in beforeEach');
  return _historyTestDb;
}

export function teardownHistoryTestDb(): void {
  if (_historyTestDb) {
    _historyTestDb.close();
    _historyTestDb = null;
  }
}

function applyMonitorMigrations(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);`);

  const row = db.query<{ version: number }, never[]>(
    'SELECT MAX(version) as version FROM schema_version'
  ).get();
  const currentVersion = row?.version ?? 0;

  if (currentVersion < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type  TEXT NOT NULL,
        item_type   TEXT NOT NULL,
        item_slug   TEXT NOT NULL,
        item_title  TEXT NOT NULL,
        from_value  TEXT,
        to_value    TEXT NOT NULL,
        agent_id    TEXT,
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pe_item ON pipeline_events(item_type, item_slug);
      CREATE INDEX IF NOT EXISTS idx_pe_recorded ON pipeline_events(recorded_at);
      CREATE INDEX IF NOT EXISTS idx_pe_agent ON pipeline_events(agent_id);

      CREATE TABLE IF NOT EXISTS agent_metrics_history (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id        TEXT NOT NULL,
        item_type       TEXT NOT NULL,
        item_slug       TEXT NOT NULL,
        rework          INTEGER,
        iteraciones     INTEGER,
        confianza       TEXT,
        gaps_declarados INTEGER,
        recorded_at     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_amh_agent ON agent_metrics_history(agent_id);
      CREATE INDEX IF NOT EXISTS idx_amh_item ON agent_metrics_history(item_type, item_slug);
    `);
    db.run('INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [1]);
  }
}
