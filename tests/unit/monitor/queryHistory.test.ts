import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { setupHistoryTestDb, teardownHistoryTestDb, getHistoryTestDb } from '../../helpers/testHistoryDb';
import { queryHistory } from '../../../src/monitor/core/historyRepository';

function seedEvents(db: ReturnType<typeof getHistoryTestDb>, events: Array<{
  event_type: string;
  item_type: string;
  item_slug: string;
  item_title: string;
  from_value: string | null;
  to_value: string;
  agent_id: string | null;
  recorded_at: string;
}>) {
  const stmt = db.prepare(`
    INSERT INTO pipeline_events
      (event_type, item_type, item_slug, item_title, from_value, to_value, agent_id, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const e of events) {
    stmt.run(e.event_type, e.item_type, e.item_slug, e.item_title, e.from_value, e.to_value, e.agent_id, e.recorded_at);
  }
}

describe('queryHistory', () => {
  beforeEach(() => { setupHistoryTestDb(); });
  afterEach(() => { teardownHistoryTestDb(); });

  it('DB vacia retorna events=[] y totalCount=0', () => {
    const db = getHistoryTestDb();
    const result = queryHistory(db, {});
    expect(result.events).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('sin filtros retorna todos los eventos', () => {
    const db = getHistoryTestDb();
    seedEvents(db, [
      { event_type: 'feature_state_changed', item_type: 'feature', item_slug: 'feat-1', item_title: 'Feat 1', from_value: null, to_value: 'EN_PLANIFICACION', agent_id: null, recorded_at: '2026-01-01T00:00:00.000Z' },
      { event_type: 'bug_state_changed',     item_type: 'bug',     item_slug: '001-bug', item_title: 'Bug 1', from_value: null, to_value: 'ABIERTO',          agent_id: null, recorded_at: '2026-01-02T00:00:00.000Z' },
    ]);
    const result = queryHistory(db, {});
    expect(result.totalCount).toBe(2);
    expect(result.events.length).toBe(2);
  });

  it('filtro itemType=feature retorna solo features', () => {
    const db = getHistoryTestDb();
    seedEvents(db, [
      { event_type: 'feature_state_changed', item_type: 'feature', item_slug: 'feat-1', item_title: 'F1', from_value: null, to_value: 'EN_PLANIFICACION', agent_id: null, recorded_at: '2026-01-01T00:00:00.000Z' },
      { event_type: 'bug_state_changed',     item_type: 'bug',     item_slug: '001-bug', item_title: 'B1', from_value: null, to_value: 'ABIERTO',          agent_id: null, recorded_at: '2026-01-02T00:00:00.000Z' },
    ]);
    const result = queryHistory(db, { itemType: 'feature' });
    expect(result.totalCount).toBe(1);
    expect(result.events[0]!.itemType).toBe('feature');
  });

  it('filtro agentId retorna solo eventos de ese agente', () => {
    const db = getHistoryTestDb();
    seedEvents(db, [
      { event_type: 'handoff_completed', item_type: 'feature', item_slug: 'feat-1', item_title: 'F1', from_value: null, to_value: 'leo->cloe', agent_id: 'leo',  recorded_at: '2026-01-01T00:00:00.000Z' },
      { event_type: 'handoff_completed', item_type: 'feature', item_slug: 'feat-1', item_title: 'F1', from_value: null, to_value: 'cloe->max', agent_id: 'cloe', recorded_at: '2026-01-02T00:00:00.000Z' },
    ]);
    const result = queryHistory(db, { agentId: 'leo' });
    expect(result.totalCount).toBe(1);
    expect(result.events[0]!.agentId).toBe('leo');
  });

  it('filtro eventType retorna solo ese tipo de evento', () => {
    const db = getHistoryTestDb();
    seedEvents(db, [
      { event_type: 'feature_state_changed', item_type: 'feature', item_slug: 'feat-1', item_title: 'F1', from_value: null,  to_value: 'EN_PLANIFICACION', agent_id: null,  recorded_at: '2026-01-01T00:00:00.000Z' },
      { event_type: 'handoff_completed',      item_type: 'feature', item_slug: 'feat-1', item_title: 'F1', from_value: null,  to_value: 'leo->cloe',        agent_id: 'leo', recorded_at: '2026-01-02T00:00:00.000Z' },
    ]);
    const result = queryHistory(db, { eventType: 'handoff_completed' });
    expect(result.totalCount).toBe(1);
    expect(result.events[0]!.eventType).toBe('handoff_completed');
  });

  it('paginacion: limit=2, offset=0 retorna primeros 2 eventos (DESC)', () => {
    const db = getHistoryTestDb();
    seedEvents(db, [
      { event_type: 'feature_state_changed', item_type: 'feature', item_slug: 'feat-1', item_title: 'F1', from_value: null, to_value: 'A', agent_id: null, recorded_at: '2026-01-01T00:00:00.000Z' },
      { event_type: 'feature_state_changed', item_type: 'feature', item_slug: 'feat-2', item_title: 'F2', from_value: null, to_value: 'B', agent_id: null, recorded_at: '2026-01-02T00:00:00.000Z' },
      { event_type: 'feature_state_changed', item_type: 'feature', item_slug: 'feat-3', item_title: 'F3', from_value: null, to_value: 'C', agent_id: null, recorded_at: '2026-01-03T00:00:00.000Z' },
    ]);
    const result = queryHistory(db, { limit: 2, offset: 0 });
    expect(result.events.length).toBe(2);
    expect(result.totalCount).toBe(3); // totalCount no se afecta por limit
    // DESC: el mas reciente primero
    expect(result.events[0]!.toValue).toBe('C');
  });

  it('paginacion: offset=2 retorna el tercer evento', () => {
    const db = getHistoryTestDb();
    seedEvents(db, [
      { event_type: 'feature_state_changed', item_type: 'feature', item_slug: 'feat-1', item_title: 'F1', from_value: null, to_value: 'A', agent_id: null, recorded_at: '2026-01-01T00:00:00.000Z' },
      { event_type: 'feature_state_changed', item_type: 'feature', item_slug: 'feat-2', item_title: 'F2', from_value: null, to_value: 'B', agent_id: null, recorded_at: '2026-01-02T00:00:00.000Z' },
      { event_type: 'feature_state_changed', item_type: 'feature', item_slug: 'feat-3', item_title: 'F3', from_value: null, to_value: 'C', agent_id: null, recorded_at: '2026-01-03T00:00:00.000Z' },
    ]);
    const result = queryHistory(db, { limit: 10, offset: 2 });
    expect(result.events.length).toBe(1);
    expect(result.events[0]!.toValue).toBe('A'); // el mas antiguo, posicion 2 (0-indexed) en DESC
  });

  it('totalCount no se afecta por limit/offset', () => {
    const db = getHistoryTestDb();
    seedEvents(db, [
      { event_type: 'feature_state_changed', item_type: 'feature', item_slug: 'f1', item_title: 'T', from_value: null, to_value: 'X', agent_id: null, recorded_at: '2026-01-01T00:00:00.000Z' },
      { event_type: 'feature_state_changed', item_type: 'feature', item_slug: 'f2', item_title: 'T', from_value: null, to_value: 'X', agent_id: null, recorded_at: '2026-01-02T00:00:00.000Z' },
      { event_type: 'feature_state_changed', item_type: 'feature', item_slug: 'f3', item_title: 'T', from_value: null, to_value: 'X', agent_id: null, recorded_at: '2026-01-03T00:00:00.000Z' },
    ]);
    const r1 = queryHistory(db, { limit: 1, offset: 0 });
    const r2 = queryHistory(db, { limit: 1, offset: 2 });
    expect(r1.totalCount).toBe(3);
    expect(r2.totalCount).toBe(3);
  });
});
