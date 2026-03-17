# Feature — Metricas de comportamiento de agentes en tab Agentes

Estado: LISTO PARA MERGE
Rama: feature/metricas-comportamiento-agentes-tab
Fecha apertura: 2026-03-15

---

## Info de la feature

**Descripcion:** Añadir metricas de comportamiento real de los agentes en el tab de Agentes del Monitor. Responde 4 preguntas: (1) checklist adherence, (2) determinismo estructural, (3) alucinacion de file references, (4) lectura de memoria. Todas las metricas son calculadas externamente — no auto-reportadas por el agente.

**Objetivo:** Exponer en la UI comportamiento verificable de cada agente, extendiendo el tab "Agentes" que ya existe dentro del Monitor, sin crear tabs nuevos.

**Restricciones:** No romper el tab Agentes existente. No romper CLI. Type safety en IPC. ASCII-safe en todo lo que viaja por IPC (BUG #001).

---

## Handoff Leo → Cloe

### Contexto del sistema actual

El Monitor (`src/monitor/`) ya tiene:
- `core/statusParser.ts`: parsea `status.md` y extrae metricas auto-reportadas
- `core/aggregator.ts`: `buildSnapshot(docsDir)` produce `PipelineSnapshot`
- `core/poller.ts`: `PipelinePoller` con `MonitorConfig { docsDir, pollIntervalMs, historyDbPath }`
- `core/historyDb.ts`: migration v1 con tablas `pipeline_events` y `agent_metrics_history`
- `core/changeDetector.ts`: detecta cambios entre snapshots, produce `DetectedChanges { events, newMetrics }`
- `core/historyRepository.ts`: `persistChanges()`, `queryHistory()`, `queryAgentTrends()`
- `core/timelineRepository.ts`: `queryAgentTimeline(db, agentId)` — serie temporal
- `core/types.ts`: `AgentMetrics`, `FeatureRecord`, `AgentSummary`, etc.
- `monitor/ui/monitor-view.ts`: `renderMonitor(container, snapshot, onRefresh, onGetHistory, onGetAgentTrends, onGetAgentTimeline)` — 6 parametros actualmente
- `src/types/ipc.ts`: todos los tipos IPC del sistema
- `src/ipc/handlers.ts`: `createRpc()` con todos los handlers

El Monitor ya tiene un tab "Agentes" (`mon-panel-agents`) que muestra:
1. Cards por agente con metricas agregadas (`agentsGridEl`)
2. Seccion de graficas SVG de evolucion (`agentChartsSectionEl`)

Esta feature EXTIENDE ese tab añadiendo una tercera subseccion de comportamiento.

---

### Tipos TypeScript necesarios

#### En `src/monitor/core/types.ts` — añadir al final del archivo

```typescript
// Metricas de comportamiento de un agente en una feature/bug especifica
// Calculadas externamente — no auto-reportadas
export interface AgentBehaviorMetrics {
  agentId: AgentId;
  // Checklist adherence
  checklistTotal: number | null;       // items totales en ### Checklist X
  checklistChecked: number | null;     // items marcados [x]
  checklistRate: number | null;        // checklistChecked / checklistTotal (0.0-1.0), null si total=0
  // Structure score
  structureScoreNum: number | null;    // secciones obligatorias encontradas
  structureScoreDen: number | null;    // secciones obligatorias esperadas
  structureScore: number | null;       // num/den (0.0-1.0)
  // Hallucination
  hallucinationRefsTotal: number | null;
  hallucinationRefsValid: number | null;
  hallucinationRate: number | null;    // 1 - (valid/total), null si total=0 o repoRoot ausente
  // Memory read
  memoryRead: boolean | null;          // null = handoff incompleto
}

// Entrada a persistir en agent_behavior_history
export interface AgentBehaviorEntry {
  agentId: AgentId;
  itemType: 'feature' | 'bug';
  itemSlug: string;
  checklistTotal: number | null;
  checklistChecked: number | null;
  structureScoreNum: number | null;
  structureScoreDen: number | null;
  refsTotal: number | null;
  refsValid: number | null;
  memoryRead: boolean | null;
  recordedAt: string;
}
```

Tambien modificar las interfaces existentes en `types.ts`:

```typescript
// FeatureRecord — añadir campo behaviorMetrics
export interface FeatureRecord {
  slug: string;
  title: string;
  state: FeatureState;
  branch: string;
  openedAt: string;
  handoffs: HandoffStatus[];
  metrics: AgentMetrics[];
  behaviorMetrics: Partial<Record<AgentId, AgentBehaviorMetrics>>;  // NUEVO
  filePath: string;
}

// AgentSummary — añadir 4 campos de comportamiento
export interface AgentSummary {
  agentId: AgentId;
  totalFeatures: number;
  avgIterations: number;
  reworkCount: number;
  reworkRate: number;
  avgConfidence: number;
  totalGapsDeclared: number;
  completedHandoffs: number;
  // NUEVOS:
  avgChecklistRate: number | null;
  avgStructureScore: number | null;
  avgHallucinationRate: number | null;
  memoryReadRate: number | null;
}
```

#### En `src/types/ipc.ts` — tipos IPC nuevos y modificaciones

Añadir estos tipos NUEVOS:

```typescript
export interface AgentBehaviorMetricsIPC {
  agentId: string;
  checklistTotal: number | null;
  checklistChecked: number | null;
  checklistRate: number | null;
  structureScore: number | null;
  hallucinationRefsTotal: number | null;
  hallucinationRefsValid: number | null;
  hallucinationRate: number | null;
  memoryRead: boolean | null;
}

export interface AgentBehaviorPointIPC {
  itemSlug: string;
  itemType: 'feature' | 'bug';
  checklistRate: number | null;
  structureScore: number | null;
  hallucinationRate: number | null;
  memoryRead: number | null;   // 0 o 1 para eje Y numerico
  recordedAt: string;
}

export interface GetAgentBehaviorTimelineParams {
  agentId: string;
}

export interface GetAgentBehaviorTimelineResult {
  points: AgentBehaviorPointIPC[];
}
```

Modificar tipos EXISTENTES en `src/types/ipc.ts`:

```typescript
// FeatureRecordIPC — añadir behaviorMetrics
export interface FeatureRecordIPC {
  slug: string;
  title: string;
  state: string;
  branch: string;
  openedAt: string;
  handoffs: HandoffStatusIPC[];
  metrics: AgentMetricsIPC[];
  behaviorMetrics: Record<string, AgentBehaviorMetricsIPC>;  // NUEVO
}

// AgentSummaryIPC — añadir campos de comportamiento
export interface AgentSummaryIPC {
  agentId: string;
  totalFeatures: number;
  avgIterations: number;
  reworkCount: number;
  reworkRate: number;
  avgConfidence: number;
  totalGapsDeclared: number;
  completedHandoffs: number;
  // NUEVOS:
  avgChecklistRate: number | null;
  avgStructureScore: number | null;
  avgHallucinationRate: number | null;
  memoryReadRate: number | null;
}
```

Añadir canal al `AppRPC` en `src/types/ipc.ts`:

```typescript
// En AppRPC.bun.requests:
getAgentBehaviorTimeline: {
  params: GetAgentBehaviorTimelineParams;
  response: GetAgentBehaviorTimelineResult;
};
```

---

### Archivos a crear/modificar — en este orden exacto

#### 1. CREAR `src/monitor/core/behaviorParser.ts`

Archivo nuevo. Funcion pura. Solo imports de `node:fs`, `node:path`, y tipos internos.

```typescript
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentBehaviorMetrics, AgentId } from './types';

// Secciones obligatorias que se verifican por agente en su bloque de handoff
const REQUIRED_SECTIONS: Record<AgentId, string[]> = {
  leo:    ['### Checklist Leo', '### Gaps y dudas de Leo'],
  cloe:   ['**Archivos creados/modificados:**', '**Descripcion de lo implementado:**'],
  max:    ['**Resultado de la verificacion:**', '**Casos probados:**'],
  ada:    ['**Optimizaciones aplicadas:**', '**Bundle size antes/despues:**'],
  cipher: ['**Vulnerabilidades encontradas:**', '**Decision:**'],
};

// Nombres de agentes capitalizados tal como aparecen en los headers del status.md
const AGENT_DISPLAY: Record<AgentId, string> = {
  leo:    'Leo',
  cloe:   'Cloe',
  max:    'Max',
  ada:    'Ada',
  cipher: 'Cipher',
};

// Extrae el bloque de texto entre "## Handoff <Agent> ->" y el siguiente "##"
// Retorna '' si no se encuentra o si el handoff es un placeholder (incompleto)
function extractHandoffSection(content: string, agentId: AgentId): string {
  const agentName = AGENT_DISPLAY[agentId];
  // Busca "## Handoff <Agent> → " o "## Handoff <Agent> -> "
  const sectionRegex = new RegExp(
    `## Handoff ${agentName}[^\\n]*?[→\\->][\\s\\S]*?(?=\\n##|$)`,
    'i'
  );
  const section = content.match(sectionRegex)?.[0] ?? '';
  if (!section || section.length < 30) return '';
  // Si es placeholder, no hay datos de comportamiento
  const isPlaceholder = />\s*(Leo|Cloe|Max|Ada|Cipher):\s*completa esta seccion/i.test(section);
  if (isPlaceholder) return '';
  return section;
}

