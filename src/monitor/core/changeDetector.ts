// ============================================================
// changeDetector.ts — Funcion pura de deteccion de cambios
// Compara dos PipelineSnapshot y produce eventos a persistir.
// Sin efectos secundarios — no toca la DB.
// ============================================================

import type {
  PipelineSnapshot,
  AgentId,
  HistoryEvent,
  AgentBehaviorEntry,
} from './types';

export interface DetectedChanges {
  events: Omit<HistoryEvent, 'id'>[];
  newMetrics: Array<{
    agentId: AgentId;
    itemType: 'feature' | 'bug';
    itemSlug: string;
    rework: boolean | null;
    iteraciones: number | null;
    confianza: 'alta' | 'media' | 'baja' | null;
    gapsDeclarados: number | null;
    recordedAt: string;
  }>;
  newBehavior: AgentBehaviorEntry[];
}

/** Devuelve true si el objeto de metricas contiene al menos un campo no-nulo. */
function hasMetricData(m: { rework: boolean | null; iteraciones: number | null; confianza: string | null }): boolean {
  return m.rework !== null || m.iteraciones !== null || m.confianza !== null;
}

export function detectChanges(
  prev: PipelineSnapshot | null,
  curr: PipelineSnapshot
): DetectedChanges {
  const now = new Date().toISOString();
  const events: Omit<HistoryEvent, 'id'>[] = [];
  const newMetrics: DetectedChanges['newMetrics'] = [];
  const newBehavior: AgentBehaviorEntry[] = [];

  // --- Features ---
  const prevFeatureMap = new Map(
    (prev?.features ?? []).map((f) => [f.slug, f])
  );

  for (const curr_f of curr.features) {
    const prev_f = prevFeatureMap.get(curr_f.slug) ?? null;

    // Evento: cambio de estado
    if (prev_f === null || prev_f.state !== curr_f.state) {
      events.push({
        eventType: 'feature_state_changed',
        itemType: 'feature',
        itemSlug: curr_f.slug,
        itemTitle: curr_f.title,
        fromValue: prev_f?.state ?? null,
        toValue: curr_f.state,
        agentId: null,
        recordedAt: now,
      });
    }

    // Evento: handoffs completados (transicion false -> true)
    const prevHandoffMap = new Map(
      (prev_f?.handoffs ?? []).map((h) => [`${h.from}->${h.to}`, h])
    );
    for (const h of curr_f.handoffs) {
      const key = `${h.from}->${h.to}`;
      const prevH = prevHandoffMap.get(key);
      if (h.completed && !prevH?.completed) {
        events.push({
          eventType: 'handoff_completed',
          itemType: 'feature',
          itemSlug: curr_f.slug,
          itemTitle: curr_f.title,
          fromValue: null,
          toValue: key,
          agentId: h.from as AgentId,
          recordedAt: now,
        });
      }
    }

    // Metricas nuevas por agente (aparece por primera vez con datos no-nulos)
    for (const m of curr_f.metrics) {
      const prevMetrics = prev_f?.metrics.find((x) => x.agentId === m.agentId);
      const hadData = prevMetrics !== undefined && hasMetricData(prevMetrics);
      const hasData = hasMetricData(m);

      if (hasData && !hadData) {
        newMetrics.push({
          agentId: m.agentId,
          itemType: 'feature',
          itemSlug: curr_f.slug,
          rework: m.rework,
          iteraciones: m.iteraciones,
          confianza: m.confianza,
          gapsDeclarados: m.gapsDeclarados,
          recordedAt: now,
        });
        events.push({
          eventType: 'metrics_updated',
          itemType: 'feature',
          itemSlug: curr_f.slug,
          itemTitle: curr_f.title,
          fromValue: null,
          toValue: JSON.stringify({
            rework: m.rework,
            iteraciones: m.iteraciones,
            confianza: m.confianza,
          }),
          agentId: m.agentId,
          recordedAt: now,
        });
      }
    }
  }

  // --- Bugs --- (misma logica, sin handoffs)
  const prevBugMap = new Map(
    (prev?.bugs ?? []).map((b) => [`${b.id}-${b.slug}`, b])
  );

  for (const curr_b of curr.bugs) {
    const key = `${curr_b.id}-${curr_b.slug}`;
    const prev_b = prevBugMap.get(key) ?? null;

    if (prev_b === null || prev_b.state !== curr_b.state) {
      events.push({
        eventType: 'bug_state_changed',
        itemType: 'bug',
        itemSlug: key,
        itemTitle: curr_b.title,
        fromValue: prev_b?.state ?? null,
        toValue: curr_b.state,
        agentId: null,
        recordedAt: now,
      });
    }

    for (const [agentId, m] of Object.entries(curr_b.agentMetrics)) {
      if (!m) continue;
      const prevM = prev_b?.agentMetrics[agentId as AgentId];
      const hadData = prevM !== undefined && hasMetricData(prevM);
      const hasData = hasMetricData(m);
      if (hasData && !hadData) {
        newMetrics.push({
          agentId: agentId as AgentId,
          itemType: 'bug',
          itemSlug: key,
          rework: m.rework,
          iteraciones: m.iteraciones,
          confianza: m.confianza,
          gapsDeclarados: m.gapsDeclarados,
          recordedAt: now,
        });
      }
    }
  }

  // Para features con behaviorMetrics nuevos
  for (const curr_f of curr.features) {
    const prev_f = prevFeatureMap.get(curr_f.slug) ?? null;
    for (const [agentIdStr, bm] of Object.entries(curr_f.behaviorMetrics ?? {})) {
      const agentId = agentIdStr as AgentId;
      const prevBm = prev_f?.behaviorMetrics?.[agentId];
      // "tiene datos" si al menos un campo no es null
      const hasData = bm!.checklistRate !== null
        || bm!.structureScore !== null
        || bm!.hallucinationRefsTotal !== null
        || bm!.memoryRead !== null;
      const hadData = prevBm !== undefined && (
        prevBm.checklistRate !== null
        || prevBm.structureScore !== null
        || prevBm.hallucinationRefsTotal !== null
        || prevBm.memoryRead !== null
      );
      if (hasData && !hadData) {
        newBehavior.push({
          agentId,
          itemType: 'feature',
          itemSlug: curr_f.slug,
          checklistTotal: bm!.checklistTotal,
          checklistChecked: bm!.checklistChecked,
          structureScoreNum: bm!.structureScoreNum,
          structureScoreDen: bm!.structureScoreDen,
          refsTotal: bm!.hallucinationRefsTotal,
          refsValid: bm!.hallucinationRefsValid,
          memoryRead: bm!.memoryRead,
          recordedAt: now,
        });
      }
    }
  }

  return { events, newMetrics, newBehavior };
}
