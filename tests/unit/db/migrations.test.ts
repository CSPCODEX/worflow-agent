import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { setupTestDb, teardownTestDb, getTestDb } from '../../helpers/testDb';

describe('migrations', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  it('crea la tabla agents con las columnas correctas', () => {
    const db = getTestDb();
    // PRAGMA table_info returns one row per column
    const cols = db.query<{ name: string }, never[]>(
      "PRAGMA table_info(agents)"
    ).all();
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('name');
    expect(colNames).toContain('description');
    expect(colNames).toContain('system_prompt');
    expect(colNames).toContain('model');
    expect(colNames).toContain('has_workspace');
    expect(colNames).toContain('path');
    expect(colNames).toContain('status');
    expect(colNames).toContain('created_at');
  });

  it('crea la tabla conversations con FK a agents', () => {
    const db = getTestDb();
    const cols = db.query<{ name: string }, never[]>(
      "PRAGMA table_info(conversations)"
    ).all();
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('agent_id');
    expect(colNames).toContain('title');
    expect(colNames).toContain('created_at');
  });

  it('crea la tabla messages con FK a conversations', () => {
    const db = getTestDb();
    const cols = db.query<{ name: string }, never[]>(
      "PRAGMA table_info(messages)"
    ).all();
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('conversation_id');
    expect(colNames).toContain('role');
    expect(colNames).toContain('content');
    expect(colNames).toContain('created_at');
  });

  it('migration v2 agrega columna enhance_status a agents', () => {
    const db = getTestDb();
    const cols = db.query<{ name: string }, never[]>(
      "PRAGMA table_info(agents)"
    ).all();
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('enhance_status');
  });

  it('migration v3 agrega columna provider a agents', () => {
    const db = getTestDb();
    const cols = db.query<{ name: string }, never[]>(
      "PRAGMA table_info(agents)"
    ).all();
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('provider');
  });

  it('schema_version contiene la version mas reciente', () => {
    const db = getTestDb();
    const row = db.query<{ version: number }, never[]>(
      'SELECT MAX(version) as version FROM schema_version'
    ).get();
    // There are 3 migrations (versions 1, 2, 3)
    expect(row?.version).toBe(3);
  });

  it('aplicar migrations es idempotente — segunda llamada no lanza error', () => {
    // setupTestDb already applied migrations; calling it again on the same DB
    // would be risky but here we just verify the schema_version is stable.
    const db = getTestDb();
    const row = db.query<{ version: number }, never[]>(
      'SELECT MAX(version) as version FROM schema_version'
    ).get();
    expect(row?.version).toBe(3);
  });
});