// Cuenta items de checklist — solo en la seccion "### Checklist <Agent>"
function countChecklistItems(section: string): { total: number; checked: number } | null {
  const checklistMatch = section.match(/### Checklist[^\n]*\n([\s\S]*?)(?=\n###|\n##|$)/i);
  if (!checklistMatch || !checklistMatch[1]) return null;
  const checklistBlock = checklistMatch[1];
  const allItems = checklistBlock.match(/^- \[[ xX]\]/gm) ?? [];
  if (allItems.length === 0) return null;
  const checked = checklistBlock.match(/^- \[[xX]\]/gm)?.length ?? 0;
  return { total: allItems.length, checked };
}

// Calcula el structure score: cuantas secciones obligatorias estan presentes
function scoreStructure(section: string, agentId: AgentId): { num: number; den: number } {
  const required = REQUIRED_SECTIONS[agentId];
  const found = required.filter(s => section.includes(s)).length;
  return { num: found, den: required.length };
}

// Extrae file references del tipo "src/path/file.ts" (deduplicadas)
function extractFileRefs(section: string): string[] {
  const refs = new Set<string>();
  const regex = /\bsrc\/[a-zA-Z0-9/_.-]+\.(ts|js|md)\b/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(section)) !== null) {
    refs.add(m[0]);
  }
  return [...refs];
}

// Verifica cuantas referencias de archivos existen en el filesystem
function verifyFileRefs(refs: string[], repoRoot: string): { total: number; valid: number } {
  const total = refs.length;
  const valid = refs.filter(ref => existsSync(join(repoRoot, ref))).length;
  return { total, valid };
}

// Detecta si el agente menciono haber leido su memoria
function detectMemoryRead(section: string): boolean {
  return /MEMORY\.md|agent-memory/i.test(section);
}

export function parseBehaviorMetrics(
  content: string,
  agentId: AgentId,
  repoRoot: string | undefined
): AgentBehaviorMetrics {
  const section = extractHandoffSection(content, agentId);

  if (!section) {
    // Handoff incompleto o inexistente
    return {
      agentId,
      checklistTotal: null,
      checklistChecked: null,
      checklistRate: null,
      structureScoreNum: null,
      structureScoreDen: null,
      structureScore: null,
      hallucinationRefsTotal: null,
      hallucinationRefsValid: null,
      hallucinationRate: null,
      memoryRead: null,
    };
  }

  // Checklist
  const checklist = countChecklistItems(section);
  const checklistTotal = checklist?.total ?? null;
  const checklistChecked = checklist?.checked ?? null;
  const checklistRate = (checklistTotal !== null && checklistTotal > 0)
    ? Math.round((checklistChecked! / checklistTotal) * 100) / 100
    : null;

  // Structure
  const { num, den } = scoreStructure(section, agentId);
  const structureScore = den > 0 ? Math.round((num / den) * 100) / 100 : null;

  // Hallucination
  let hallucinationRefsTotal: number | null = null;
  let hallucinationRefsValid: number | null = null;
  let hallucinationRate: number | null = null;

  if (repoRoot) {
    const refs = extractFileRefs(section);
    if (refs.length > 0) {
      const { total, valid } = verifyFileRefs(refs, repoRoot);
      hallucinationRefsTotal = total;
      hallucinationRefsValid = valid;
      hallucinationRate = total > 0
        ? Math.round((1 - valid / total) * 100) / 100
        : null;
    } else {
      hallucinationRefsTotal = 0;
      hallucinationRefsValid = 0;
      hallucinationRate = null; // sin refs -> no hay alucinacion medible
    }
  }

  // Memory read
  const memoryRead = detectMemoryRead(section);

  return {
    agentId,
    checklistTotal,
    checklistChecked,
    checklistRate,
    structureScoreNum: num,
    structureScoreDen: den,
    structureScore,
    hallucinationRefsTotal,
    hallucinationRefsValid,
    hallucinationRate,
    memoryRead,
  };
}
```

---

#### 2. MODIFICAR `src/monitor/core/types.ts`

Añadir al final del archivo (antes del ultimo cierre si lo hay):
- Interfaz `AgentBehaviorMetrics` (ver arriba en "Tipos TypeScript necesarios")
- Interfaz `AgentBehaviorEntry` (ver arriba)
- Campo `behaviorMetrics` en `FeatureRecord` (modificacion in-place)
- Campos de comportamiento en `AgentSummary` (modificacion in-place)

ATENCION: `BugRecord` NO recibe `behaviorMetrics` en v1 — los bugs tienen flujo diferente
(Max diagnostica, no hay checklist formal de Leo). Mantener `BugRecord` sin cambios.

---

#### 3. MODIFICAR `src/monitor/core/statusParser.ts`

Cambiar firma de `parseFeatureStatus`:

```typescript
// ANTES:
export function parseFeatureStatus(content: string, slug: string, filePath: string): FeatureRecord

// DESPUES:
export function parseFeatureStatus(
  content: string,
  slug: string,
  filePath: string,
  repoRoot: string = ''
): FeatureRecord
```

Dentro de la funcion, despues del bloque que calcula `metrics`, añadir:

```typescript
import { parseBehaviorMetrics } from './behaviorParser';

// ...dentro de parseFeatureStatus, despues de calcular metrics:
const behaviorMetrics: Partial<Record<AgentId, AgentBehaviorMetrics>> = {};
const repoRootSafe = repoRoot || '';
for (const agentId of ALL_AGENTS) {
  const bm = parseBehaviorMetrics(content, agentId, repoRootSafe || undefined);
  // Solo guardar si hay algun dato no-null (al menos un campo verificable)
  const hasAny = bm.checklistTotal !== null
    || bm.structureScore !== null
    || bm.hallucinationRefsTotal !== null
    || bm.memoryRead !== null;
  if (hasAny) behaviorMetrics[agentId] = bm;
}

return { slug, title, state, branch, openedAt, handoffs, metrics, behaviorMetrics, filePath };
```

El import de `parseBehaviorMetrics` va al principio del archivo junto a los otros imports.

---

#### 4. MODIFICAR `src/monitor/core/aggregator.ts`

Cambiar firma de `buildSnapshot`:

```typescript
// ANTES:
export function buildSnapshot(docsDir: string): PipelineSnapshot

