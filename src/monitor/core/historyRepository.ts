// ============================================================
// historyRepository.ts — Queries tipadas para el historial
// Solo imports de bun:sqlite y tipos internos del modulo.
// ============================================================

import type { Database } from 'bun:sqlite';
import type {
  HistoryEvent,
  AgentTrend,
  HistoryQuery,
  HistoryQueryResult,
  AgentId,
  FeatureRecord,
  BugRecord,
  FeatureState,
  BugState,
  AgentMetrics,
} from './types';
import type { DetectedChanges } from './changeDetector';

// Fila raw de pipeline_events (mapeada directamente desde SQLite)
interface EventRow {
  id: number;
  event_type: string;
  item_type: string;
  item_slug: string;
  item_title: string;
  from_value: string | null;
  to_value: string;
  agent_id: string | null;
  recorded_at: string;
}

// Fila raw de agent_metrics_history
interface MetricsRow {
  id: number;
  agent_id: string;
  item_type: string;
  item_slug: string;
  rework: number | null;
  iteraciones: number | null;
  confianza: string | null;
  gaps_declarados: number | null;
  recorded_at: string;
}

// Fila para la query de ultimo estado por item
interface LastStateRow {
  item_slug: string;
  item_type: string;
  to_value: string;
}

// Fila para la query de handoffs completados por item
interface HandoffRow {
  item_slug: string;
  to_value: string;
}

// Fila raw de agent_metrics_history para seedeo inicial
interface SeedMetricsRow {
  agent_id: string;
  item_slug: string;
  item_type: string;
  rework: number | null;
  iteraciones: number | null;
  confianza: string | null;
  gaps_declarados: number | null;
}

/**
 * Carga el ultimo estado conocido de features y bugs desde pipeline_events
 * y las metricas mas recientes desde agent_metrics_history.
 *
 * Devuelve un objeto con `features` y `bugs` suficiente para que
 * `detectChanges(seeded, current)` no genere eventos falsos al arrancar.
 *
 * Si la DB esta vacia (primer arranque real), devuelve arrays vacios
 * - mismo comportamiento que cachedSnapshot = null (correcto para bootstrap).
 */
