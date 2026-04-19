import { Database } from 'bun:sqlite';
import { DB_PATH } from './userDataDir';
import { migrations } from './migrations';
import { builtinTemplates } from './builtinTemplates';
import { builtinAgents } from './builtinAgents';
import { randomUUID } from 'node:crypto';

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

  seedBuiltinTemplates(db);
  seedBuiltinAgents(db);
}

function seedBuiltinTemplates(db: Database): void {
  const row = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM pipeline_templates WHERE is_builtin = 1"
  ).get([]);

  if (row && row.count > 0) return;

  for (const template of builtinTemplates) {
    db.run(
      `INSERT OR IGNORE INTO pipeline_templates (id, name, description, category, variables, steps, is_builtin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        template.id,
        template.name,
        template.description,
        template.category,
        JSON.stringify(template.variables),
        JSON.stringify(template.steps),
        1,
        template.createdAt,
      ]
    );
  }
}

function seedBuiltinAgents(db: Database): void {
  const row = db.query<{ count: number }, []>(
    'SELECT COUNT(*) as count FROM agents WHERE is_default = 1'
  ).get([]);

  if (row && row.count > 0) return;

  for (const agent of builtinAgents) {
    db.run(
      `INSERT OR IGNORE INTO agents (id, name, description, system_prompt, model, has_workspace, path, status, created_at, provider, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1)`,
      [
        randomUUID(),
        agent.name,
        agent.description,
        agent.systemPrompt,
        agent.model,
        agent.hasWorkspace ? 1 : 0,
        agent.path,
        new Date().toISOString(),
        agent.provider,
      ]
    );
  }
}