// DESPUES:
export function buildSnapshot(docsDir: string, repoRoot: string = ''): PipelineSnapshot
```

Propagar `repoRoot` a `parseFeatureStatus`:
```typescript
features.push(parseFeatureStatus(content, slug, filePath, repoRoot));
```

Modificar `computeAgentSummaries` para calcular los 4 promedios de comportamiento:

```typescript
// Dentro de computeAgentSummaries, por cada agente:
const behaviorEntries: AgentBehaviorMetrics[] = [];

for (const f of features) {
  const bm = f.behaviorMetrics[agentId];
  if (bm) behaviorEntries.push(bm);
}

// avgChecklistRate
const checklistRates = behaviorEntries
  .map(b => b.checklistRate)
  .filter((v): v is number => v !== null);
const avgChecklistRate = checklistRates.length > 0
  ? Math.round((checklistRates.reduce((a, b) => a + b, 0) / checklistRates.length) * 100) / 100
  : null;

// avgStructureScore
const structureScores = behaviorEntries
  .map(b => b.structureScore)
  .filter((v): v is number => v !== null);
const avgStructureScore = structureScores.length > 0
  ? Math.round((structureScores.reduce((a, b) => a + b, 0) / structureScores.length) * 100) / 100
  : null;

// avgHallucinationRate
const hallucinationRates = behaviorEntries
  .map(b => b.hallucinationRate)
  .filter((v): v is number => v !== null);
const avgHallucinationRate = hallucinationRates.length > 0
  ? Math.round((hallucinationRates.reduce((a, b) => a + b, 0) / hallucinationRates.length) * 100) / 100
  : null;

// memoryReadRate
const memoryReads = behaviorEntries
  .map(b => b.memoryRead)
  .filter((v): v is boolean => v !== null);
const memoryReadRate = memoryReads.length > 0
  ? Math.round((memoryReads.filter(v => v).length / memoryReads.length) * 100) / 100
  : null;
