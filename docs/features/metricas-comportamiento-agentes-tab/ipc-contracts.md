# Contratos IPC — metricas-comportamiento-agentes-tab

## Tipos nuevos a añadir en `src/types/ipc.ts`

```typescript
// Metricas de comportamiento de un agente en una feature especifica
// Calculadas externamente — no auto-reportadas
export interface AgentBehaviorMetricsIPC {
  agentId: string;
  // Checklist adherence
  checklistTotal: number | null;       // items totales en ### Checklist X
  checklistChecked: number | null;     // items marcados [x]
  checklistRate: number | null;        // checklistChecked / checklistTotal (0.0-1.0), null si total=0
  // Structure score
  structureScore: number | null;       // secciones obligatorias presentes / esperadas (0.0-1.0)
  // Hallucination
  hallucinationRefsTotal: number | null;   // file refs declaradas en el handoff
  hallucinationRefsValid: number | null;   // refs que existen en filesystem
  hallucinationRate: number | null;        // 1 - (valid/total), null si total=0
  // Memory read
  memoryRead: boolean | null;          // null = handoff incompleto, true/false = verificado
}

// Serie temporal de comportamiento para graficas por agente
export interface AgentBehaviorPointIPC {
  itemSlug: string;
  itemType: 'feature' | 'bug';
  checklistRate: number | null;
  structureScore: number | null;
  hallucinationRate: number | null;
  memoryRead: number | null;   // 0 o 1 (para eje Y numerico en graficas)
  recordedAt: string;
}

export interface GetAgentBehaviorTimelineParams {
  agentId: string;
}

export interface GetAgentBehaviorTimelineResult {
  points: AgentBehaviorPointIPC[];
}
```

## Modificaciones a tipos existentes en `src/types/ipc.ts`

```typescript
// FeatureRecordIPC — añadir campo behaviorMetrics
export interface FeatureRecordIPC {
  slug: string;
  title: string;
  state: string;
  branch: string;
  openedAt: string;
  handoffs: HandoffStatusIPC[];
  metrics: AgentMetricsIPC[];
  behaviorMetrics: Record<string, AgentBehaviorMetricsIPC>;  // NUEVO — keyed por agentId
}

// AgentSummaryIPC — añadir campos de comportamiento agregados
export interface AgentSummaryIPC {
  agentId: string;
  totalFeatures: number;
  avgIterations: number;
  reworkCount: number;
  reworkRate: number;
  avgConfidence: number;
  totalGapsDeclared: number;
  completedHandoffs: number;
  // NUEVOS campos de comportamiento:
  avgChecklistRate: number | null;       // promedio de checklistRate (null si sin datos)
  avgStructureScore: number | null;      // promedio de structureScore
  avgHallucinationRate: number | null;   // promedio de hallucinationRate
  memoryReadRate: number | null;         // % de handoffs donde memoryRead=true (0.0-1.0)
}
```

## Nuevo canal IPC en AppRPC (en `src/types/ipc.ts`)

En la seccion `bun.requests`:
```typescript
getAgentBehaviorTimeline: {
  params: GetAgentBehaviorTimelineParams;
  response: GetAgentBehaviorTimelineResult;
};
```

## Handler en `src/ipc/handlers.ts`

```typescript
getAgentBehaviorTimeline: async (params: GetAgentBehaviorTimelineParams): Promise<GetAgentBehaviorTimelineResult> => {
  const db = getHistoryDb();
  if (!db) return { points: [] };
  if (!VALID_AGENTS.includes(params?.agentId as any)) return { points: [] };
  try {
    const points = queryAgentBehaviorTimeline(db, params.agentId);
    return { points };
  } catch (e: any) {
    console.error('[handlers] getAgentBehaviorTimeline error:', e.message);
    return { points: [] };
  }
},
```

## Callback adicional en `renderMonitor()`

La firma de `renderMonitor()` en `monitor-view.ts` pasa de 6 a 7 parametros:

```typescript
export function renderMonitor(
  container: HTMLElement,
  initialSnapshot: PipelineSnapshotIPC,
  onRefresh: () => void,
  onGetHistory: (params: GetHistoryParams) => Promise<GetHistoryResult>,
  onGetAgentTrends: () => Promise<GetAgentTrendsResult>,
  onGetAgentTimeline: (params: GetAgentTimelineParams) => Promise<GetAgentTimelineResult>,
  onGetAgentBehaviorTimeline: (params: GetAgentBehaviorTimelineParams) => Promise<GetAgentBehaviorTimelineResult>,  // NUEVO
): MonitorViewHandle
```

En `src/renderer/app.ts`, en `showMonitor()`:
```typescript
activeMonitorHandle = renderMonitor(
  mainContentEl,
  emptySnapshot,
  onRefresh,
  onGetHistory,
  onGetAgentTrends,
  onGetAgentTimeline,
  (params) => (rpc as any).request.getAgentBehaviorTimeline(params),  // NUEVO
);
```
