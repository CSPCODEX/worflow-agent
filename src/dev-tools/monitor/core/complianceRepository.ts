// ============================================================
// complianceRepository.ts -- Queries SQLite para compliance
// Solo imports de bun:sqlite y tipos internos del modulo.
// ============================================================

import type { Database } from 'bun:sqlite';
import type { ComplianceScoreEntry, RejectionRecord } from './types';
import type {
  ComplianceScoreIPC,
  RejectionRecordIPC,
  RejectionPatternAggregate,
  GetComplianceScoresParams,
  GetRejectionPatternsParams,
  GetRejectionPatternsResult,
  GetComplianceScoresResult,
} from '../../../types/ipc';

// ── Filas raw de SQLite ──

interface ComplianceScoreRow {
  id: number;
  feature_slug: string;
  score: number;
  files_spec: number;
  files_ok: number;
  files_viol: number;
  branch: string;
  base_ref: string;
  recorded_at: string;
}

interface RejectionRecordRow {
  id: number;
  feature_slug: string;
  agent_at_fault: string;
  instruction_violated: string;
  instruction_source: string;
  failure_type: string;
  recorded_at: string;
}

// ── Inserciones ──

export function insertComplianceScore(db: Database, entry: ComplianceScoreEntry): void {
  const stmt = db.prepare(`
    INSERT INTO compliance_scores
      (feature_slug, score, files_spec, files_ok, files_viol, branch, base_ref, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    entry.featureSlug,
    entry.score,
    entry.filesSpec,
    entry.filesOk,
    entry.filesViol,
    entry.branch,
    entry.baseRef,
    entry.recordedAt,
  );
}

export function insertRejectionRecord(db: Database, record: RejectionRecord): void {
  // INSERT OR IGNORE para no duplicar si el monitor parsea el mismo archivo varias veces
  // La unicidad se basa en (feature_slug, agent_at_fault, instruction_violated)
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO rejection_records
      (feature_slug, agent_at_fault, instruction_violated, instruction_source, failure_type, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    record.featureSlug,
    record.agentAtFault,
    record.instructionViolated,
    record.instructionSource,
    record.failureType,
    record.recordedAt,
  );
}

// ── Queries ──

export function queryComplianceScores(
  db: Database,
  params: GetComplianceScoresParams
): GetComplianceScoresResult {
  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;

  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (params.featureSlug) {
    conditions.push('feature_slug = ?');
    args.push(params.featureSlug);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = db.query<{ total: number }, (string | number)[]>(
    `SELECT COUNT(*) as total FROM compliance_scores ${where}`
  ).get(...args);

  const rows = db.prepare<ComplianceScoreRow, (string | number)[]>(
    `SELECT * FROM compliance_scores ${where} ORDER BY recorded_at DESC LIMIT ? OFFSET ?`
  ).all(...args, limit, offset);

  return {
    scores: rows.map(rowToComplianceScoreIPC),
    totalCount: countRow?.total ?? 0,
  };
}

export function queryRejectionPatterns(
  db: Database,
  params: GetRejectionPatternsParams
): GetRejectionPatternsResult {
  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;

  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (params.agentId) {
    conditions.push('agent_at_fault = ?');
    args.push(params.agentId);
  }
  if (params.featureSlug) {
    conditions.push('feature_slug = ?');
    args.push(params.featureSlug);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = db.query<{ total: number }, (string | number)[]>(
    `SELECT COUNT(*) as total FROM rejection_records ${where}`
  ).get(...args);

  const rows = db.prepare<RejectionRecordRow, (string | number)[]>(
    `SELECT * FROM rejection_records ${where} ORDER BY recorded_at DESC LIMIT ? OFFSET ?`
  ).all(...args, limit, offset);

  // Calcular agregados sobre el mismo subset filtrado — evita full table scan cuando hay filtros
  const aggRows = db.prepare<RejectionRecordRow, (string | number)[]>(
    `SELECT * FROM rejection_records ${where} ORDER BY recorded_at DESC`
  ).all(...args);

  return {
    records: rows.map(rowToRejectionRecordIPC),
    totalCount: countRow?.total ?? 0,
    aggregates: buildRejectionAggregates(aggRows),
  };
}

function rowToComplianceScoreIPC(row: ComplianceScoreRow): ComplianceScoreIPC {
  return {
    id: row.id,
    featureSlug: row.feature_slug,
    score: row.score,
    filesSpec: row.files_spec,
    filesOk: row.files_ok,
    filesViol: row.files_viol,
    branch: row.branch,
    baseRef: row.base_ref,
    recordedAt: row.recorded_at,
  };
}

function rowToRejectionRecordIPC(row: RejectionRecordRow): RejectionRecordIPC {
  return {
    id: row.id,
    featureSlug: row.feature_slug,
    agentAtFault: row.agent_at_fault,
    instructionViolated: row.instruction_violated,
    instructionSource: row.instruction_source as RejectionRecordIPC['instructionSource'],
    failureType: row.failure_type as RejectionRecordIPC['failureType'],
    recordedAt: row.recorded_at,
  };
}

export function buildRejectionAggregates(rows: RejectionRecordRow[]): RejectionPatternAggregate[] {
  // Agrupar por agente
  const byAgent = new Map<string, RejectionRecordRow[]>();
  for (const row of rows) {
    const bucket = byAgent.get(row.agent_at_fault);
    if (bucket) bucket.push(row);
    else byAgent.set(row.agent_at_fault, [row]);
  }

  const aggregates: RejectionPatternAggregate[] = [];
  for (const [agentId, agentRows] of byAgent.entries()) {
    const byFailureType = { patron_conocido: 0, instruccion_ambigua: 0, instruccion_ausente: 0 };
    const bySource = { 'CLAUDE.md': 0, agent_system_prompt: 0, handoff_anterior: 0 };
    const violationCount = new Map<string, number>();

    for (const r of agentRows) {
      const ftMap = byFailureType as Record<string, number>;
      if (r.failure_type in ftMap) {
        ftMap[r.failure_type] = (ftMap[r.failure_type] ?? 0) + 1;
      }
      const srcMap = bySource as Record<string, number>;
      if (r.instruction_source in srcMap) {
        srcMap[r.instruction_source] = (srcMap[r.instruction_source] ?? 0) + 1;
      }
      violationCount.set(r.instruction_violated, (violationCount.get(r.instruction_violated) ?? 0) + 1);
    }

    let mostFrequentViolation: string | null = null;
    let maxCount = 0;
    for (const [violation, count] of violationCount.entries()) {
      if (count > maxCount) { maxCount = count; mostFrequentViolation = violation; }
    }

    aggregates.push({
      agentId,
      totalRejections: agentRows.length,
      byFailureType,
      bySource,
      mostFrequentViolation,
    });
  }

  return aggregates.sort((a, b) => b.totalRejections - a.totalRejections);
}
