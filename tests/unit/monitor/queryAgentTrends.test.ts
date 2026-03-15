import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { setupHistoryTestDb, teardownHistoryTestDb, getHistoryTestDb } from '../../helpers/testHistoryDb';
import { queryAgentTrends } from '../../../src/monitor/core/historyRepository';
import type { AgentId } from '../../../src/monitor/core/types';

function seedMetricsForTrends(db: ReturnType<typeof getHistoryTestDb>, rows: Array<{
  agent_id: string;
  rework: number | null;
  iteraciones: number | null;
  confianza: string | null;
  item_slug?: string;
}>) {
  const stmt = db.prepare(`
    INSERT INTO agent_metrics_history
      (agent_id, item_type, item_slug, rework, iteraciones, confianza, gaps_declarados, recorded_at)
    VALUES (?, 'feature', ?, ?, ?, ?, NULL, datetime('now'))
  `);
  rows.forEach((r, i) => {
    stmt.run(r.agent_id, r.item_slug ?? `feat-${i}`, r.rework, r.iteraciones, r.confianza);
  });
}

describe('queryAgentTrends', () => {
  beforeEach(() => { setupHistoryTestDb(); });
  afterEach(() => { teardownHistoryTestDb(); });

  it('currentSummaries vacio retorna array vacio', () => {
    const db = getHistoryTestDb();
    const result = queryAgentTrends(db, []);
    expect(result).toEqual([]);
  });

  it('agente sin datos en DB retorna reworkTrend=sin_datos, totalHistoricSamples=0', () => {
    const db = getHistoryTestDb();
    const result = queryAgentTrends(db, [
      { agentId: 'leo' as AgentId, reworkRate: 0.5, avgIterations: 2, avgConfidence: 2 },
    ]);
    expect(result.length).toBe(1);
    expect(result[0]!.reworkTrend).toBe('sin_datos');
    expect(result[0]!.totalHistoricSamples).toBe(0);
  });

  it('agente con < 3 muestras retorna reworkTrend=sin_datos', () => {
    const db = getHistoryTestDb();
    seedMetricsForTrends(db, [
      { agent_id: 'leo', rework: 1, iteraciones: 2, confianza: 'alta' },
      { agent_id: 'leo', rework: 0, iteraciones: 1, confianza: 'media' },
    ]);
    const result = queryAgentTrends(db, [
      { agentId: 'leo' as AgentId, reworkRate: 0.5, avgIterations: 2, avgConfidence: 2 },
    ]);
    expect(result[0]!.reworkTrend).toBe('sin_datos');
    expect(result[0]!.totalHistoricSamples).toBe(2);
  });

  it('agente con >= 3 muestras, reworkRate actual > historico+5%: reworkTrend=empeorando', () => {
    const db = getHistoryTestDb();
    // historicReworkRate = 0/3 = 0.0
    seedMetricsForTrends(db, [
      { agent_id: 'leo', rework: 0, iteraciones: 1, confianza: 'alta' },
      { agent_id: 'leo', rework: 0, iteraciones: 1, confianza: 'alta' },
      { agent_id: 'leo', rework: 0, iteraciones: 1, confianza: 'alta' },
    ]);
    // reworkRate actual = 0.8 (muy por encima del historico 0.0)
    const result = queryAgentTrends(db, [
      { agentId: 'leo' as AgentId, reworkRate: 0.8, avgIterations: 1, avgConfidence: 3 },
    ]);
    expect(result[0]!.reworkTrend).toBe('empeorando');
  });

  it('agente con >= 3 muestras, reworkRate actual < historico-5%: reworkTrend=mejorando', () => {
    const db = getHistoryTestDb();
    // historicReworkRate = 3/3 = 1.0
    seedMetricsForTrends(db, [
      { agent_id: 'leo', rework: 1, iteraciones: 1, confianza: 'baja' },
      { agent_id: 'leo', rework: 1, iteraciones: 1, confianza: 'baja' },
      { agent_id: 'leo', rework: 1, iteraciones: 1, confianza: 'baja' },
    ]);
    // reworkRate actual = 0.0 (muy por debajo del historico 1.0)
    const result = queryAgentTrends(db, [
      { agentId: 'leo' as AgentId, reworkRate: 0.0, avgIterations: 1, avgConfidence: 1 },
    ]);
    expect(result[0]!.reworkTrend).toBe('mejorando');
  });

  it('agente con >= 3 muestras, diferencia < 5%: reworkTrend=estable', () => {
    const db = getHistoryTestDb();
    // historicReworkRate = 1/3 = 0.33
    seedMetricsForTrends(db, [
      { agent_id: 'leo', rework: 1, iteraciones: 1, confianza: 'alta' },
      { agent_id: 'leo', rework: 0, iteraciones: 1, confianza: 'alta' },
      { agent_id: 'leo', rework: 0, iteraciones: 1, confianza: 'alta' },
    ]);
    // reworkRate actual = 0.34 (< 5% de diferencia con 0.33)
    const result = queryAgentTrends(db, [
      { agentId: 'leo' as AgentId, reworkRate: 0.34, avgIterations: 1, avgConfidence: 3 },
    ]);
    expect(result[0]!.reworkTrend).toBe('estable');
  });

  it('confianza alta=3, media=2, baja=1 en historicAvgConfidence', () => {
    const db = getHistoryTestDb();
    seedMetricsForTrends(db, [
      { agent_id: 'cloe', rework: 0, iteraciones: 1, confianza: 'alta' },  // 3
      { agent_id: 'cloe', rework: 0, iteraciones: 1, confianza: 'media' }, // 2
      { agent_id: 'cloe', rework: 0, iteraciones: 1, confianza: 'baja' },  // 1
    ]);
    const result = queryAgentTrends(db, [
      { agentId: 'cloe' as AgentId, reworkRate: 0, avgIterations: 1, avgConfidence: 2 },
    ]);
    // (3+2+1)/3 = 2.0
    expect(result[0]!.historicAvgConfidence).toBe(2);
  });
});
