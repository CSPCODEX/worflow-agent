import { describe, it, expect } from 'bun:test';
import { detectChanges } from '../../../src/dev-tools/monitor/core/changeDetector';
import type { PipelineSnapshot, FeatureRecord, BugRecord } from '../../../src/dev-tools/monitor/core/types';

// Helper para construir un snapshot minimo valido
function makeSnapshot(
  features: Partial<FeatureRecord>[] = [],
  bugs: Partial<BugRecord>[] = []
): PipelineSnapshot {
  return {
    features: features.map((f) => ({
      slug: 'test-feature',
      title: 'Test Feature',
      state: 'EN_PLANIFICACION' as const,
      branch: 'feature/test',
      openedAt: '2026-01-01',
      handoffs: [],
      metrics: [],
      behaviorMetrics: {},
      leoContract: null,
      rejectionRecords: [],
      filePath: '/fake/path',
      ...f,
    })),
    bugs: bugs.map((b) => ({
      id: '001',
      slug: 'test-bug',
      title: 'Test Bug',
      state: 'ABIERTO' as const,
      openedAt: '2026-01-01',
      hasSecurityImplication: false,
      agentMetrics: {},
      filePath: '/fake/path',
      ...b,
    })),
    agentSummaries: [],
    lastUpdatedAt: new Date().toISOString(),
    parseErrors: [],
  };
}

describe('detectChanges', () => {
  describe('features', () => {
    it('prev=null genera feature_state_changed con fromValue=null', () => {
      const curr = makeSnapshot([{ slug: 'nueva-feature', state: 'EN_PLANIFICACION' }]);
      const { events } = detectChanges(null, curr);
      const ev = events.find((e) => e.eventType === 'feature_state_changed');
      expect(ev).toBeDefined();
      expect(ev!.fromValue).toBeNull();
      expect(ev!.toValue).toBe('EN_PLANIFICACION');
      expect(ev!.itemSlug).toBe('nueva-feature');
    });

    it('cambio de estado genera evento con fromValue=estado anterior', () => {
      const prev = makeSnapshot([{ slug: 'feat-1', state: 'EN_PLANIFICACION' }]);
      const curr = makeSnapshot([{ slug: 'feat-1', state: 'EN_IMPLEMENTACION' }]);
      const { events } = detectChanges(prev, curr);
      const ev = events.find((e) => e.eventType === 'feature_state_changed');
      expect(ev).toBeDefined();
      expect(ev!.fromValue).toBe('EN_PLANIFICACION');
      expect(ev!.toValue).toBe('EN_IMPLEMENTACION');
    });

    it('sin cambios de estado no genera eventos de estado', () => {
      const prev = makeSnapshot([{ slug: 'feat-1', state: 'EN_PLANIFICACION' }]);
      const curr = makeSnapshot([{ slug: 'feat-1', state: 'EN_PLANIFICACION' }]);
      const { events } = detectChanges(prev, curr);
      const stateEvents = events.filter((e) => e.eventType === 'feature_state_changed');
      expect(stateEvents.length).toBe(0);
    });

    it('handoff false->true genera handoff_completed', () => {
      const prev = makeSnapshot([{
        slug: 'feat-1',
        handoffs: [{ from: 'leo', to: 'cloe', completed: false, hasRework: false }],
      }]);
      const curr = makeSnapshot([{
        slug: 'feat-1',
        handoffs: [{ from: 'leo', to: 'cloe', completed: true, hasRework: false }],
      }]);
      const { events } = detectChanges(prev, curr);
      const handoff = events.find((e) => e.eventType === 'handoff_completed');
      expect(handoff).toBeDefined();
      expect(handoff!.toValue).toBe('leo->cloe');
      expect(handoff!.agentId).toBe('leo');
    });

    it('handoff ya completado no genera evento duplicado', () => {
      const prev = makeSnapshot([{
        slug: 'feat-1',
        handoffs: [{ from: 'leo', to: 'cloe', completed: true, hasRework: false }],
      }]);
      const curr = makeSnapshot([{
        slug: 'feat-1',
        handoffs: [{ from: 'leo', to: 'cloe', completed: true, hasRework: false }],
      }]);
      const { events } = detectChanges(prev, curr);
      const handoffs = events.filter((e) => e.eventType === 'handoff_completed');
      expect(handoffs.length).toBe(0);
    });

    it('metricas nuevas (no habia datos) genera metrics_updated y entrada en newMetrics', () => {
      const prev = makeSnapshot([{
        slug: 'feat-1',
        metrics: [{ agentId: 'leo', rework: null, iteraciones: null, confianza: null, archivosLeidos: null, archivosCreados: null, archivosModificados: null, gapsDeclarados: null }],
      }]);
      const curr = makeSnapshot([{
        slug: 'feat-1',
        metrics: [{ agentId: 'leo', rework: false, iteraciones: 2, confianza: 'alta', archivosLeidos: null, archivosCreados: null, archivosModificados: null, gapsDeclarados: 0 }],
      }]);
      const { events, newMetrics } = detectChanges(prev, curr);
      const metricsEv = events.find((e) => e.eventType === 'metrics_updated');
      expect(metricsEv).toBeDefined();
      expect(newMetrics.length).toBe(1);
      expect(newMetrics[0]!.agentId).toBe('leo');
      expect(newMetrics[0]!.iteraciones).toBe(2);
    });

    it('metricas ya existentes no genera eventos duplicados', () => {
      const metricsData = { agentId: 'leo' as const, rework: false, iteraciones: 2, confianza: 'alta' as const, archivosLeidos: null, archivosCreados: null, archivosModificados: null, gapsDeclarados: 0 };
      const prev = makeSnapshot([{ slug: 'feat-1', metrics: [metricsData] }]);
      const curr = makeSnapshot([{ slug: 'feat-1', metrics: [metricsData] }]);
      const { events, newMetrics } = detectChanges(prev, curr);
      const metricsEvents = events.filter((e) => e.eventType === 'metrics_updated');
      expect(metricsEvents.length).toBe(0);
      expect(newMetrics.length).toBe(0);
    });
  });

  describe('bugs', () => {
    it('bug nuevo genera bug_state_changed', () => {
      const curr = makeSnapshot([], [{ id: '001', slug: 'nuevo-bug', state: 'ABIERTO' }]);
      const { events } = detectChanges(null, curr);
      const ev = events.find((e) => e.eventType === 'bug_state_changed');
      expect(ev).toBeDefined();
      expect(ev!.itemSlug).toBe('001-nuevo-bug');
      expect(ev!.fromValue).toBeNull();
    });

    it('bug sin cambios no genera eventos', () => {
      const prev = makeSnapshot([], [{ id: '001', slug: 'bug-1', state: 'ABIERTO' }]);
      const curr = makeSnapshot([], [{ id: '001', slug: 'bug-1', state: 'ABIERTO' }]);
      const { events } = detectChanges(prev, curr);
      const bugEvents = events.filter((e) => e.eventType === 'bug_state_changed');
      expect(bugEvents.length).toBe(0);
    });
  });
});
