import type { Database } from 'bun:sqlite';
import type { AgentBehaviorPointIPC } from '../../types/ipc';

interface BehaviorRow {
  agent_id: string;
  item_slug: string;
  item_type: string;
  checklist_total: number | null;
  checklist_checked: number | null;
  structure_score_num: number | null;
  structure_score_den: number | null;
  refs_total: number | null;
  refs_valid: number | null;
  memory_read: number | null;
  recorded_at: string;
}

export function queryAgentBehaviorTimeline(
  db: Database,
  agentId: string
): AgentBehaviorPointIPC[] {
  const stmt = db.prepare<BehaviorRow, [string]>(`
    SELECT agent_id, item_slug, item_type,
           checklist_total, checklist_checked,
           structure_score_num, structure_score_den,
           refs_total, refs_valid, memory_read, recorded_at
    FROM agent_behavior_history
    WHERE agent_id = ?
    ORDER BY recorded_at ASC
  `);

  const rows = stmt.all(agentId);

  return rows.map((row) => {
    const checklistRate = (row.checklist_total !== null && row.checklist_total > 0 && row.checklist_checked !== null)
      ? Math.round((row.checklist_checked / row.checklist_total) * 100) / 100
      : null;

    const structureScore = (row.structure_score_den !== null && row.structure_score_den > 0 && row.structure_score_num !== null)
      ? Math.round((row.structure_score_num / row.structure_score_den) * 100) / 100
      : null;

    const hallucinationRate = (row.refs_total !== null && row.refs_total > 0 && row.refs_valid !== null)
      ? Math.round((1 - row.refs_valid / row.refs_total) * 100) / 100
      : null;

    return {
      itemSlug: row.item_slug,
      itemType: row.item_type as 'feature' | 'bug',
      checklistRate,
      structureScore,
      hallucinationRate,
      memoryRead: row.memory_read,   // 0, 1, o null
      recordedAt: row.recorded_at,
    };
  });
}
