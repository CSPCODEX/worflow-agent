import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

export type PipelineRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';
export type StepRunStatus = 'pending' | 'running' | 'completed' | 'failed';

const STEP_TRANSITIONS: Record<StepRunStatus, StepRunStatus[]> = {
  pending: ['running'],
  running: ['completed', 'failed'],
  completed: [],
  failed: [],
};

function isValidStepTransition(current: StepRunStatus, next: StepRunStatus): boolean {
  return STEP_TRANSITIONS[current]?.includes(next) ?? false;
}

export interface PipelineRunRow {
  id: string;
  pipeline_id: string;
  status: string;
  variables: string;
  final_output: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface PipelineStepRunRow {
  id: string;
  run_id: string;
  step_id: string;
  step_order: number;
  agent_name: string;
  status: string;
  input_resolved: string | null;
  output: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface PipelineRunRecord {
  id: string;
  pipelineId: string;
  status: PipelineRunStatus;
  variables: Record<string, string>;
  finalOutput: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface PipelineStepRunRecord {
  id: string;
  runId: string;
  stepId: string;
  stepOrder: number;
  agentName: string;
  status: StepRunStatus;
  inputResolved: string | null;
  output: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface PipelineRunWithSteps extends PipelineRunRecord {
  stepRuns: PipelineStepRunRecord[];
}

function rowToRecord(row: PipelineRunRow): PipelineRunRecord {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    status: row.status as PipelineRunStatus,
    variables: JSON.parse(row.variables ?? '{}'),
    finalOutput: row.final_output,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

function stepRowToRecord(row: PipelineStepRunRow): PipelineStepRunRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    stepOrder: row.step_order,
    agentName: row.agent_name,
    status: row.status as StepRunStatus,
    inputResolved: row.input_resolved,
    output: row.output,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export const pipelineRunRepository = {
  createRun(db: Database, pipelineId: string, variables?: Record<string, string>): { id: string } {
    const id = randomUUID();
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO pipeline_runs (id, pipeline_id, status, variables, created_at)
       VALUES (?, ?, 'pending', ?, ?)`,
      [id, pipelineId, JSON.stringify(variables ?? {}), now]
    );

    return { id };
  },

  getRun(db: Database, id: string): PipelineRunWithSteps | null {
    const row = db.query<PipelineRunRow, [string]>('SELECT * FROM pipeline_runs WHERE id = ?').get([id]);
    if (!row) return null;

    const stepRuns = db.query<PipelineStepRunRow, [string]>(
      'SELECT * FROM pipeline_step_runs WHERE run_id = ? ORDER BY step_order ASC'
    ).all([id]);

    return {
      ...rowToRecord(row),
      stepRuns: stepRuns.map(stepRowToRecord),
    };
  },

  listRuns(db: Database, pipelineId: string, limit = 20, offset = 0): PipelineRunRecord[] {
    const rows = db.query<PipelineRunRow, [string, number, number]>(
      'SELECT * FROM pipeline_runs WHERE pipeline_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all([pipelineId, limit, offset]);

    return rows.map(rowToRecord);
  },

  countRuns(db: Database, pipelineId: string): number {
    const row = db.query<{ count: number }, string>(
      'SELECT COUNT(*) as count FROM pipeline_runs WHERE pipeline_id = ?'
    ).get(pipelineId);
    return row?.count ?? 0;
  },

  updateRunStatus(db: Database, id: string, status: PipelineRunStatus, error?: string): void {
    const now = new Date().toISOString();
    if (status === 'running') {
      db.run('UPDATE pipeline_runs SET status = ?, started_at = ? WHERE id = ?', [status, now, id]);
    } else if (status === 'completed' || status === 'failed') {
      db.run('UPDATE pipeline_runs SET status = ?, completed_at = ?, error = ? WHERE id = ?', [status, now, error ?? null, id]);
    } else {
      db.run('UPDATE pipeline_runs SET status = ? WHERE id = ?', [status, id]);
    }
  },

  createStepRun(db: Database, runId: string, stepId: string, stepOrder: number, agentName: string): { id: string } {
    const id = randomUUID();
    db.run(
      `INSERT INTO pipeline_step_runs (id, run_id, step_id, step_order, agent_name, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [id, runId, stepId, stepOrder, agentName]
    );
    return { id };
  },

  updateStepRun(db: Database, id: string, status: StepRunStatus, output?: string, error?: string): void {
    const row = db.query<{ status: string }, [string]>('SELECT status FROM pipeline_step_runs WHERE id = ?').get([id]);
    if (row && !isValidStepTransition(row.status as StepRunStatus, status)) {
      throw new Error(`Invalid step status transition: ${row.status} -> ${status}`);
    }
    const now = new Date().toISOString();
    if (status === 'running') {
      db.run('UPDATE pipeline_step_runs SET status = ?, started_at = ? WHERE id = ?', [status, now, id]);
    } else if (status === 'completed' || status === 'failed') {
      db.run('UPDATE pipeline_step_runs SET status = ?, completed_at = ?, output = ?, error = ? WHERE id = ?', [status, now, output ?? null, error ?? null, id]);
    } else {
      db.run('UPDATE pipeline_step_runs SET status = ? WHERE id = ?', [status, id]);
    }
  },
};
