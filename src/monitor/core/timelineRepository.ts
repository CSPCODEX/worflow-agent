import type { Database } from 'bun:sqlite';
import type { AgentTimelinePoint } from '../../types/ipc';

interface TimelineRow {
  agent_id: string;
  item_slug: string;
  item_type: string;
  rework: number | null;
  iteraciones: number | null;
  confianza: string | null;
  recorded_at: string;
}

const CONF_MAP: Record<string, number> = { alta: 3, media: 2, baja: 1 };

export function queryAgentTimeline(db: Database, agentId: string): AgentTimelinePoint[] {
  const stmt = db.prepare<TimelineRow, [string]>(`
    SELECT agent_id, item_slug, item_type,
           rework, iteraciones, confianza, recorded_at
    FROM agent_metrics_history
    WHERE agent_id = ?
    ORDER BY recorded_at ASC
  `);

  const rows = stmt.all(agentId);

  return rows.map((row) => ({
    itemSlug: row.item_slug,
    itemType: row.item_type as 'feature' | 'bug',
    rework: row.rework !== null ? (row.rework === 1 ? 1 : 0) : null,
    iteraciones: row.iteraciones,
    confianza: row.confianza !== null ? (CONF_MAP[row.confianza] ?? null) : null,
    recordedAt: row.recorded_at,
  }));
}