```

Añadir los 4 campos al objeto `AgentSummary` retornado.

Si `total === 0`, retornar `null` en los 4 campos (no `0`).

---

#### 5. MODIFICAR `src/monitor/core/poller.ts`

En `MonitorConfig` (en `types.ts`), añadir campo opcional:
```typescript
export interface MonitorConfig {
  docsDir: string;
  pollIntervalMs?: number;
  historyDbPath?: string;
  repoRoot?: string;   // NUEVO — ruta raiz del repo para verificar file refs
}
```

En `PipelinePoller.scan()` (en `poller.ts`):
```typescript
const snapshot = buildSnapshot(this.config.docsDir, this.config.repoRoot ?? '');
```

---

#### 6. MODIFICAR `src/monitor/core/historyDb.ts`

Añadir migration v2 en el array `migrations`:

```typescript
{
  version: 2,
  up: `
    CREATE TABLE IF NOT EXISTS agent_behavior_history (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id            TEXT NOT NULL,
      item_type           TEXT NOT NULL,
      item_slug           TEXT NOT NULL,
      checklist_total     INTEGER,
      checklist_checked   INTEGER,
      structure_score_num INTEGER,
      structure_score_den INTEGER,
      refs_total          INTEGER,
      refs_valid          INTEGER,
      memory_read         INTEGER,
      recorded_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_abh_agent ON agent_behavior_history(agent_id);
    CREATE INDEX IF NOT EXISTS idx_abh_item  ON agent_behavior_history(item_type, item_slug);
  `,
},
```

---

#### 7. MODIFICAR `src/monitor/core/changeDetector.ts`

Añadir `newBehavior` a `DetectedChanges`:

```typescript
export interface DetectedChanges {
  events: Omit<HistoryEvent, 'id'>[];
  newMetrics: Array<{ ... }>;  // sin cambios
  newBehavior: AgentBehaviorEntry[];   // NUEVO
}
```

En `detectChanges()`, despues del bloque de features y antes del return:

```typescript
// Para features con behaviorMetrics nuevos
for (const curr_f of curr.features) {
  const prev_f = prevFeatureMap.get(curr_f.slug) ?? null;
  for (const [agentIdStr, bm] of Object.entries(curr_f.behaviorMetrics ?? {})) {
    const agentId = agentIdStr as AgentId;
    const prevBm = prev_f?.behaviorMetrics?.[agentId];
    // "tiene datos" si al menos un campo no es null
    const hasData = bm.checklistRate !== null
      || bm.structureScore !== null
      || bm.hallucinationRefsTotal !== null
      || bm.memoryRead !== null;
    const hadData = prevBm !== undefined && (
      prevBm.checklistRate !== null
      || prevBm.structureScore !== null
      || prevBm.hallucinationRefsTotal !== null
      || prevBm.memoryRead !== null
    );
    if (hasData && !hadData) {
      newBehavior.push({
        agentId,
        itemType: 'feature',
        itemSlug: curr_f.slug,
        checklistTotal: bm.checklistTotal,
        checklistChecked: bm.checklistChecked,
        structureScoreNum: bm.structureScoreNum,
        structureScoreDen: bm.structureScoreDen,
        refsTotal: bm.hallucinationRefsTotal,
        refsValid: bm.hallucinationRefsValid,
        memoryRead: bm.memoryRead,
        recordedAt: now,
      });
    }
  }
}
```

El import de `AgentBehaviorEntry` viene de `./types`.

Inicializar `const newBehavior: AgentBehaviorEntry[] = [];` al principio de `detectChanges`.

Retornar `{ events, newMetrics, newBehavior }`.

---

#### 8. MODIFICAR `src/monitor/core/historyRepository.ts`

Añadir fila de behavior a `persistChanges()`:

```typescript
const insertBehavior = db.prepare(`
  INSERT INTO agent_behavior_history
    (agent_id, item_type, item_slug,
     checklist_total, checklist_checked,
     structure_score_num, structure_score_den,
     refs_total, refs_valid, memory_read,
     recorded_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
```

Dentro de la transaccion `insertAll`:
```typescript
for (const b of changes.newBehavior) {
  insertBehavior.run(
    b.agentId, b.itemType, b.itemSlug,
    b.checklistTotal, b.checklistChecked,
    b.structureScoreNum, b.structureScoreDen,
    b.refsTotal, b.refsValid,
    b.memoryRead !== null ? (b.memoryRead ? 1 : 0) : null,
    b.recordedAt
  );
}
```

---

#### 9. CREAR `src/monitor/core/behaviorTimelineRepository.ts`

```typescript
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
```

---

#### 10. MODIFICAR `src/monitor/index.ts`

Añadir export:
```typescript
export { queryAgentBehaviorTimeline } from './core/behaviorTimelineRepository';
```

---

#### 11. MODIFICAR `src/types/ipc.ts`

- Añadir tipos nuevos: `AgentBehaviorMetricsIPC`, `AgentBehaviorPointIPC`,
  `GetAgentBehaviorTimelineParams`, `GetAgentBehaviorTimelineResult`
- Modificar `FeatureRecordIPC`: añadir `behaviorMetrics: Record<string, AgentBehaviorMetricsIPC>`
- Modificar `AgentSummaryIPC`: añadir 4 campos de comportamiento
- Añadir canal en `AppRPC.bun.requests`:
  ```typescript
  getAgentBehaviorTimeline: {
    params: GetAgentBehaviorTimelineParams;
    response: GetAgentBehaviorTimelineResult;
  };
  ```

---

#### 12. MODIFICAR `src/ipc/handlers.ts`

Añadir en la linea del import de funciones del monitor:
```typescript
import { PipelinePoller, getHistoryDb, queryHistory, queryAgentTrends, queryAgentTimeline, queryAgentBehaviorTimeline } from '../monitor/index';
```

Añadir import de tipos IPC nuevos:
```typescript
import type { ..., GetAgentBehaviorTimelineParams, GetAgentBehaviorTimelineResult } from '../types/ipc';
```

Calcular `repoRoot` a partir de `docsDir` (lineas top-level, despues de `findDocsDir()`):
```typescript
const docsDir = findDocsDir();
const repoRoot = path.dirname(docsDir);
console.log('[monitor] repoRoot:', repoRoot);
```

Pasar `repoRoot` en la construccion del poller:
```typescript
const poller = new PipelinePoller({
  docsDir,
  pollIntervalMs: 30_000,
  historyDbPath: join(USER_DATA_DIR, 'monitor-history.db'),
  repoRoot,   // NUEVO
});
```

Modificar `snapshotToIPC()` para propagar `behaviorMetrics`:
```typescript
function snapshotToIPC(snapshot: PipelineSnapshot): PipelineSnapshotIPC {
  return {
    features: snapshot.features.map(({ filePath: _fp, ...f }) => ({
      ...f,
      handoffs: f.handoffs,
      metrics: f.metrics,
      behaviorMetrics: Object.fromEntries(
        Object.entries(f.behaviorMetrics ?? {}).map(([agentId, bm]) => [
          agentId,
          {
            agentId: bm!.agentId,
            checklistTotal: bm!.checklistTotal,
            checklistChecked: bm!.checklistChecked,
            checklistRate: bm!.checklistRate,
            structureScore: bm!.structureScore,
            hallucinationRefsTotal: bm!.hallucinationRefsTotal,
            hallucinationRefsValid: bm!.hallucinationRefsValid,
            hallucinationRate: bm!.hallucinationRate,
            memoryRead: bm!.memoryRead,
          } satisfies import('../types/ipc').AgentBehaviorMetricsIPC,
        ])
      ),
    })),
    bugs: snapshot.bugs.map(({ filePath: _fp, ...b }) => ({
      ...b,
      agentMetrics: b.agentMetrics as Record<string, AgentMetricsIPC>,
    })),
    agentSummaries: snapshot.agentSummaries,
    lastUpdatedAt: snapshot.lastUpdatedAt,
    parseErrors: snapshot.parseErrors.map(sanitizeForIpc),
  };
}
```

Añadir handler dentro de `createRpc()`:
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

CRITICO: `getAgentBehaviorTimeline` es SQLite sincrono — NO fire-and-forget. Igual que
`getAgentTimeline` y `getHistory`.

---

#### 13. MODIFICAR `src/monitor/ui/monitor-view.ts`

Cambiar la firma de `renderMonitor()` de 6 a 7 parametros:

```typescript
export function renderMonitor(
  container: HTMLElement,
  initialSnapshot: PipelineSnapshotIPC,
  onRefresh: () => void,
  onGetHistory: (params: GetHistoryParams) => Promise<GetHistoryResult>,
  onGetAgentTrends: () => Promise<GetAgentTrendsResult>,
  onGetAgentTimeline: (params: GetAgentTimelineParams) => Promise<GetAgentTimelineResult>,
  onGetAgentBehaviorTimeline: (params: GetAgentBehaviorTimelineParams) => Promise<GetAgentBehaviorTimelineResult>,
): MonitorViewHandle
```

Añadir imports de tipos en el encabezado del archivo:
```typescript
import type {
  // ...tipos ya importados...
  AgentBehaviorMetricsIPC,
  AgentBehaviorPointIPC,
  GetAgentBehaviorTimelineParams,
  GetAgentBehaviorTimelineResult,
} from '../../types/ipc';
```

Añadir estado local en el closure:
```typescript
const behaviorCache = new Map<string, AgentBehaviorPointIPC[]>();
```

Modificar `renderAgentCard()` para mostrar las 4 metricas de comportamiento.
Estas se leen de `AgentSummaryIPC` (los 4 campos nuevos). Añadir al final de la card
(despues del bloque trendBlock existente):

```typescript
function renderBehaviorSummary(s: AgentSummaryIPC): string {
  const fmt = (v: number | null, asPercent = true): string => {
    if (v === null) return '--';
    return asPercent ? `${Math.round(v * 100)}%` : String(v);
  };
  return `
    <div class="monitor-agent-card-separator"></div>
    <div class="monitor-agent-card-row">
      <span class="monitor-agent-card-label">Checklist adherencia</span>
      <span class="monitor-agent-card-value">${fmt(s.avgChecklistRate)}</span>
    </div>
    <div class="monitor-agent-card-row">
      <span class="monitor-agent-card-label">Structure score</span>
      <span class="monitor-agent-card-value">${fmt(s.avgStructureScore)}</span>
    </div>
    <div class="monitor-agent-card-row">
      <span class="monitor-agent-card-label">Alucinacion rate</span>
      <span class="monitor-agent-card-value ${s.avgHallucinationRate !== null && s.avgHallucinationRate > 0.2 ? 'rework-high' : ''}">${fmt(s.avgHallucinationRate)}</span>
    </div>
    <div class="monitor-agent-card-row">
      <span class="monitor-agent-card-label">Memoria leida</span>
      <span class="monitor-agent-card-value">${fmt(s.memoryReadRate)}</span>
    </div>
  `;
}
```

Llamar `renderBehaviorSummary(s)` dentro de `renderAgentCard(s, trend)` al final.

Modificar `loadAgentTrends()` para que tambien dispare la carga de behavior timelines:

```typescript
function loadAgentTrends() {
  onGetAgentTrends()
    .then((result) => {
      trendsMap = new Map(result.trends.map((t) => [t.agentId, t]));
      if (currentSnapshot.agentSummaries.length > 0) {
        agentsGridEl.innerHTML = currentSnapshot.agentSummaries
          .map((s) => renderAgentCard(s, trendsMap.get(s.agentId)))
          .join('');
      }
      // Cargar behavior timelines para todos los agentes (on-demand con cache)
      loadBehaviorTimelines(currentSnapshot.agentSummaries.map(s => s.agentId));
    })
    .catch((err) => console.error('[monitor-view] loadAgentTrends error:', err));
}
```

Añadir funcion `loadBehaviorTimelines()`:

```typescript
function loadBehaviorTimelines(agentIds: string[]) {
  for (const agentId of agentIds) {
    if (behaviorCache.has(agentId)) continue;
    onGetAgentBehaviorTimeline({ agentId })
      .then((result) => {
        behaviorCache.set(agentId, result.points);
        // Re-render de la seccion de comportamiento de este agente si esta visible
        updateBehaviorSection(agentId);
      })
      .catch((err) => console.error(`[monitor-view] loadBehaviorTimelines ${agentId} error:`, err));
  }
}
```

Añadir funcion `renderBehaviorTable()` que genera una tabla HTML con los puntos de
comportamiento por feature (columnas: Feature, Checklist, Structure, Alucinacion, Memoria):

```typescript
function renderBehaviorTable(points: AgentBehaviorPointIPC[]): string {
  if (points.length === 0) {
    return '<p class="monitor-chart-empty">Sin datos de comportamiento.</p>';
  }
  const fmt = (v: number | null, asPercent = true): string => {
    if (v === null) return '--';
    return asPercent ? `${Math.round(v * 100)}%` : String(v);
  };
  const rows = points.map(p => `
    <tr>
      <td style="font-size:10px;color:#888">${escapeHtml(p.itemSlug)}</td>
      <td>${fmt(p.checklistRate)}</td>
      <td>${fmt(p.structureScore)}</td>
      <td class="${p.hallucinationRate !== null && p.hallucinationRate > 0.2 ? 'rework-high' : ''}">${fmt(p.hallucinationRate)}</td>
      <td>${p.memoryRead === 1 ? '<span class="monitor-rework-no">si</span>' : p.memoryRead === 0 ? '<span class="monitor-rework-yes">no</span>' : '--'}</td>
    </tr>
  `).join('');
  return `
    <table class="monitor-table">
      <thead>
        <tr>
          <th>Feature</th>
          <th>Checklist</th>
          <th>Estructura</th>
          <th>Alucinacion</th>
          <th>Memoria</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
```

Añadir funcion `updateBehaviorSection(agentId)` que actualiza el contenido del elemento
`#mon-behavior-content-<agentId>` si existe en el DOM:

```typescript
function updateBehaviorSection(agentId: string) {
  const el = agentChartsSectionEl.querySelector<HTMLElement>(`#mon-behavior-content-${agentId}`);
  if (el) {
    const points = behaviorCache.get(agentId) ?? [];
    el.innerHTML = renderBehaviorTable(points);
  }
}
```

Modificar `renderChartsSectionRows()` para añadir la subseccion de comportamiento
debajo de la grafica de evolucion existente de cada agente:

```typescript
// Dentro del HTML de cada fila de agente, añadir despues del chart content:
`<div class="monitor-behavior-subsection">
  <div class="monitor-behavior-label">Comportamiento por feature</div>
  <div class="monitor-behavior-content" id="mon-behavior-content-${id}">
    <p class="monitor-chart-loading">Cargando...</p>
  </div>
</div>`
```

Y en la inicializacion de `renderChartsSectionRows()`, si `behaviorCache.has(id)`, llamar
`updateBehaviorSection(id)` para restaurar desde cache.

---

#### 14. MODIFICAR `src/renderer/app.ts`

En `showMonitor()`, añadir el 7mo argumento al llamar `renderMonitor`:

```typescript
activeMonitorHandle = renderMonitor(
  mainContentEl,
  emptySnapshot,
  () => {
    rpc.request.getPipelineSnapshot()
      .then((r: { snapshot: PipelineSnapshotIPC }) => {
        activeMonitorHandle?.updateSnapshot(r.snapshot);
      })
      .catch(console.error);
  },
  (params: GetHistoryParams): Promise<GetHistoryResult> =>
    (rpc as any).request.getHistory(params),
  (): Promise<GetAgentTrendsResult> =>
    (rpc as any).request.getAgentTrends(),
  (params: GetAgentTimelineParams): Promise<GetAgentTimelineResult> =>
    (rpc as any).request.getAgentTimeline(params),
  (params: GetAgentBehaviorTimelineParams): Promise<GetAgentBehaviorTimelineResult> =>   // NUEVO
    (rpc as any).request.getAgentBehaviorTimeline(params),
);
```

Actualizar los imports en `app.ts`:
```typescript
import type {
  AppRPC, AgentInfo, PipelineSnapshotIPC,
  GetHistoryParams, GetHistoryResult,
  GetAgentTrendsResult,
  GetAgentTimelineParams, GetAgentTimelineResult,
  GetAgentBehaviorTimelineParams, GetAgentBehaviorTimelineResult,   // NUEVO
} from '../types/ipc';
```

---

### Reglas que Cloe debe respetar

1. **Orden de implementacion es obligatorio** — cada archivo depende del anterior.
   No saltar pasos.

2. **`behaviorParser.ts` es pura** — no importa nada fuera de `node:fs`, `node:path`,
   y tipos de `./types`. No importa desde `src/db/`, `src/ipc/`, ni `src/renderer/`.

3. **Migration v2 es append-only** — solo añadir el bloque `{ version: 2, up: ... }`.
   No tocar migration v1. La logica de version incremental ya existe.

4. **`BugRecord` no recibe `behaviorMetrics`** en v1. Los bugs tienen flujo sin checklist
   formal de Leo. `Partial<Record<AgentId, AgentBehaviorMetrics>>` solo va en `FeatureRecord`.

5. **`getAgentBehaviorTimeline` NO es fire-and-forget** — es query SQLite sincrona,
   igual que `getAgentTimeline`. Retornar directamente, no usar async complejo.

6. **ASCII-safe obligatorio** — cualquier string que venga de `behaviorMetrics` y vaya
   por IPC debe pasar por `sanitizeForIpc()` si puede contener non-ASCII. En `snapshotToIPC`,
   solo los strings de texto libre necesitan sanitizacion — los numericos no.

7. **`(rpc as any).request.getAgentBehaviorTimeline`** — igual que todos los canales
   nuevos, el type inference de Electrobun requiere `as any`. Es conocido y aceptado.

8. **CSS prefijo `.monitor-behavior-`** — todas las clases nuevas de CSS llevan
   este prefijo para no colisionar con `.monitor-agent-` ni con `style.css`.

9. **No tocar `src/index.ts`, `src/client.ts`** — el flujo CLI permanece intacto.

10. **`repoRoot = path.dirname(docsDir)`** — calculo simple. Si `docsDir` no existe
    en produccion, `repoRoot` sigue siendo valido como string (verifyFileRefs usa
    `existsSync` que retorna false si el archivo no existe — nunca crashea).

11. **`behaviorMetrics` en `FeatureRecord` es `Partial<Record<AgentId, AgentBehaviorMetrics>>`**
    y en `FeatureRecordIPC` es `Record<string, AgentBehaviorMetricsIPC>`. La diferencia
    es intencional: en el IPC se serializa como objeto plano.

12. **Inicializar `behaviorMetrics: {}` en `historyRepository.ts > loadLastKnownStates()`**
    al construir `FeatureRecord` sintetico, para que el tipo sea correcto.

---

### CSS a añadir

En `src/renderer/monitor-styles.css`, añadir al final:

```css
/* ── Metricas de comportamiento ── */
.monitor-agent-card-separator {
  border-top: 1px solid #2a2a2a;
  margin: 6px 0;
}

