import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { setupHistoryTestDb, teardownHistoryTestDb, getHistoryTestDb } from '../../helpers/testHistoryDb';
import { queryAgentTimeline } from '../../../src/dev-tools/monitor/core/timelineRepository';

function seedMetrics(db: ReturnType<typeof getHistoryTestDb>, rows: Array<{
  agent_id: string;
  item_type: string;
  item_slug: string;
  rework: number | null;
  iteraciones: number | null;
  confianza: string | null;
  recorded_at: string;
}>) {
  const stmt = db.prepare(`
    INSERT INTO agent_metrics_history
      (agent_id, item_type, item_slug, rework, iteraciones, confianza, gaps_declarados, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
  `);
  for (const r of rows) {
    stmt.run(r.agent_id, r.item_type, r.item_slug, r.rework, r.iteraciones, r.confianza, r.recorded_at);
  }
}

describe('queryAgentTimeline', () => {
  beforeEach(() => { setupHistoryTestDb(); });
  afterEach(() => { teardownHistoryTestDb(); });

  it('DB vacia retorna array vacio', () => {
    const db = getHistoryTestDb();
    const points = queryAgentTimeline(db, 'leo');
    expect(points).toEqual([]);
  });

  it('retorna solo filas del agentId solicitado', () => {
    const db = getHistoryTestDb();
    seedMetrics(db, [
      { agent_id: 'leo',  item_type: 'feature', item_slug: 'feat-1', rework: 0, iteraciones: 2, confianza: 'alta',  recorded_at: '2026-01-01T00:00:00.000Z' },
      { agent_id: 'cloe', item_type: 'feature', item_slug: 'feat-1', rework: 0, iteraciones: 1, confianza: 'baja',  recorded_at: '2026-01-01T00:00:00.000Z' },
    ]);
    const points = queryAgentTimeline(db, 'leo');
    expect(points.length).toBe(1);
    expect(points[0]!.itemSlug).toBe('feat-1');
  });

  it('retorna puntos en orden ASC por recorded_at', () => {
    const db = getHistoryTestDb();
    seedMetrics(db, [
      { agent_id: 'leo', item_type: 'feature', item_slug: 'feat-2', rework: 1, iteraciones: 3, confianza: 'media', recorded_at: '2026-01-02T00:00:00.000Z' },
      { agent_id: 'leo', item_type: 'feature', item_slug: 'feat-1', rework: 0, iteraciones: 2, confianza: 'alta',  recorded_at: '2026-01-01T00:00:00.000Z' },
    ]);
    const points = queryAgentTimeline(db, 'leo');
    expect(points.length).toBe(2);
    expect(points[0]!.itemSlug).toBe('feat-1');
    expect(points[1]!.itemSlug).toBe('feat-2');
  });

  it('mapea confianza alta=3, media=2, baja=1', () => {
    const db = getHistoryTestDb();
    seedMetrics(db, [
      { agent_id: 'leo', item_type: 'feature', item_slug: 'feat-1', rework: 0, iteraciones: 1, confianza: 'alta',  recorded_at: '2026-01-01T00:00:00.000Z' },
      { agent_id: 'leo', item_type: 'feature', item_slug: 'feat-2', rework: 0, iteraciones: 1, confianza: 'media', recorded_at: '2026-01-02T00:00:00.000Z' },
      { agent_id: 'leo', item_type: 'feature', item_slug: 'feat-3', rework: 0, iteraciones: 1, confianza: 'baja',  recorded_at: '2026-01-03T00:00:00.000Z' },
    ]);
    const points = queryAgentTimeline(db, 'leo');
    expect(points[0]!.confianza).toBe(3);
    expect(points[1]!.confianza).toBe(2);
    expect(points[2]!.confianza).toBe(1);
  });

  it('confianza NULL mapea a null', () => {
    const db = getHistoryTestDb();
    seedMetrics(db, [
      { agent_id: 'leo', item_type: 'feature', item_slug: 'feat-1', rework: 0, iteraciones: 1, confianza: null, recorded_at: '2026-01-01T00:00:00.000Z' },
    ]);
    const points = queryAgentTimeline(db, 'leo');
    expect(points[0]!.confianza).toBeNull();
  });

  it('rework=1 mapea a 1, rework=0 mapea a 0, rework NULL mapea a null', () => {
    const db = getHistoryTestDb();
    seedMetrics(db, [
      { agent_id: 'leo', item_type: 'feature', item_slug: 'feat-1', rework: 1,    iteraciones: 1, confianza: 'alta', recorded_at: '2026-01-01T00:00:00.000Z' },
      { agent_id: 'leo', item_type: 'feature', item_slug: 'feat-2', rework: 0,    iteraciones: 1, confianza: 'alta', recorded_at: '2026-01-02T00:00:00.000Z' },
      { agent_id: 'leo', item_type: 'feature', item_slug: 'feat-3', rework: null, iteraciones: 1, confianza: 'alta', recorded_at: '2026-01-03T00:00:00.000Z' },
    ]);
    const points = queryAgentTimeline(db, 'leo');
    expect(points[0]!.rework).toBe(1);
    expect(points[1]!.rework).toBe(0);
    expect(points[2]!.rework).toBeNull();
  });

  it('itemType bug se mapea correctamente', () => {
    const db = getHistoryTestDb();
    seedMetrics(db, [
      { agent_id: 'max', item_type: 'bug', item_slug: '001-test-bug', rework: 0, iteraciones: 1, confianza: 'alta', recorded_at: '2026-01-01T00:00:00.000Z' },
    ]);
    const points = queryAgentTimeline(db, 'max');
    expect(points[0]!.itemType).toBe('bug');
    expect(points[0]!.itemSlug).toBe('001-test-bug');
  });
});
