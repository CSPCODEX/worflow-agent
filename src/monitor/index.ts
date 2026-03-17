// API publica del modulo monitor.
// El host importa solo desde este archivo.
// Ninguna importacion del host debe existir aqui ni en core/*.
export { PipelinePoller } from './core/poller';
export { buildSnapshot } from './core/aggregator';
export { getHistoryDb, closeHistoryDb } from './core/historyDb';
export { queryHistory, queryAgentTrends } from './core/historyRepository';
export { queryAgentTimeline } from './core/timelineRepository';
export { queryAgentBehaviorTimeline } from './core/behaviorTimelineRepository';
export type {
  PipelineSnapshot,
  FeatureRecord,
  BugRecord,
  AgentSummary,
  AgentMetrics,
  HandoffStatus,
  PipelineEvent,
  MonitorConfig,
  SnapshotCallback,
  AgentId,
  FeatureState,
  BugState,
  HistoryEvent,
  AgentMetricsHistoryEntry,
  AgentTrend,
  HistoryQuery,
  HistoryQueryResult,
  PipelineEventType,
} from './core/types';

// monitor.track() es el punto de entrada para eventos futuros en tiempo real.
// En v1 es un no-op con firma definida para no romper la API cuando se implemente.
export const monitor = {
  track(_event: import('./core/types').PipelineEvent): void {
    // v1: no-op. En v2: persistir el evento en una cola para replay.
  },
};