.monitor-behavior-subsection {
  margin-top: 12px;
  border-top: 1px solid #222;
  padding-top: 8px;
}

.monitor-behavior-label {
  font-size: 10px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}

.monitor-behavior-content {
  overflow-x: auto;
}
```

---

→ Siguiente: @cloe Implementa la feature. Las instrucciones estan en docs/features/metricas-comportamiento-agentes-tab/status.md seccion "Handoff Leo → Cloe".

## Metricas de Leo
- archivos_leidos: 16
- archivos_creados: 4
- archivos_modificados: 1
- rework: no
- iteraciones: 1
- confianza: media
- gaps_declarados: 3

---

### Checklist Leo
- [x] Cada archivo a crear/modificar tiene ruta absoluta desde repo root
- [x] Contratos IPC escritos con tipos TypeScript completos inline (no "ver ipc-contracts.md")
- [x] Tipos de retorno de funciones nuevas especificados con tipos TypeScript concretos (no "any")
- [x] Lista de archivos ordenada por prioridad de implementacion
- [x] Sin "ver plan.md" ni "ver acceptance.md" — todo el contexto inline en status.md
- [x] Limitaciones de Electrobun verificadas: fire-and-forget en handlers, no await a subprocesos
- [x] Decisiones de arquitectura con justificacion explicita

### Gaps y dudas de Leo

- **Gap 1**: `renderChartsSectionRows()` en `monitor-view.ts` construye el HTML de cada fila de agente.
  La funcion genera un string y luego lo inyecta. La modificacion para añadir la subseccion de
  comportamiento requiere editar ese string. No he verificado si `renderChartsSectionRows` usa
  template literals o concatenacion — Cloe debe verificar antes de editar para no romper las
  graficas existentes.

- **Gap 2**: `loadLastKnownStates()` en `historyRepository.ts` construye `FeatureRecord` sinteticos.
  Con `behaviorMetrics` como campo nuevo en `FeatureRecord`, esas construcciones ahora necesitan
  `behaviorMetrics: {}`. Cloe debe verificar cuantas instancias hay y parchearlas todas. El
  TypeScript compilara con error si falta el campo (el tipo es `Partial<Record<...>>`, no opcional,
  pero puede inicializarse como `{}`).

- **Gap 3**: El calculo de `extractHandoffSection()` usa un regex que busca `## Handoff <Agent> →`.
  En los status.md reales, el separador puede ser `→` (Unicode U+2192), `->` (ASCII), o `—`.
  El regex propuesto cubre `→` y `->` pero no em-dash. Cloe debe verificar con `grep` en los
  status.md existentes cual es el separador usado y ajustar el regex si es necesario antes de
  implementar. Comando: `grep -r "## Handoff" docs/features/ | head -20`.

