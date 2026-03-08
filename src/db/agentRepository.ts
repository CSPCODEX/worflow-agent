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
}

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
  }): AgentRecord {
    const db = getDatabase();
    const id = randomUUID();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO agents (id, name, description, system_prompt, model, has_workspace, path, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [id, params.name, params.description, params.systemPrompt, params.model, params.hasWorkspace ? 1 : 0, params.path, now]
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
    };
  },

  /** Find an agent by name. Returns null if not found. */
  findByName(name: string): AgentRecord | null {
    const db = getDatabase();
    const row = db.query<AgentRow, [string]>(
      'SELECT * FROM agents WHERE name = ?'
    ).get([name]);
    return row ? rowToRecord(row) : null;
  },

  /** Find an agent by id. Returns null if not found. */
  findById(id: string): AgentRecord | null {
    const db = getDatabase();
    const row = db.query<AgentRow, [string]>(
      'SELECT * FROM agents WHERE id = ?'
    ).get([id]);
    return row ? rowToRecord(row) : null;
  },

  /**
   * Return all agents. For each agent whose path no longer exists on disk,
   * mark status='broken' in the DB before returning it (but do NOT delete the row).
   */
  findAll(): AgentRecord[] {
    const db = getDatabase();
    const rows = db.query<AgentRow, []>('SELECT * FROM agents ORDER BY created_at ASC').all([]);

    const records: AgentRecord[] = [];

    for (const row of rows) {
      const exists = existsSync(row.path);
      if (!exists && row.status !== 'broken') {
        db.run('UPDATE agents SET status = ? WHERE id = ?', ['broken', row.id]);
        row.status = 'broken';
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

  /** Delete an agent row. Also cascades to conversations + messages. */
  delete(id: string): void {
    const db = getDatabase();
    db.run('DELETE FROM agents WHERE id = ?', [id]);
  },
};