export function loadLastKnownStates(db: Database): Pick<import('./types').PipelineSnapshot, 'features' | 'bugs'> {
  // --- 1. Ultimo estado por item (feature y bug) ---
  // Usamos MAX(id) como proxy del registro mas reciente (id AUTOINCREMENT).
  const lastStatesStmt = db.prepare<LastStateRow, []>(`
    SELECT pe.item_slug, pe.item_type, pe.to_value
    FROM pipeline_events pe
    INNER JOIN (
      SELECT item_slug, item_type, MAX(id) as max_id
      FROM pipeline_events
      WHERE event_type IN ('feature_state_changed', 'bug_state_changed')
      GROUP BY item_slug, item_type
    ) latest ON pe.id = latest.max_id
  `);
  const lastStates = lastStatesStmt.all();

  // --- 2. Handoffs completados por feature (todos los handoffs que alguna vez fueron true) ---
  const handoffsStmt = db.prepare<HandoffRow, []>(`
    SELECT DISTINCT item_slug, to_value
    FROM pipeline_events
    WHERE event_type = 'handoff_completed'
      AND item_type = 'feature'
  `);
  const handoffRows = handoffsStmt.all();

  // Agrupar handoffs por feature slug
  const handoffsBySlug = new Map<string, string[]>();
  for (const row of handoffRows) {
    const list = handoffsBySlug.get(row.item_slug);
    if (list) list.push(row.to_value);
    else handoffsBySlug.set(row.item_slug, [row.to_value]);
  }

  // --- 3. Metricas mas recientes por (agent_id, item_slug, item_type) ---
  const metricsStmt = db.prepare<SeedMetricsRow, []>(`
    SELECT amh.agent_id, amh.item_slug, amh.item_type,
           amh.rework, amh.iteraciones, amh.confianza, amh.gaps_declarados
    FROM agent_metrics_history amh
    INNER JOIN (
      SELECT agent_id, item_slug, item_type, MAX(id) as max_id
      FROM agent_metrics_history
      GROUP BY agent_id, item_slug, item_type
    ) latest ON amh.id = latest.max_id
  `);
  const metricsRows = metricsStmt.all();

  // Agrupar metricas por item_slug para rapida busqueda
  const metricsBySlug = new Map<string, SeedMetricsRow[]>();
  for (const row of metricsRows) {
    const list = metricsBySlug.get(row.item_slug);
    if (list) list.push(row);
    else metricsBySlug.set(row.item_slug, [row]);
  }

  // --- 4. Construir features y bugs sinteticos ---
  const features: FeatureRecord[] = [];
  const bugs: BugRecord[] = [];

  for (const stateRow of lastStates) {
    const slug = stateRow.item_slug;
    const itemMetricsRows = metricsBySlug.get(slug) ?? [];

    if (stateRow.item_type === 'feature') {
      const completedHandoffKeys = handoffsBySlug.get(slug) ?? [];
      // Reconstruir handoffs completados: cada key es "from->to"
      const handoffs = completedHandoffKeys.map((key) => {
        const parts = key.split('->');
        return {
          from: (parts[0] ?? '') as AgentId,
          to: (parts[1] ?? '') as AgentId,
          completed: true,
          hasRework: false,
        };
      });

      const metrics: AgentMetrics[] = itemMetricsRows
        .filter((m) => m.item_type === 'feature')
        .map((m) => ({
          agentId: m.agent_id as AgentId,
          archivosLeidos: null,
          archivosCreados: null,
          archivosModificados: null,
          rework: m.rework === null ? null : m.rework === 1,
          iteraciones: m.iteraciones,
          confianza: (m.confianza as AgentMetrics['confianza']) ?? null,
          gapsDeclarados: m.gaps_declarados,
        }));

      features.push({
        slug,
        title: '',
        state: stateRow.to_value as FeatureState,
        branch: '',
        openedAt: '',
        handoffs,
        metrics,
        behaviorMetrics: {},
        filePath: '',
      });
    } else if (stateRow.item_type === 'bug') {
      // Para bugs, item_slug es "id-slug" (ej: "001-validacion-encoding")
      const idMatch = slug.match(/^(\d+)-/);
      const bugId: string = idMatch ? (idMatch[1] ?? '') : '';
      const bugSlug: string = idMatch ? slug.slice(idMatch[0]?.length ?? 0) : slug;

      const agentMetrics: Partial<Record<AgentId, AgentMetrics>> = {};
      for (const m of itemMetricsRows.filter((r) => r.item_type === 'bug')) {
        agentMetrics[m.agent_id as AgentId] = {
          agentId: m.agent_id as AgentId,
          archivosLeidos: null,
          archivosCreados: null,
          archivosModificados: null,
          rework: m.rework === null ? null : m.rework === 1,
          iteraciones: m.iteraciones,
          confianza: (m.confianza as AgentMetrics['confianza']) ?? null,
          gapsDeclarados: m.gaps_declarados,
        };
      }

      bugs.push({
        id: bugId,
        slug: bugSlug,
        title: '',
        state: stateRow.to_value as BugState,
        openedAt: '',
        hasSecurityImplication: false,
        agentMetrics,
        filePath: '',
      });
    }
  }

  return { features, bugs };
}

function rowToHistoryEvent(row: EventRow): HistoryEvent {
  return {
    id: row.id,
    eventType: row.event_type as HistoryEvent['eventType'],
    itemType: row.item_type as 'feature' | 'bug',
    itemSlug: row.item_slug,
    itemTitle: row.item_title,
    fromValue: row.from_value,
    toValue: row.to_value,
    agentId: row.agent_id as AgentId | null,
    recordedAt: row.recorded_at,
  };
}