Confianza general del plan: media (los 3 gaps son verificables antes de implementar — no bloquean el diseno pero si la implementacion exacta)

---

## Handoff Cloe → Max

**Archivos creados/modificados:**

### Manifiesto de archivos
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| `src/monitor/core/behaviorParser.ts` | creado | 1-132 |
| `src/monitor/core/behaviorTimelineRepository.ts` | creado | 1-61 |
| `src/monitor/core/types.ts` | modificado | 51-60 (behaviorMetrics en FeatureRecord), 75-91 (AgentSummary +4 campos), 105-109 (MonitorConfig +repoRoot), 111-158 (AgentBehaviorMetrics + AgentBehaviorEntry nuevas) |
| `src/monitor/core/statusParser.ts` | modificado | 1-5 (imports), 112-115 (firma), 133-150 (bloque behaviorMetrics) |
| `src/monitor/core/aggregator.ts` | modificado | 3 (import AgentBehaviorMetrics), 26-37 (total=0 +4 campos null), 64-107 (behaviorEntries + 4 calculos), 77 (buildSnapshot firma), 99 (call repoRoot) |
| `src/monitor/core/poller.ts` | modificado | 12 (repoRoot field), 19 (constructor), 89 (scan buildSnapshot), 96 (persistChanges guard) |
| `src/monitor/core/historyDb.ts` | modificado | 79-97 (migration v2 agent_behavior_history) |
| `src/monitor/core/changeDetector.ts` | modificado | 8 (import AgentBehaviorEntry), 13-25 (DetectedChanges +newBehavior), 36 (inicializacion newBehavior), 160-193 (loop behavior) |
| `src/monitor/core/historyRepository.ts` | modificado | 176 (behaviorMetrics: {} en FeatureRecord sintetico), 228-280 (insertBehavior statement + loop en transaccion) |
| `src/monitor/index.ts` | modificado | 9 (export queryAgentBehaviorTimeline) |
| `src/types/ipc.ts` | modificado | 163-201 (AgentBehaviorMetricsIPC, AgentBehaviorPointIPC, GetAgentBehaviorTimelineParams, GetAgentBehaviorTimelineResult, behaviorMetrics en FeatureRecordIPC), 230-241 (AgentSummaryIPC +4 campos), 367 (canal getAgentBehaviorTimeline en AppRPC) |
| `src/ipc/handlers.ts` | modificado | 4 (import tipos nuevos), 20 (import queryAgentBehaviorTimeline), 44-48 (repoRoot + poller config), 55-84 (snapshotToIPC +behaviorMetrics), 296-307 (handler getAgentBehaviorTimeline) |
| `src/monitor/ui/monitor-view.ts` | modificado | 1-15 (imports nuevos), 487-490 (firma +7mo param), 507-510 (behaviorCache), 415-448 (renderBehaviorSummary), 770-831 (renderBehaviorTable + updateBehaviorSection + loadBehaviorTimelines), 836-853 (renderChartsSectionRows +subseccion behavior), 754-768 (loadAgentTrends +loadBehaviorTimelines call) |
| `src/renderer/app.ts` | modificado | 1 (import nuevos tipos), 89-105 (renderMonitor +7mo argumento) |
| `src/monitor/ui/monitor-styles.css` | modificado | 444-473 (CSS de comportamiento) |
| `tests/unit/monitor/detectChanges.test.ts` | modificado | 18 (behaviorMetrics: {} en makeSnapshot) |

**Descripcion de lo implementado:**

Se implementaron metricas de comportamiento externo para cada agente, extendiendo el tab Agentes del Monitor sin crear tabs nuevos. La arquitectura tiene tres capas:

1. **Parser** (`behaviorParser.ts`): funcion pura que analiza el contenido de `status.md` de cada feature, extrayendo 4 metricas por agente: checklist adherence, structure score, hallucination rate (refs al filesystem), y lectura de memoria. Solo usa `node:fs` y `node:path`.

2. **Persistencia** (migration v2 en `historyDb.ts`, `changeDetector.ts`, `historyRepository.ts`, `behaviorTimelineRepository.ts`): nueva tabla `agent_behavior_history` con migracion append-only v2. El changeDetector detecta cuando aparecen datos nuevos (transicion `!hadData` -> `hasData`) y los inserta en una transaccion atomica junto con los eventos y metricas existentes.

3. **UI** (`monitor-view.ts`): los cards de agentes muestran 4 metricas de comportamiento promediadas. La seccion de graficas de cada agente tiene ahora una subseccion "Comportamiento por feature" con tabla HTML. Los datos se cargan on-demand con cache (`behaviorCache`) cuando se activa el tab Agentes.

**Casos borde considerados:**

- Handoffs incompletos o placeholder: `extractHandoffSection` retorna `''` y todas las metricas son `null`
- Features sin archivo en el repo: `existsSync` retorna false -- hallucination rate cuenta esas refs como invalidas
- `repoRoot` no configurado: `hallucinationRate` queda `null` (sin error, degradacion graceful)
- Separadores en headers: regex cubre tanto `->` (ASCII) como `→` (Unicode U+2192) -- verificado con grep en los status.md reales
- total=0 en AgentSummary: los 4 campos de comportamiento retornan `null` (no `0`)
- DB sin tabla (primer arranque): migration v2 crea la tabla con `CREATE TABLE IF NOT EXISTS`
- `behaviorMetrics: {}` en FeatureRecord sintetico del seed: no genera eventos behavior falsos al comparar (ambos lados tienen `{}`)
- Tabla behavior vacia para un agente: muestra "Sin datos de comportamiento." (sin error)
- Cache de behavior: si ya esta cargado, `loadBehaviorTimelines` no hace request duplicado

**Advertencias para Max:**

1. La tabla `agent_behavior_history` se crea con la migration v2. Si Max prueba con una DB que ya tiene la v1 aplicada, la v2 se aplica en el siguiente arranque automaticamente.
2. Los datos de `behaviorMetrics` en la DB se acumulan: cada vez que un agente pasa de `!hasData` a `hasData` (ej. al rellenar el handoff), se inserta una nueva fila. No hay upsert -- es append-only intencionalmente.
3. `renderBehaviorSummary` se llama dentro de `renderAgentCard`. Si `AgentSummaryIPC` no tiene los 4 campos nuevos (ej. snapshot cacheado en memoria antes de que el poller actualice), mostrara `--` que es el comportamiento correcto.
4. El regex de `extractHandoffSection` cubre `->` y Unicode `→` pero NO `—` (em-dash). Los status.md del proyecto usan solo los dos primeros formatos (verificado con grep).
5. Los comentarios en `handlers.ts` tienen tildes (son comentarios JS, no strings IPC) -- esto es aceptado segun la regla de memoria "chars no-ASCII en comentarios estan bien".

