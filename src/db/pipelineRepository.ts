import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

export interface PipelineStepRow {
  id: string;
  pipeline_id: string;
  step_order: number;
  name: string;
  agent_id: string;
  input_template: string;
  created_at: string;
}

export interface PipelineRow {
  id: string;
  name: string;
  description: string;
  template_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PipelineStepRecord {
  id: string;
  pipelineId: string;
  stepOrder: number;
  name: string;
  agentId: string;
  inputTemplate: string;
  createdAt: string;
}

export interface PipelineRecord {
  id: string;
  name: string;
  description: string;
  templateId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineWithMeta extends PipelineRecord {
  stepCount: number;
  lastRun: string | null;
}

function rowToRecord(row: PipelineRow): PipelineRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    templateId: row.template_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stepRowToRecord(row: PipelineStepRow): PipelineStepRecord {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    stepOrder: row.step_order,
    name: row.name,
    agentId: row.agent_id,
    inputTemplate: row.input_template,
    createdAt: row.created_at,
  };
}

export const pipelineRepository = {
  listPipelines(db: Database): PipelineWithMeta[] {
    const rows = db.query<{ id: string; name: string; description: string; template_id: string | null; status: string; created_at: string; updated_at: string; stepCount: number; lastRun: string | null }, []>(`
      SELECT p.*,
             COUNT(ps.id) as stepCount,
             (SELECT MAX(created_at) FROM pipeline_runs WHERE pipeline_id = p.id) as lastRun
      FROM pipelines p
      LEFT JOIN pipeline_steps ps ON ps.pipeline_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at ASC
    `).all([]);

    return rows.map((row) => ({
      ...rowToRecord(row),
      stepCount: row.stepCount,
      lastRun: row.lastRun,
    }));
  },

  getPipeline(db: Database, id: string): (PipelineRecord & { steps: PipelineStepRecord[] }) | null {
    const row = db.query<PipelineRow, [string]>('SELECT * FROM pipelines WHERE id = ?').get([id]);
    if (!row) return null;

    const steps = db.query<PipelineStepRow, [string]>(
      'SELECT * FROM pipeline_steps WHERE pipeline_id = ? ORDER BY step_order ASC'
    ).all([id]);

    return {
      ...rowToRecord(row),
      steps: steps.map(stepRowToRecord),
    };
  },

  createPipeline(db: Database, params: {
    name: string;
    description?: string;
    templateId?: string | null;
    steps?: Array<{ name: string; agentId: string; inputTemplate: string }>;
  }): { id: string } {
    const create = db.transaction(() => {
      const id = randomUUID();
      const now = new Date().toISOString();

      db.run(
        `INSERT INTO pipelines (id, name, description, template_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        [id, params.name, params.description ?? '', params.templateId ?? null, now, now]
      );

      if (params.steps) {
        for (let i = 0; i < params.steps.length; i++) {
          const step = params.steps[i];
          db.run(
            `INSERT INTO pipeline_steps (id, pipeline_id, step_order, name, agent_id, input_template, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [randomUUID(), id, i + 1, step.name, step.agentId, step.inputTemplate, now]
          );
        }
      }

      return id;
    });

    return { id: create() };
  },

  updatePipeline(db: Database, id: string, params: {
    name?: string;
    description?: string;
    status?: string;
    steps?: Array<{ name: string; agentId: string; inputTemplate: string }>;
  }): void {
    const update = db.transaction(() => {
      const now = new Date().toISOString();

      const sets: string[] = ['updated_at = ?'];
      const values: any[] = [now];

      if (params.name !== undefined) {
        sets.push('name = ?');
        values.push(params.name);
      }
      if (params.description !== undefined) {
        sets.push('description = ?');
        values.push(params.description);
      }
      if (params.status !== undefined) {
        sets.push('status = ?');
        values.push(params.status);
      }

      values.push(id);
      db.run(`UPDATE pipelines SET ${sets.join(', ')} WHERE id = ?`, values);

      if (params.steps !== undefined) {
        db.run('DELETE FROM pipeline_steps WHERE pipeline_id = ?', [id]);
        for (let i = 0; i < params.steps.length; i++) {
          const step = params.steps[i];
          db.run(
            `INSERT INTO pipeline_steps (id, pipeline_id, step_order, name, agent_id, input_template, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [randomUUID(), id, i + 1, step.name, step.agentId, step.inputTemplate, now]
          );
        }
      }
    });

    update();
  },

  deletePipeline(db: Database, id: string): void {
    db.run('DELETE FROM pipelines WHERE id = ?', [id]);
  },
};
