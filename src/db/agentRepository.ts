import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getDatabase } from './database';

export interface AgentRow {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  model: string;
  has_workspace: number;
  path: string;
  status: string;
  created_at: string;
  enhance_status: string;
  provider: string;
  is_default: number;
}

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  hasWorkspace: boolean;
  path: string;
  status: 'active' | 'broken';
  createdAt: string;
  provider: string;
  isDefault: boolean;
}

/** Type alias so consumers can import a single type name for the repository interface. */
export type AgentRepository = AgentRecord;

function rowToRecord(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    model: row.model,
    hasWorkspace: row.has_workspace === 1,
    path: row.path,
    status: row.status as 'active' | 'broken',
    createdAt: row.created_at,
    provider: row.provider ?? 'lmstudio',
    isDefault: row.is_default === 1,
  };
}

export const agentRepository = {
  /** Insert a new agent record. Throws if name already exists (UNIQUE constraint). */
  insert(params: {
    name: string;
    description: string;
    systemPrompt: string;
    model: string;
    hasWorkspace: boolean;
    path: string;
    provider: string;
  }): AgentRecord {
    const db = getDatabase();
    const id = randomUUID();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO agents (id, name, description, system_prompt, model, has_workspace, path, status, created_at, provider)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [id, params.name, params.description, params.systemPrompt, params.model, params.hasWorkspace ? 1 : 0, params.path, now, params.provider]
    );

    return {
      id,
      name: params.name,
      description: params.description,
      systemPrompt: params.systemPrompt,
      model: params.model,
      hasWorkspace: params.hasWorkspace,
      path: params.path,
      status: 'active',
      createdAt: now,
      provider: params.provider,
      isDefault: false,
    };
  },

  /** Insert a default (pre-installed) agent with is_default=1. */
  createDefaultAgent(params: {
    name: string;
    description: string;
    systemPrompt: string;
    model: string;
    hasWorkspace: boolean;
    path: string;
    provider: string;
  }): AgentRecord {
    const db = getDatabase();
    const id = randomUUID();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO agents (id, name, description, system_prompt, model, has_workspace, path, status, created_at, provider, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1)`,
      [id, params.name, params.description, params.systemPrompt, params.model, params.hasWorkspace ? 1 : 0, params.path, now, params.provider]
    );

    return {
      id,
      name: params.name,
      description: params.description,
      systemPrompt: params.systemPrompt,
      model: params.model,
      hasWorkspace: params.hasWorkspace,
      path: params.path,
      status: 'active',
      createdAt: now,
      provider: params.provider,
      isDefault: true,
    };
  },

  /** Find an agent by name. Returns null if not found. */
  findByName(name: string): AgentRecord | null {
    const db = getDatabase();
    const row = db.query<AgentRow, [string]>(
      'SELECT * FROM agents WHERE name = ?'
    ).get(name);
    return row ? rowToRecord(row) : null;
  },

  /** Find an agent by id. Returns null if not found. */
  findById(id: string): AgentRecord | null {
    const db = getDatabase();
    const row = db.query<AgentRow, [string]>(
      'SELECT * FROM agents WHERE id = ?'
    ).get(id);
    return row ? rowToRecord(row) : null;
  },

  /** Find multiple agents by ids. Returns a Map keyed by id for O(1) lookup. Deduplicates ids before querying. */
  findByIds(ids: string[]): Map<string, AgentRecord> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return new Map();
    const db = getDatabase();
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = db.query<AgentRow, string[]>(
      `SELECT * FROM agents WHERE id IN (${placeholders})`
    ).all(...uniqueIds);
    const map = new Map<string, AgentRecord>();
    for (const row of rows) {
      map.set(row.id, rowToRecord(row));
    }
    return map;
  },

  /**
   * Return all agents. For each agent whose path no longer exists on disk,
   * mark status='broken' in the DB before returning it (but do NOT delete the row).
   */
  findAll(): AgentRecord[] {
    const db = getDatabase();
    const rows = db.query<AgentRow, []>('SELECT * FROM agents ORDER BY created_at ASC').all();

    const records: AgentRecord[] = [];

    for (const row of rows) {
      if (!row.is_default) {
        const exists = existsSync(row.path);
        if (!exists && row.status !== 'broken') {
          db.run('UPDATE agents SET status = ? WHERE id = ?', ['broken', row.id]);
          row.status = 'broken';
        }
      }
      records.push(rowToRecord(row));
    }

    return records;
  },

  /** Update status field only. */
  setStatus(id: string, status: 'active' | 'broken'): void {
    const db = getDatabase();
    db.run('UPDATE agents SET status = ? WHERE id = ?', [status, id]);
  },

  /** Delete an agent row. Also cascades to conversations + messages. Throws if is_default=1. */
  delete(id: string): void {
    const db = getDatabase();
    const row = db.query<{ is_default: number }, [string]>('SELECT is_default FROM agents WHERE id = ?').get(id);
    if (row && row.is_default === 1) {
      throw new Error('No se puede borrar un agente por defecto');
    }
    db.run('DELETE FROM agents WHERE id = ?', [id]);
  },

  /** Update system_prompt and enhance_status after the enhance background job completes. */
  updateSystemPrompt(id: string, systemPrompt: string, enhanceStatus: 'done' | 'static' | 'failed'): void {
    const db = getDatabase();
    db.run(
      'UPDATE agents SET system_prompt = ?, enhance_status = ? WHERE id = ?',
      [systemPrompt, enhanceStatus, id]
    );
  },

  /** Update agent fields (name, description, system_prompt). Throws if is_default=1 and those fields are modified. */
  updateAgent(id: string, params: { name?: string; description?: string; systemPrompt?: string }): AgentRecord {
    const db = getDatabase();
    const row = db.query<AgentRow, [string]>('SELECT * FROM agents WHERE id = ?').get(id);
    if (!row) throw new Error('Agente no encontrado');

    if (row.is_default === 1 && (params.name || params.description || params.systemPrompt)) {
      throw new Error('No se puede modificar un agente por defecto');
    }

    const sets: string[] = [];
    const values: (string | number)[] = [];

    if (params.name !== undefined) {
      sets.push('name = ?');
      values.push(params.name);
    }
    if (params.description !== undefined) {
      sets.push('description = ?');
      values.push(params.description);
    }
    if (params.systemPrompt !== undefined) {
      sets.push('system_prompt = ?');
      values.push(params.systemPrompt);
    }

    if (sets.length === 0) return rowToRecord(row);

    values.push(id);
    db.run(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`, values);

    const updated = db.query<AgentRow, [string]>('SELECT * FROM agents WHERE id = ?').get(id);
    return rowToRecord(updated!);
  },
};