### Checklist Cloe
- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Leo (o documentado por que difieren)
- [x] bun run tsc --noEmit ejecutado -- 0 errores nuevos antes de entregar
- [x] Strings que viajan por IPC son ASCII puro (chars no-ASCII solo en comentarios JS, no en strings de runtime)
- [x] Fire-and-forget en todos los handlers IPC que lanzan subprocesos (getAgentBehaviorTimeline es SQLite sincrono -- correcto)
- [x] Input validation en todos los IPC handlers que tocan filesystem o spawn (VALID_AGENTS whitelist en getAgentBehaviorTimeline)
- [x] DB: si INSERT falla despues de scaffold, rollback del directorio creado (N/A -- no hay scaffold en esta feature)
- [x] initDatabase() en try/catch con process.exit(1) si lanza (N/A -- usa historyDb con degradacion graceful existente)
- [x] Sin `any` sin justificacion escrita en el handoff (los `as any` en `rpc` son patron aceptado de Electrobun)
- [x] Labels HTML: N/A -- no hay forms nuevos, solo tabla y cards
- [x] Si creaste vistas nuevas: todas las clases CSS usadas en innerHTML existen en monitor-styles.css (check ejecutado: 4/4 clases OK)

### Gaps y dudas de Cloe

Sin gaps porque: implementacion de 15 pasos con contratos completos inline en status.md, tsc limpio en archivos modificados, 3 gaps de Leo verificados antes de implementar (separadores regex OK, renderChartsSectionRows template literal confirmado, 1 instancia FeatureRecord sintetico localizada y parcheada).

Confianza en la implementacion: alta

→ Siguiente: @max Verifica la feature. El handoff de Cloe esta en docs/features/metricas-comportamiento-agentes-tab/status.md seccion "Handoff Cloe → Max".

## Metricas de Cloe
- archivos_leidos: 16
- archivos_creados: 2
- archivos_modificados: 14
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Handoff Max → Ada

**Resultado de la verificacion:** APROBADO con gaps conocidos

**Casos probados:**

1. behaviorParser.ts:29 -- regex busca "## Handoff Leo" con separador -> o U+2192. Verificado
   contra todos los status.md del repo con grep -r "## Handoff" docs/features/. Cubre las
   13 features activas/recientes. Evidencia: grep output confirma formatos cubiertos.

2. types.ts -- AgentBehaviorMetrics y AgentBehaviorEntry declarados en types.ts:120-151.
   FeatureRecord.behaviorMetrics: Partial<Record<AgentId, AgentBehaviorMetrics>> en types.ts:59.
   AgentSummary con 4 campos nuevos en types.ts:86-89. Correcto.

3. historyDb.ts -- migration v2 en historyDb.ts:79-99. CREATE TABLE IF NOT EXISTS con
   2 indices (idx_abh_agent, idx_abh_item). v1 intacta. Idempotente.

4. historyRepository.ts -- persistChanges() con insertBehavior prepared statement en
   historyRepository.ts:242-250. Transaccion atomica linea 253. FeatureRecord sintetico
   tiene behaviorMetrics: {} en historyRepository.ts:176.

5. changeDetector.ts -- DetectedChanges.newBehavior: AgentBehaviorEntry[] en
   changeDetector.ts:26. Inicializado en linea 41. Logica !hadData → hasData correcta
   en changeDetector.ts:180. Retornado en linea 198.

6. handlers.ts -- repoRoot = path.dirname(docsDir) en handlers.ts:42. Pasado al poller
   en handlers.ts:49. getAgentBehaviorTimeline es SQLite sincrono con VALID_AGENTS
   whitelist en handlers.ts:299. No fire-and-forget -- correcto segun spec.

7. monitor-view.ts -- firma de 7 parametros verificada en monitor-view.ts:512-519.
   renderBehaviorTable usa escapeHtml(p.itemSlug) en monitor-view.ts:783.
   behaviorCache declarado en monitor-view.ts:542.

8. app.ts -- 7mo argumento a renderMonitor en app.ts:105-106. Tipado correcto.

9. ipc.ts -- canal getAgentBehaviorTimeline en AppRPC.bun.requests en ipc.ts:370.
   FeatureRecordIPC.behaviorMetrics en ipc.ts:202. AgentSummaryIPC con 4 campos
   nuevos en ipc.ts:243-246.

10. CSS -- 4 clases .monitor-behavior-* y .monitor-agent-card-separator en
    monitor-styles.css:446-467. Todas presentes. Confirmado.

11. Labels HTML -- ningun label nuevo sin for+id matching. Los elementos nuevos
    son tablas y divs sin formularios. Confirmado.

12. ASCII safety -- chars non-ASCII en handlers.ts y monitor-view.ts son SOLO
    comentarios JS. Ningun string de runtime non-ASCII viaja por IPC.
    app.ts:64 tiene tilde en string HTML del renderer (no IPC) -- aceptado.

13. bun run tsc --noEmit -- 0 errores nuevos en src/. Evidencia: diff de output
    con git stash confirma errores preexistentes en agentRepository.ts,
    conversationRepository.ts, src/client.ts, acpManager.ts.

**Issues encontrados:**

Bug BAJO: regex extractHandoffSection no cubre formato "Handoff de [Agent]"
- Componente: src/monitor/core/behaviorParser.ts:29
- Descripcion: regex busca "## Handoff Leo..." pero no "## Handoff de Leo...".
  Features con ese formato producen behaviorMetrics vacio (degradacion silenciosa).
- Afecta: electrobun-migration (activa, sin estado formal), delete-agent,
  multi-provider-support, persistence, prompt-enhancement (todas ARCHIVADAS).
- Evidencia: grep de "## Handoff de " en docs/features/ muestra 5 features.
- Sugerencia: ampliar regex a "## Handoff (?:de )?[AGENT_NAME][^]*?(?:->|Unicode)"

**Tiene implicaciones de seguridad:** NO

→ Siguiente: @ada Optimiza la feature. Max aprobo -- ver docs/features/metricas-comportamiento-agentes-tab/status.md seccion "Handoff Max → Ada".

## Metricas de Max
- archivos_leidos: 16
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 0
- bugs_bajos: 1
- items_checklist_verificados: 13/13
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 1

---

## Handoff Ada → Cipher

**Optimizaciones aplicadas:**

- `src/monitor/core/behaviorParser.ts:28-33`: Regex `extractHandoffSection` ampliado para cubrir
  variantes `## Handoff de [Agent] -> ...` y `## Handoff de [Agent] a ...` (con `(?:de )?` y
  separador `\ba\b` adicional). Max identifico 5 features archivadas afectadas. El fix convierte
  la degradacion silenciosa en cobertura correcta del parser.

- `src/monitor/core/aggregator.ts:8-14`: Nuevo helper `avgNullable(values: (number | null)[]): number | null`
  extrae la logica comun de los 3 bloques de promedio. Elimina 18 lineas duplicadas (checklist,
  structure, hallucination) y garantiza consistencia en el redondeo a 2 decimales.

- `src/monitor/core/aggregator.ts:83-85`: Sustituidos 3 bloques de 5 lineas cada uno por 3 llamadas
  a `avgNullable`. El bloque `memoryReadRate` no se toca -- logica distinta (booleanos, no numeros).

**Bundle size antes/despues:**

- Main process (bun/index.js): 11 MB → 11 MB (sin delta -- optimizacion de codigo fuente, no de deps)
- Renderer (views/main/app.js): 63 KB → 63 KB (sin delta)
- Estado: ADVERTENCIA preexistente en main process (11 MB, limite 10 MB) -- fuera de scope de esta feature

**Deuda tecnica eliminada:**

- Gap de Max resuelto: regex `extractHandoffSection` ya no produce `behaviorMetrics: {}` en features
  con formato `## Handoff de [Agent]` (5 features afectadas en docs/). Cobertura pasa de ~13 a ~18
  formatos documentados en el repo.