export function persistChanges(db: Database, changes: DetectedChanges): void {
  const insertEvent = db.prepare(`
    INSERT INTO pipeline_events
      (event_type, item_type, item_slug, item_title, from_value, to_value, agent_id, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMetrics = db.prepare(`
    INSERT INTO agent_metrics_history
      (agent_id, item_type, item_slug, rework, iteraciones, confianza, gaps_declarados, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertBehavior = db.prepare(`
    INSERT OR IGNORE INTO agent_behavior_history
      (agent_id, item_type, item_slug,
       checklist_total, checklist_checked,
       structure_score_num, structure_score_den,
       refs_total, refs_valid, memory_read,
       recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Transaccion para atomicidad: todos los eventos y metricas se insertan juntos o ninguno
  const insertAll = db.transaction(() => {
    for (const e of changes.events) {
      insertEvent.run(
        e.eventType,
        e.itemType,
        e.itemSlug,
        e.itemTitle,
        e.fromValue,
        e.toValue,
        e.agentId,
        e.recordedAt
      );
    }
    for (const m of changes.newMetrics) {
      insertMetrics.run(
        m.agentId,
        m.itemType,
        m.itemSlug,
        m.rework !== null ? (m.rework ? 1 : 0) : null,
        m.iteraciones,
        m.confianza,
        m.gapsDeclarados,
        m.recordedAt
      );
    }
    for (const b of changes.newBehavior) {
      insertBehavior.run(
        b.agentId, b.itemType, b.itemSlug,
        b.checklistTotal, b.checklistChecked,
        b.structureScoreNum, b.structureScoreDen,
        b.refsTotal, b.refsValid,
        b.memoryRead !== null ? (b.memoryRead ? 1 : 0) : null,
        b.recordedAt
      );
    }
  });

  insertAll();
}

export function queryHistory(db: Database, query: HistoryQuery): HistoryQueryResult {
  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;

  // Construir WHERE dinamico con prepared statements seguros (sin interpolacion de datos)
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (query.itemSlug) {
    conditions.push('item_slug = ?');
    params.push(query.itemSlug);
  }
  if (query.itemType) {
    conditions.push('item_type = ?');
    params.push(query.itemType);
  }
  if (query.agentId) {
    conditions.push('agent_id = ?');
    params.push(query.agentId);
  }
  if (query.eventType) {
    conditions.push('event_type = ?');
    params.push(query.eventType);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countStmt = db.prepare<{ total: number }, (string | number)[]>(
    `SELECT COUNT(*) as total FROM pipeline_events ${where}`
  );
  const countRow = countStmt.get(...params);

  const rowsStmt = db.prepare<EventRow, (string | number)[]>(
    `SELECT * FROM pipeline_events ${where} ORDER BY recorded_at DESC LIMIT ? OFFSET ?`
  );
  const rows = rowsStmt.all(...params, limit, offset);

  return {
    events: rows.map(rowToHistoryEvent),
    totalCount: countRow?.total ?? 0,
  };
}

export function queryAgentTrends(
  db: Database,
  currentSummaries: Array<{
    agentId: AgentId;
    reworkRate: number;
    avgIterations: number;
    avgConfidence: number;
  }>
): AgentTrend[] {
  if (currentSummaries.length === 0) return [];

  // Una sola query para todos los agentes — evita N round-trips a SQLite
  const agentIds = currentSummaries.map((s) => s.agentId);
  const placeholders = agentIds.map(() => '?').join(', ');
  const allRows = db.query<MetricsRow, string[]>(
    `SELECT * FROM agent_metrics_history WHERE agent_id IN (${placeholders})`
  ).all(...agentIds);

  // Agrupar filas por agentId en un Map para O(1) lookup
  const rowsByAgent = new Map<string, MetricsRow[]>();
  for (const row of allRows) {
    const bucket = rowsByAgent.get(row.agent_id);
    if (bucket) bucket.push(row);
    else rowsByAgent.set(row.agent_id, [row]);
  }

  return currentSummaries.map((curr) => {
    const rows = rowsByAgent.get(curr.agentId) ?? [];

    if (rows.length === 0) {
      return {
        agentId: curr.agentId,
        historicReworkRate: 0,
        historicAvgIterations: 0,
        historicAvgConfidence: 0,
        totalHistoricSamples: 0,
        reworkTrend: 'sin_datos' as const,
      };
    }

    const total = rows.length;
    const reworkCount = rows.filter((r) => r.rework === 1).length;
    const historicReworkRate = Math.round((reworkCount / total) * 100) / 100;

    const iterValues = rows
      .map((r) => r.iteraciones)
      .filter((v): v is number => v !== null);
    const historicAvgIterations =
      iterValues.length > 0
        ? Math.round(
            (iterValues.reduce((a, b) => a + b, 0) / iterValues.length) * 100
          ) / 100
        : 0;

    const confMap = { alta: 3, media: 2, baja: 1 } as const;
    const confValues = rows
      .map((r) => r.confianza)
      .filter((v): v is 'alta' | 'media' | 'baja' => v === 'alta' || v === 'media' || v === 'baja')
      .map((v) => confMap[v]);
    const historicAvgConfidence =
      confValues.length > 0
        ? Math.round(
            (confValues.reduce((a, b) => a + b, 0) / confValues.length) * 100
          ) / 100
        : 0;

    // Tendencia de rework: comparar tasa actual vs historica
    const THRESHOLD = 0.05; // 5% de diferencia es significativa
    let reworkTrend: AgentTrend['reworkTrend'] = 'estable';
    if (total >= 3) {
      if (curr.reworkRate > historicReworkRate + THRESHOLD) reworkTrend = 'empeorando';
      else if (curr.reworkRate < historicReworkRate - THRESHOLD) reworkTrend = 'mejorando';
    } else {
      reworkTrend = 'sin_datos';
    }

    return {
      agentId: curr.agentId,
      historicReworkRate,
      historicAvgIterations,
      historicAvgConfidence,
      totalHistoricSamples: total,
      reworkTrend,
    };
  });
}
