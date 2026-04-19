import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

export interface PipelineTemplateRow {
  id: string;
  name: string;
  description: string;
  category: string;
  variables: string;
  steps: string;
  is_builtin: number;
  created_at: string;
  recommended_model: string | null;
}

export interface PipelineTemplateVariable {
  name: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
}

export interface PipelineTemplateStep {
  order: number;
  name: string;
  agentRoleHint: string;
  inputTemplate: string;
  description: string;
}

export interface PipelineTemplateRecord {
  id: string;
  name: string;
  description: string;
  category: string;
  variables: PipelineTemplateVariable[];
  steps: PipelineTemplateStep[];
  isBuiltin: boolean;
  createdAt: string;
  recommendedModel: string | null;
}

function rowToRecord(row: PipelineTemplateRow): PipelineTemplateRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    variables: JSON.parse(row.variables ?? '[]'),
    steps: JSON.parse(row.steps ?? '[]'),
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
    recommendedModel: row.recommended_model ?? null,
  };
}

export const pipelineTemplateRepository = {
  listTemplates(db: Database): (PipelineTemplateRecord & { stepCount: number })[] {
    const rows = db.query<PipelineTemplateRow, []>('SELECT * FROM pipeline_templates ORDER BY created_at ASC').all([]);

    return rows.map((row) => {
      const steps = JSON.parse(row.steps || '[]');
      return {
        ...rowToRecord(row),
        stepCount: Array.isArray(steps) ? steps.length : 0,
      };
    });
  },

  getTemplate(db: Database, id: string): PipelineTemplateRecord | null {
    const row = db.query<PipelineTemplateRow, [string]>('SELECT * FROM pipeline_templates WHERE id = ?').get([id]);
    return row ? rowToRecord(row) : null;
  },

  createTemplate(db: Database, params: {
    name: string;
    description?: string;
    category?: string;
    variables?: string[];
    steps?: string[];
    isBuiltin?: boolean;
  }): { id: string } {
    const id = randomUUID();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO pipeline_templates (id, name, description, category, variables, steps, is_builtin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.name,
        params.description ?? '',
        params.category ?? 'custom',
        JSON.stringify(params.variables ?? []),
        JSON.stringify(params.steps ?? []),
        params.isBuiltin ? 1 : 0,
        now,
      ]
    );

    return { id };
  },

  deleteTemplate(db: Database, id: string): void {
    db.run('DELETE FROM pipeline_templates WHERE id = ? AND is_builtin = 0', [id]);
  },
};
