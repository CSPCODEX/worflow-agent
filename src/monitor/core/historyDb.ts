// ============================================================
// historyDb.ts — Singleton SQLite para el historial del monitor
// Gestionado dentro del modulo (no usa src/db/database.ts).
// Solo imports de bun:sqlite — sin dependencias externas.
// ============================================================

import { Database } from 'bun:sqlite';

let _historyDb: Database | null = null;

export function initHistoryDb(dbPath: string): Database {
  if (_historyDb) return _historyDb;

  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  applyHistoryMigrations(db);
  _historyDb = db;
  return db;
}

export function getHistoryDb(): Database | null {
  return _historyDb;
}

export function closeHistoryDb(): void {
  if (_historyDb) {
    _historyDb.close();
    _historyDb = null;
  }
}

function applyHistoryMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  const row = db.query<{ version: number }, []>(
    'SELECT MAX(version) as version FROM schema_version'
  ).get();
  const currentVersion = row?.version ?? 0;

  const migrations = [
    {
      version: 1,
      up: `
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
      `,
    },
  ];

  for (const m of migrations) {
    if (m.version > currentVersion) {
      db.exec(m.up);
      db.run('INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [m.version]);
    }
  }
}