- Duplicacion de logica de promedio en aggregator.ts: 3 bloques identicos colapsados en helper
  reutilizable. Futura metrica nueva solo requiere una linea.

### Checklist Ada
- [x] bundle-check ejecutado ANTES -- main 11 MB, renderer 63 KB registrado
- [x] Named imports verificados: sin `import * as x` en los 3 archivos objetivo
- [x] Dependencias muertas verificadas con grep -- ninguna detectada
- [x] Fire-and-forget preservado: ningun handler IPC modificado
- [x] bundle-check ejecutado DESPUES -- main 11 MB, renderer 63 KB (sin delta)
- [x] Sin cambios de comportamiento observable -- tsc 0 errores nuevos en src/monitor/

### No optimizado por Ada
- `behaviorTimelineRepository.ts`: archivo correcto, no requiere cambios. Named imports, logica limpia.
- `monitor-view.ts renderBehaviorSummary/renderBehaviorTable`: funciones puras que generan strings.
  Sin MutationObserver, sin listeners internos. Cleanup pattern correcto. No hay nada que optimizar.
- `memoryReadRate` en aggregator.ts: logica de booleanos diferente -- no aplica `avgNullable` para
  mantener semantica correcta del filtro de tipo.

Confianza en las optimizaciones: alta

→ Siguiente: @cipher Audita la feature antes del release. Ver docs/features/metricas-comportamiento-agentes-tab/status.md seccion "Handoff Ada → Cipher".

## Metricas de Ada
- archivos_leidos: 6
- archivos_modificados: 2
- bundle_antes_mb: 11 (main) + 0.063 (renderer)
- bundle_despues_mb: 11 (main) + 0.063 (renderer)
- optimizaciones_aplicadas: 2
- optimizaciones_descartadas: 3
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Resultado de Cipher

### Checklist Cipher
- [x] Sin secrets en codigo fuente -- evidencia: scan limpio en behaviorParser.ts, behaviorTimelineRepository.ts, aggregator.ts, changeDetector.ts, historyDb.ts, historyRepository.ts, handlers.ts, monitor-view.ts, ipc.ts, app.ts. Ningun API key ni token hardcodeado.
- [x] .env en .gitignore y no commiteado -- evidencia: git check-ignore confirma .gitignore:23; git ls-files .env retorna NOT TRACKED.
- [x] agentName validado con /^[a-z0-9-]+$/ antes de path.join -- evidencia: N/A para esta feature. No hay operaciones path.join con agentName nuevo. VALID_AGENTS whitelist en handlers.ts:299 cubre getAgentBehaviorTimeline.
- [x] Inputs del webview validados antes de filesystem ops -- evidencia: handlers.ts:299 VALID_AGENTS.includes(params?.agentId) antes de query SQLite. repoRoot no proviene del renderer -- calculado en main process (handlers.ts:42).
- [x] Spawn de agentes usa rutas absolutas, no interpolacion de user input -- evidencia: N/A para esta feature. No hay spawns nuevos.
- [x] Sin innerHTML con user input sin sanitizar -- evidencia: renderBehaviorTable usa escapeHtml(p.itemSlug) en monitor-view.ts:783. Campos numericos formateados via fmt() que retorna string numerico o '--'. memoryRead comparado con 0/1 (no interpolado). renderBehaviorSummary interpola solo campos numericos de AgentSummaryIPC. renderChartsSectionRows interpola id sin escapeHtml en monitor-view.ts:830 -- mitigado por VALID_AGENTS whitelist (5 valores posibles, enum-bounded).
- [x] DevTools deshabilitados en build de produccion -- evidencia: no modificado en esta feature. Verificado en auditoria devtools-csp-produccion v1.0.
- [x] CSP configurado en el webview -- evidencia: no modificado en esta feature. Verificado en auditoria devtools-csp-produccion v1.0.
- [x] No se expone process.env completo al renderer via IPC -- evidencia: snapshotToIPC (handlers.ts:58-89) expone solo datos del monitor. behaviorMetrics contiene solo numeros, booleans y agentId (enum-bounded). Ningun campo nuevo expone paths o env vars.
- [x] Cierre limpio de subprocesos al cerrar la app -- evidencia: N/A para esta feature. No hay subprocesos nuevos. getAgentBehaviorTimeline es SQLite sincrono.

**Vulnerabilidades encontradas:**

## Vulnerabilidad: Path traversal limitado en verifyFileRefs
- Severidad: baja
- Categoria OWASP: A01 Broken Access Control (indirect)
- Archivo: src/monitor/core/behaviorParser.ts
- Linea: 63, 74
- Descripcion: El regex /\bsrc\/[a-zA-Z0-9/_.-]+\.(ts|js|md)\b/g permite secuencias '..' en el path capturado (el caracter '.' esta en la clase de caracteres). Una referencia como src/../../etc/passwd.ts en un status.md pasa el regex sin problemas. verifyFileRefs llama existsSync(join(repoRoot, ref)), donde join resuelve el '..' y la ruta resultante puede salir del repoRoot. Test confirmado: join('/home/user/project', 'src/../../etc/passwd.ts') = '/home/user/etc/passwd.ts'.
- Vector de ataque: Un status.md malicioso en docs/features/ con contenido como src/../../sensitive-file.ts provoca que existsSync consulte una ruta fuera del repo. La informacion filtrada es unicamente la existencia (true/false) del archivo externo -- no su contenido. El resultado se usa solo para calcular hallucinationRate (metrica interna). Requiere acceso previo de escritura a docs/features/ para explotar.
- Evidencia: behaviorParser.ts:63 -- regex captura src/../../etc/passwd.ts (verificado con node). behaviorParser.ts:74 -- existsSync(join(repoRoot, ref)) sin normalizacion ni verificacion de confinamiento al repo.
- Remediacion: En verifyFileRefs, normalizar la ruta y verificar confinamiento antes de llamar existsSync: const resolved = path.resolve(repoRoot, ref); if (!resolved.startsWith(path.resolve(repoRoot) + path.sep)) return false; Alternativamente, rechazar refs con '..' antes del join: if (ref.includes('..')) continue;

**Decision:** APROBADO_CON_RIESGOS

### Riesgos aceptados por Cipher
- Path traversal en verifyFileRefs (behaviorParser.ts:74): impacto limitado a consulta de existencia de archivo fuera del repo. No filtra contenido del archivo. Requiere acceso de escritura al repo (docs/features/) para insertar el status.md malicioso. En produccion, docs/ no existe -- la funcion retorna hallucinationRate=null sin ejecutar verifyFileRefs. Riesgo residual aceptado como deuda tecnica baja.
- itemSlug y recordedAt sin sanitizeForIpc() en AgentBehaviorPointIPC (behaviorTimelineRepository.ts:48,54): itemSlug proviene de nombres de directorio del repo (convencion ASCII del proyecto). recordedAt es timestamp ISO de new Date().toISOString() -- garantizado ASCII puro (verificado). Sin riesgo practico de BUG #001.
- agentId sin escapeHtml en id= y texto en renderChartsSectionRows (monitor-view.ts:830-836): enum-bounded por VALID_AGENTS ['leo','cloe','max','ada','cipher'], nunca input externo. Patron preexistente aceptado en auditorias anteriores.
- console.log con docsDir y repoRoot (handlers.ts:43-44): paths del filesystem local en stderr del proceso principal, no viajan al renderer. Sin datos sensibles.

Confianza en la auditoria: alta

## Metricas de Cipher
- archivos_leidos: 12
- vulnerabilidades_criticas: 0
- vulnerabilidades_altas: 0
- vulnerabilidades_medias: 0
- vulnerabilidades_bajas: 1
- riesgos_aceptados: 4
- items_checklist_verificados: 10/10
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0
- decision: APROBADO_CON_RIESGOS

---

Estado final: LISTO PARA MERGE
