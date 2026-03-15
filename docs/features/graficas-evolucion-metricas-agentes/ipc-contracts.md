# Contratos IPC — graficas-evolucion-metricas-agentes

## Tipos nuevos en src/types/ipc.ts

```typescript
// Un punto de la serie temporal de un agente en una feature concreta
export interface AgentTimelinePoint {
  itemSlug: string;      // slug de la feature/bug — truncar a 8 chars en la UI
  itemType: 'feature' | 'bug';
  rework: number | null; // 0 o 1 (null = sin dato)
  iteraciones: number | null;
  confianza: number | null; // 1=baja, 2=media, 3=alta (null = sin dato)
  recordedAt: string;    // ISO 8601 — para ordenar cronologicamente
}

export interface GetAgentTimelineParams {
  agentId: string; // 'leo' | 'cloe' | 'max' | 'ada' | 'cipher' — validar en handler
}

export interface GetAgentTimelineResult {
  agentId: string;
  points: AgentTimelinePoint[]; // ordenados ASC por recorded_at
}
```

## Canal nuevo en AppRPC.bun.requests

```typescript
getAgentTimeline: {
  params: GetAgentTimelineParams;
  response: GetAgentTimelineResult;
};
```

## AppRPC completo con la adicion

```typescript
export type AppRPC = {
  bun: RPCSchema<{
    requests: {
      // ... (canales existentes sin cambios)
      getAgentTimeline: { params: GetAgentTimelineParams; response: GetAgentTimelineResult };
    };
    messages: {
      // sin cambios
    };
  }>;
  webview: RPCSchema<{
    // sin cambios
  }>;
};
```

## Firma del handler en src/ipc/handlers.ts

```typescript
getAgentTimeline: async (params: GetAgentTimelineParams): Promise<GetAgentTimelineResult> => {
  const VALID_AGENTS = ['leo', 'cloe', 'max', 'ada', 'cipher'];
  if (!VALID_AGENTS.includes(params?.agentId ?? '')) {
    return { agentId: params?.agentId ?? '', points: [] };
  }
  const db = getHistoryDb();
  if (!db) return { agentId: params.agentId, points: [] };
  try {
    const points = queryAgentTimeline(db, params.agentId);
    return { agentId: params.agentId, points };
  } catch (e: any) {
    console.error('[handlers] getAgentTimeline error:', e.message);
    return { agentId: params.agentId, points: [] };
  }
},
```

## Llamada desde el renderer en monitor-view.ts

```typescript
// Callback inyectado via parametro — mismo patron que onGetHistory y onGetAgentTrends
onGetAgentTimeline: (params: GetAgentTimelineParams) => Promise<GetAgentTimelineResult>
```

La firma de `renderMonitor()` se extiende con este cuarto callback.
