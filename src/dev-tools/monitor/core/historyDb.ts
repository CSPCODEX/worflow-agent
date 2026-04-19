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
    {
      version: 2,
      up: `
        CREATE TABLE IF NOT EXISTS agent_behavior_history (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id            TEXT NOT NULL,
          item_type           TEXT NOT NULL,
          item_slug           TEXT NOT NULL,
          checklist_total     INTEGER,
          checklist_checked   INTEGER,
          structure_score_num INTEGER,
          structure_score_den INTEGER,
          refs_total          INTEGER,
          refs_valid          INTEGER,
          memory_read         INTEGER,
          recorded_at         TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_abh_agent ON agent_behavior_history(agent_id);
        CREATE INDEX IF NOT EXISTS idx_abh_item  ON agent_behavior_history(item_type, item_slug);
      `,
    },
    {
      version: 3,
      up: `
        DELETE FROM agent_behavior_history
        WHERE id NOT IN (
          SELECT MIN(id) FROM agent_behavior_history
          GROUP BY agent_id, item_type, item_slug
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_abh_unique
          ON agent_behavior_history(agent_id, item_type, item_slug);
      `,
    },
    {
      version: 4,
      up: `
        CREATE TABLE IF NOT EXISTS compliance_scores (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          feature_slug TEXT NOT NULL,
          score        REAL NOT NULL,
          files_spec   INTEGER NOT NULL,
          files_ok     INTEGER NOT NULL,
          files_viol   INTEGER NOT NULL,
          branch       TEXT NOT NULL,
          base_ref     TEXT NOT NULL,
          recorded_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cs_feature ON compliance_scores(feature_slug);

        CREATE TABLE IF NOT EXISTS rejection_records (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          feature_slug         TEXT NOT NULL,
          agent_at_fault       TEXT NOT NULL,
          instruction_violated TEXT NOT NULL,
          instruction_source   TEXT NOT NULL,
          failure_type         TEXT NOT NULL,
          recorded_at          TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rr_agent   ON rejection_records(agent_at_fault);
        CREATE INDEX IF NOT EXISTS idx_rr_feature ON rejection_records(feature_slug);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_unique
          ON rejection_records(feature_slug, agent_at_fault, instruction_violated);
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
