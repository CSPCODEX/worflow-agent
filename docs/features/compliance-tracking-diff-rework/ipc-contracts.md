# IPC Contracts — compliance-tracking-diff-rework

## Nuevos canales en AppRPC (bun.requests)

### getComplianceScores

Retorna todos los compliance scores almacenados en SQLite, ordenados por fecha DESC.

```typescript
// Params
interface GetComplianceScoresParams {
  featureSlug?: string;  // filtro opcional por feature
  limit?: number;        // default: 100
  offset?: number;       // default: 0
}

// Response
interface ComplianceScoreIPC {
  id: number;
  featureSlug: string;
  score: number;         // 0.0-1.0
  filesSpec: number;     // total archivos especificados en el contrato
  filesOk: number;       // archivos cumplidos
  filesViol: number;     // archivos no_touch que aparecen en diff (violaciones)
  branch: string;
  baseRef: string;
  recordedAt: string;    // ISO 8601
}

interface GetComplianceScoresResult {
  scores: ComplianceScoreIPC[];
  totalCount: number;
}
```

### getRejectionPatterns

Retorna los rejection records con agregados por agente.

```typescript
// Params
interface GetRejectionPatternsParams {
  agentId?: string;      // filtro opcional por agente
  featureSlug?: string;  // filtro opcional por feature
  limit?: number;        // default: 100
  offset?: number;       // default: 0
}

// Response
interface RejectionRecordIPC {
  id: number;
  featureSlug: string;
  agentAtFault: string;
  instructionViolated: string;
  instructionSource: 'CLAUDE.md' | 'agent_system_prompt' | 'handoff_anterior';
  failureType: 'patron_conocido' | 'instruccion_ambigua' | 'instruccion_ausente';
  recordedAt: string;
}

interface RejectionPatternAggregate {
  agentId: string;
  totalRejections: number;
  byFailureType: {
    patron_conocido: number;
    instruccion_ambigua: number;
    instruccion_ausente: number;
  };
  bySource: {
    'CLAUDE.md': number;
    agent_system_prompt: number;
    handoff_anterior: number;
  };
  mostFrequentViolation: string | null;  // instruccion que mas se repite
}

interface GetRejectionPatternsResult {
  records: RejectionRecordIPC[];
  totalCount: number;
  aggregates: RejectionPatternAggregate[];
}
```

## Validacion de parametros en handlers

Antes de pasarlos a queries SQLite:
- `featureSlug`: validar `/^[a-z0-9-]+$/` si presente
- `agentId`: validar contra VALID_AGENTS whitelist si presente
- `limit`: `Number.isInteger(v) && v > 0 && v <= 500`
- `offset`: `Number.isInteger(v) && v >= 0`
- `instructionSource`: whitelist `['CLAUDE.md', 'agent_system_prompt', 'handoff_anterior']`
- `failureType`: whitelist `['patron_conocido', 'instruccion_ambigua', 'instruccion_ausente']`

## Actualizacion de AppRPC en src/types/ipc.ts

Añadir en `bun.requests`:
```typescript
getComplianceScores: { params: GetComplianceScoresParams; response: GetComplianceScoresResult };
getRejectionPatterns: { params: GetRejectionPatternsParams; response: GetRejectionPatternsResult };
```
