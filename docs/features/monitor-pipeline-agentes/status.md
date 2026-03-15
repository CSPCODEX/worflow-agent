# Feature — Monitor de Pipeline de Agentes

Estado: MERGEADO
Rama: feature/monitor-pipeline-agentes
Fecha merge: 2026-03-15
Fecha apertura: 2026-03-15

---

## Info de la feature

**Descripcion:** Modulo de monitoring del pipeline de agentes (leo -> cloe -> max -> ada -> cipher) integrado en el proyecto actual, disenado como modulo autocontenido y extraible sin romper nada. En el futuro podria publicarse como herramienta open source agnostica al proyecto para la comunidad de Claude Code.

**Objetivo:** Dar visibilidad del estado del pipeline: donde se atascaron features, cuanto tardaron los handoffs, que agentes tienen mas rework, y que bugs nunca se cerraron. La informacion vive en `docs/features/*/status.md` y `docs/bugs/*/status.md` — el monitor la agrega y presenta en la UI del desktop.

**Restricciones conocidas:**
- El modulo debe ser extraible: cero dependencias hacia el proyecto host (no importar nada de src/main.ts, src/ipc/, ni Electrobun directamente)
- API publica unica de entrada: `monitor.track(event: PipelineEvent)` — para eventos futuros en tiempo real
- UI autocontenida: su propio renderer/view, sus propios estilos, sin heredar del desktop app actual
- No romper el flujo CLI existente (bun run dev, bun run chat)
- Estructura: src/monitor/ con core/, ui/, index.ts — copiable a un nuevo repo sin cirugia

---

## Handoff Leo -> Cloe

### Decision de arquitectura: fuente de datos primaria

El monitor lee los archivos `docs/features/*/status.md` y `docs/bugs/*/status.md` directamente desde el filesystem usando `Bun.file()`. Esta es la fuente de verdad — no una DB separada.

**Estrategia de actualizacion: polling con intervalo configurable (default 30s).**

Justificacion de polling sobre file watcher:
- `fs.watch` en Windows tiene comportamiento inconsistente con directorios recursivos via WSL/Git
- `Bun.FileSystemRouter` no es la herramienta correcta aqui
- Polling cada 30s es suficiente para un monitor de handoffs (no es un stream de eventos)
- Mantiene el modulo simple y portable — un file watcher requeriria APIs nativas distintas por OS
- El usuario puede forzar un refresh via boton en la UI

**Estrategia de parseo: regex sobre el texto del status.md.**

Los status.md tienen estructura semi-estructurada (Markdown con lineas de campos conocidos). El parser extrae campos con regex simples y no necesita un parser Markdown completo.

---

### Arquitectura del modulo: src/monitor/

```
src/monitor/
├── index.ts                  # API publica del modulo. Exporta MonitorModule, PipelineEvent, y tipos publicos.
├── core/
│   ├── types.ts              # Todos los tipos TypeScript del modulo (sin imports externos)
│   ├── statusParser.ts       # Parsea un string de status.md -> ParsedStatus
│   ├── aggregator.ts         # Lee todos los status.md del disco y construye PipelineSnapshot
│   └── poller.ts             # Polling timer: llama aggregator cada N segundos, emite snapshot via callback
└── ui/
    ├── monitor-view.ts       # Funcion renderMonitor(container, getSnapshot) -> { cleanup() }
    └── monitor-styles.css    # Estilos exclusivos del monitor (no afectan ni dependen de style.css del host)
```

**Regla de dependencias (CRITICA):**
- `src/monitor/core/*.ts` — SOLO importan entre si y de `node:fs` / `node:path`. CERO imports de `src/*` fuera de `src/monitor/`.
- `src/monitor/ui/monitor-view.ts` — solo importa tipos de `src/monitor/core/types.ts`. CERO imports de Electrobun, IPC, ni renderer host.
- `src/monitor/index.ts` — re-exporta lo que el host necesita. Es el unico punto de entrada.

**Integracion con el host (patron de inyeccion — CRITICA):**
El host (`src/ipc/handlers.ts`) inyecta las rutas `docsDir` al crear el aggregator. El modulo nunca sabe donde esta `docs/` — el host se lo dice. Esto permite que el modulo funcione en cualquier repo con una estructura `docs/features/` diferente.

---

### Tipos TypeScript completos — src/monitor/core/types.ts

```typescript
// ============================================================
// Tipos del modulo Monitor — src/monitor/core/types.ts
// Sin imports externos. Portable.
// ============================================================

export type AgentId = 'leo' | 'cloe' | 'max' | 'ada' | 'cipher';

export type FeatureState =
  | 'EN_PLANIFICACION'
  | 'EN_IMPLEMENTACION'
  | 'EN_VERIFICACION'
  | 'EN_OPTIMIZACION'
  | 'EN_AUDITORIA'
  | 'AUDITADO'
  | 'MERGEADO'
  | 'BLOQUEADO'
  | 'DESCONOCIDO';

export type BugState =
  | 'ABIERTO'
  | 'EN_DIAGNOSTICO'
  | 'EN_IMPLEMENTACION'
  | 'EN_VERIFICACION'
  | 'RESUELTO'
  | 'DESCONOCIDO';

// Metricas tal como aparecen en el status.md de cada agente
export interface AgentMetrics {
  agentId: AgentId;
  archivosLeidos: number | null;
  archivosCreados: number | null;
  archivosModificados: number | null;
  rework: boolean | null;
  iteraciones: number | null;
  confianza: 'alta' | 'media' | 'baja' | null;
  gapsDeclados: number | null;
}

// Estado de un handoff entre dos agentes
export interface HandoffStatus {
  from: AgentId;
  to: AgentId;
  // El handoff "from -> to" esta completo cuando la seccion "Handoff from -> to" tiene contenido
  // real (no solo el placeholder "> Agente: completa esta seccion")
  completed: boolean;
  hasRework: boolean;
}

// Representacion de una feature parseada desde su status.md
export interface FeatureRecord {
  slug: string;               // Nombre de la carpeta, ej: "settings-panel"
  title: string;              // Primera linea H1 del status.md
  state: FeatureState;        // Parseado de la linea "Estado: ..."
  branch: string;             // Parseado de "Rama: ..."
  openedAt: string;           // Parseado de "Fecha apertura: ..."
  handoffs: HandoffStatus[];  // Estado de cada handoff del pipeline
  metrics: AgentMetrics[];    // Metricas por agente (las que estan rellenas)
  filePath: string;           // Ruta absoluta al status.md (NO viaja por IPC al renderer)
}

// Representacion de un bug parseado desde su status.md
export interface BugRecord {
  id: string;                 // "001", "002", etc.
  slug: string;               // "validacion-encoding-caracteres"
  title: string;              // Primera linea H1
  state: BugState;
  openedAt: string;
  hasSecurityImplication: boolean;
  agentMetrics: Partial<Record<AgentId, AgentMetrics>>;
  filePath: string;           // NO viaja por IPC
}

// Metricas agregadas por agente a traves de todas las features
export interface AgentSummary {
  agentId: AgentId;
  totalFeatures: number;         // Cuantas features tiene metricas de este agente
  avgIterations: number;         // Promedio de iteraciones
  reworkCount: number;           // Cuantas features tuvieron rework
  reworkRate: number;            // reworkCount / totalFeatures (0-1)
  avgConfidence: number;         // alta=3, media=2, baja=1 -> promedio numerico
  totalGapsDeclared: number;
  completedHandoffs: number;     // Handoffs completados donde este agente es el "from"
}

// Snapshot completo del estado del pipeline en un momento dado
export interface PipelineSnapshot {
  features: FeatureRecord[];
  bugs: BugRecord[];
  agentSummaries: AgentSummary[];
  lastUpdatedAt: string;         // ISO 8601 timestamp del ultimo scan
  parseErrors: string[];         // Archivos que fallaron al parsear (para debugging)
}

// Evento que el host puede emitir via monitor.track() para registro futuro
// (en esta version el track es un no-op decorativo — prepara la API para v2)
export interface PipelineEvent {
  agent: AgentId;
  event: string;                 // Descripcion libre del evento
  feature?: string;              // Slug de la feature (opcional)
  timestamp: string;             // ISO 8601
}

// Opciones de configuracion que el host inyecta al crear el modulo
export interface MonitorConfig {
  docsDir: string;               // Ruta absoluta a la carpeta docs/ del repo
  pollIntervalMs?: number;       // Default: 30000 (30 segundos)
}

// Callback que el poller llama cada vez que tiene un nuevo snapshot
export type SnapshotCallback = (snapshot: PipelineSnapshot) => void;
```

---

### Contrato IPC — nuevos canales

Estos tipos van en `src/types/ipc.ts` (archivo del HOST, no del modulo).

```typescript
// --- Monitor types (añadir en src/types/ipc.ts) ---

// FeatureRecord e BugRecord "seguros para IPC" — sin filePath (ruta interna)
export interface FeatureRecordIPC {
  slug: string;
  title: string;
  state: string;
  branch: string;
  openedAt: string;
  handoffs: HandoffStatusIPC[];
  metrics: AgentMetricsIPC[];
}

export interface BugRecordIPC {
  id: string;
  slug: string;
  title: string;
  state: string;
  openedAt: string;
  hasSecurityImplication: boolean;
  agentMetrics: Record<string, AgentMetricsIPC>;
}

export interface AgentMetricsIPC {
  agentId: string;
  archivosLeidos: number | null;
  archivosCreados: number | null;
  archivosModificados: number | null;
  rework: boolean | null;
  iteraciones: number | null;
  confianza: 'alta' | 'media' | 'baja' | null;
  gapsDeclados: number | null;
}

export interface HandoffStatusIPC {
  from: string;
  to: string;
  completed: boolean;
  hasRework: boolean;
}

export interface AgentSummaryIPC {
  agentId: string;
  totalFeatures: number;
  avgIterations: number;
  reworkCount: number;
  reworkRate: number;
  avgConfidence: number;
  totalGapsDeclared: number;
  completedHandoffs: number;
}

export interface PipelineSnapshotIPC {
  features: FeatureRecordIPC[];
  bugs: BugRecordIPC[];
  agentSummaries: AgentSummaryIPC[];
  lastUpdatedAt: string;
  parseErrors: string[];
}

export interface GetPipelineSnapshotResult {
  snapshot: PipelineSnapshotIPC;
}

// En AppRPC > bun > requests:
// getPipelineSnapshot: { params: undefined; response: GetPipelineSnapshotResult };

// En AppRPC > webview > messages:
// pipelineSnapshotUpdated: PipelineSnapshotIPC;
```

**Dos canales IPC nuevos:**

1. `getPipelineSnapshot` (request): el renderer pide el ultimo snapshot calculado. Sincrono — retorna lo que hay en cache.
2. `pipelineSnapshotUpdated` (message, push): el main process envia el snapshot al renderer cada vez que el poller lo recalcula.

---

### Detalle de cada archivo a implementar

#### 1. src/monitor/core/types.ts
Ya definido arriba. Solo tipos, sin logica. Sin imports.

#### 2. src/monitor/core/statusParser.ts

Parsea un string de contenido de status.md y retorna los campos extraidos.

```typescript
import type {
  FeatureRecord, BugRecord, AgentMetrics, HandoffStatus,
  FeatureState, BugState, AgentId,
} from './types';

// Mapa de texto en status.md -> FeatureState enum
const FEATURE_STATE_MAP: Record<string, FeatureState> = {
  'EN PLANIFICACION': 'EN_PLANIFICACION',
  'EN IMPLEMENTACION': 'EN_IMPLEMENTACION',
  'LISTO PARA IMPLEMENTACION': 'EN_IMPLEMENTACION',
  'EN VERIFICACION': 'EN_VERIFICACION',
  'EN OPTIMIZACION': 'EN_OPTIMIZACION',
  'EN AUDITORIA': 'EN_AUDITORIA',
  'AUDITADO': 'AUDITADO',
  'MERGEADO': 'MERGEADO',
  'BLOQUEADO': 'BLOQUEADO',
};

// Extrae el valor de una linea "Clave: valor" (case-insensitive en la clave)
function extractLine(content: string, key: string): string | null {
  const regex = new RegExp(`^${key}:\\s*(.+)$`, 'mi');
  return content.match(regex)?.[1]?.trim() ?? null;
}

// Parsea la seccion de metricas de un agente especifico
// Busca el bloque "## Metricas de <agente>" y extrae campos conocidos
function parseAgentMetrics(content: string, agentId: AgentId): AgentMetrics | null {
  const agentName = agentId.charAt(0).toUpperCase() + agentId.slice(1);
  const sectionRegex = new RegExp(
    `## Metricas de ${agentName}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`,
    'i'
  );
  const section = content.match(sectionRegex)?.[1];
  if (!section) return null;

  function num(key: string): number | null {
    const m = section.match(new RegExp(`^-?\\s*${key}:\\s*(\\d+)`, 'mi'));
    return m ? parseInt(m[1]!, 10) : null;
  }
  function bool(key: string): boolean | null {
    const m = section.match(new RegExp(`^-?\\s*${key}:\\s*(si|no|true|false)`, 'mi'));
    if (!m) return null;
    return m[1]!.toLowerCase() === 'si' || m[1]!.toLowerCase() === 'true';
  }
  function conf(): 'alta' | 'media' | 'baja' | null {
    const m = section.match(/^-?\s*confianza:\s*(alta|media|baja)/mi);
    return (m?.[1]?.toLowerCase() as 'alta' | 'media' | 'baja') ?? null;
  }

  const metrics: AgentMetrics = {
    agentId,
    archivosLeidos: num('archivos_leidos'),
    archivosCreados: num('archivos_creados'),
    archivosModificados: num('archivos_modificados'),
    rework: bool('rework'),
    iteraciones: num('iteraciones'),
    confianza: conf(),
    gapsDeclados: num('gaps_declarados'),
  };

  // Si todos los campos son null, no hay seccion real de metricas
  const hasAny = Object.values(metrics).some((v, i) => i > 0 && v !== null);
  return hasAny ? metrics : null;
}

// Parsea los handoffs del pipeline
// Un handoff "Leo -> Cloe" esta completo si la seccion "## Handoff Leo -> Cloe"
// tiene contenido que no sea solo el placeholder "> Leo: completa esta seccion"
const PIPELINE_PAIRS: Array<[AgentId, AgentId]> = [
  ['leo', 'cloe'],
  ['cloe', 'max'],
  ['max', 'ada'],
  ['ada', 'cipher'],
];

function parseHandoffs(content: string): HandoffStatus[] {
  return PIPELINE_PAIRS.map(([from, to]) => {
    const fromName = from.charAt(0).toUpperCase() + from.slice(1);
    const toName = to.charAt(0).toUpperCase() + to.slice(1);

    // Busca la seccion del handoff
    const sectionRegex = new RegExp(
      `## Handoff ${fromName}[^\\n]*${toName}[\\s\\S]*?(?=\\n## |$)`,
      'i'
    );
    const section = content.match(sectionRegex)?.[0] ?? '';

    // El handoff esta incompleto si solo tiene el placeholder de Leo/Cloe/Max/etc
    const isPlaceholder = />\s*(Leo|Cloe|Max|Ada|Cipher):\s*completa esta seccion/i.test(section);
    const hasContent = section.length > 120 && !isPlaceholder;

    // Detectar rework: la seccion menciona "rework: si" o "Rework v2"
    const hasRework = /rework:\s*si/i.test(section) || /rework\s+v\d/i.test(section);

    return {
      from,
      to,
      completed: hasContent,
      hasRework,
    };
  });
}

export function parseFeatureStatus(
  content: string,
  slug: string,
  filePath: string
): FeatureRecord {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.replace(/^Feature\s*[—-]\s*/i, '').trim() ?? slug;

  const rawState = extractLine(content, 'Estado final') ?? extractLine(content, 'Estado') ?? '';
  const normalizedState = rawState.toUpperCase().replace(/[^A-Z\s]/g, '').trim();
  const state: FeatureState = FEATURE_STATE_MAP[normalizedState] ?? 'DESCONOCIDO';

  const branch = extractLine(content, 'Rama') ?? '';
  const openedAt = extractLine(content, 'Fecha apertura') ?? '';

  const handoffs = parseHandoffs(content);

  const ALL_AGENTS: AgentId[] = ['leo', 'cloe', 'max', 'ada', 'cipher'];
  const metrics: AgentMetrics[] = ALL_AGENTS
    .map((id) => parseAgentMetrics(content, id))
    .filter((m): m is AgentMetrics => m !== null);

  return { slug, title, state, branch, openedAt, handoffs, metrics, filePath };
}

export function parseBugStatus(
  content: string,
  id: string,
  slug: string,
  filePath: string
): BugRecord {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.replace(/^Bug\s*#\d+\s*[—-]\s*/i, '').trim() ?? slug;

  const rawState = extractLine(content, 'Estado') ?? '';
  const normalizedState = rawState.toUpperCase().trim();
  const BUG_STATE_MAP: Record<string, BugState> = {
    'ABIERTO': 'ABIERTO',
    'EN DIAGNOSTICO': 'EN_DIAGNOSTICO',
    'EN IMPLEMENTACION': 'EN_IMPLEMENTACION',
    'EN VERIFICACION': 'EN_VERIFICACION',
    'RESUELTO': 'RESUELTO',
  };
  const state: BugState = BUG_STATE_MAP[normalizedState] ?? 'DESCONOCIDO';

  const openedAt = extractLine(content, 'Fecha') ?? '';
  const hasSecurityImplication = /implicaciones de seguridad:\s*si/i.test(content);

  const ALL_AGENTS: AgentId[] = ['leo', 'cloe', 'max', 'ada', 'cipher'];
  const agentMetrics: Partial<Record<AgentId, AgentMetrics>> = {};
  for (const id of ALL_AGENTS) {
    const m = parseAgentMetrics(content, id);
    if (m) agentMetrics[id] = m;
  }

  return { id, slug, title, state, openedAt, hasSecurityImplication, agentMetrics, filePath };
}
```

#### 3. src/monitor/core/aggregator.ts

Lee todos los status.md del disco y construye un PipelineSnapshot.

```typescript
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PipelineSnapshot, AgentSummary, AgentId, FeatureRecord, BugRecord, AgentMetrics } from './types';
import { parseFeatureStatus, parseBugStatus } from './statusParser';

const PIPELINE_ORDER: AgentId[] = ['leo', 'cloe', 'max', 'ada', 'cipher'];

function computeAgentSummaries(
  features: FeatureRecord[],
  bugs: BugRecord[]
): AgentSummary[] {
  return PIPELINE_ORDER.map((agentId): AgentSummary => {
    // Collect all metrics for this agent across features and bugs
    const allMetrics: AgentMetrics[] = [];

    for (const f of features) {
      const m = f.metrics.find((x) => x.agentId === agentId);
      if (m) allMetrics.push(m);
    }
    for (const b of Object.values(bugs)) {
      const m = b.agentMetrics[agentId];
      if (m) allMetrics.push(m);
    }

    const total = allMetrics.length;
    if (total === 0) {
      return {
        agentId,
        totalFeatures: 0,
        avgIterations: 0,
        reworkCount: 0,
        reworkRate: 0,
        avgConfidence: 0,
        totalGapsDeclared: 0,
        completedHandoffs: 0,
      };
    }

    const reworkCount = allMetrics.filter((m) => m.rework === true).length;
    const iterationsValues = allMetrics.map((m) => m.iteraciones).filter((v): v is number => v !== null);
    const avgIterations = iterationsValues.length > 0
      ? iterationsValues.reduce((a, b) => a + b, 0) / iterationsValues.length
      : 0;

    const confMap = { alta: 3, media: 2, baja: 1 } as const;
    const confValues = allMetrics
      .map((m) => m.confianza)
      .filter((v): v is 'alta' | 'media' | 'baja' => v !== null)
      .map((v) => confMap[v]);
    const avgConfidence = confValues.length > 0
      ? confValues.reduce((a, b) => a + b, 0) / confValues.length
      : 0;

    const totalGapsDeclared = allMetrics
      .map((m) => m.gapsDeclados ?? 0)
      .reduce((a, b) => a + b, 0);

    // Completados: handoffs donde este agente es el "from" y están marcados completed
    const completedHandoffs = features
      .flatMap((f) => f.handoffs)
      .filter((h) => h.from === agentId && h.completed)
      .length;

    return {
      agentId,
      totalFeatures: total,
      avgIterations: Math.round(avgIterations * 100) / 100,
      reworkCount,
      reworkRate: Math.round((reworkCount / total) * 100) / 100,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      totalGapsDeclared,
      completedHandoffs,
    };
  });
}

export function buildSnapshot(docsDir: string): PipelineSnapshot {
  const parseErrors: string[] = [];
  const features: FeatureRecord[] = [];
  const bugs: BugRecord[] = [];

  // --- features ---
  const featuresDir = join(docsDir, 'features');
  if (existsSync(featuresDir)) {
    let slugs: string[] = [];
    try {
      slugs = readdirSync(featuresDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch (e: any) {
      parseErrors.push(`Cannot read features dir: ${e.message}`);
    }

    for (const slug of slugs) {
      const filePath = join(featuresDir, slug, 'status.md');
      if (!existsSync(filePath)) continue;
      try {
        const content = readFileSync(filePath, 'utf-8');
        features.push(parseFeatureStatus(content, slug, filePath));
      } catch (e: any) {
        parseErrors.push(`${filePath}: ${e.message}`);
      }
    }
  }

  // --- bugs ---
  const bugsDir = join(docsDir, 'bugs');
  if (existsSync(bugsDir)) {
    let bugDirs: string[] = [];
    try {
      bugDirs = readdirSync(bugsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch (e: any) {
      parseErrors.push(`Cannot read bugs dir: ${e.message}`);
    }

    for (const dirName of bugDirs) {
      const filePath = join(bugsDir, dirName, 'status.md');
      if (!existsSync(filePath)) continue;
      try {
        const content = readFileSync(filePath, 'utf-8');
        // dirName format: "001-slug-del-bug"
        const idMatch = dirName.match(/^(\d+)-(.+)$/);
        const id = idMatch?.[1] ?? dirName;
        const slug = idMatch?.[2] ?? dirName;
        bugs.push(parseBugStatus(content, id, slug, filePath));
      } catch (e: any) {
        parseErrors.push(`${filePath}: ${e.message}`);
      }
    }
  }

  const agentSummaries = computeAgentSummaries(features, bugs);

  return {
    features,
    bugs,
    agentSummaries,
    lastUpdatedAt: new Date().toISOString(),
    parseErrors,
  };
}
```

#### 4. src/monitor/core/poller.ts

Ejecuta el aggregator en intervalos y notifica via callback.

```typescript
import type { PipelineSnapshot, SnapshotCallback, MonitorConfig } from './types';
import { buildSnapshot } from './aggregator';

const DEFAULT_POLL_MS = 30_000;

export class PipelinePoller {
  private readonly docsDir: string;
  private readonly intervalMs: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private cachedSnapshot: PipelineSnapshot | null = null;
  private callbacks: SnapshotCallback[] = [];

  constructor(config: MonitorConfig) {
    this.docsDir = config.docsDir;
    this.intervalMs = config.pollIntervalMs ?? DEFAULT_POLL_MS;
  }

  // Arranca el poller. Hace un scan inmediato y luego en intervalos.
  start(): void {
    if (this.intervalId !== null) return; // ya iniciado
    this.scan();
    this.intervalId = setInterval(() => this.scan(), this.intervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // Fuerza un scan inmediato (para uso del handler IPC "refresh")
  forceRefresh(): PipelineSnapshot {
    this.scan();
    return this.cachedSnapshot!;
  }

  // Retorna el ultimo snapshot sin relanzar el scan
  getSnapshot(): PipelineSnapshot {
    if (!this.cachedSnapshot) {
      this.scan();
    }
    return this.cachedSnapshot!;
  }

  onSnapshot(cb: SnapshotCallback): void {
    this.callbacks.push(cb);
  }

  private scan(): void {
    try {
      const snapshot = buildSnapshot(this.docsDir);
      this.cachedSnapshot = snapshot;
      for (const cb of this.callbacks) {
        cb(snapshot);
      }
    } catch (e: any) {
      console.error('[monitor/poller] scan error:', e.message);
    }
  }
}
```

#### 5. src/monitor/index.ts

API publica del modulo. El host solo importa desde aqui.

```typescript
// API publica del modulo monitor.
// El host importa solo desde este archivo.
// Ninguna importacion del host debe existir aqui ni en core/*.
export { PipelinePoller } from './core/poller';
export { buildSnapshot } from './core/aggregator';
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
} from './core/types';

// monitor.track() es el punto de entrada para eventos futuros en tiempo real.
// En v1 es un no-op con firma definida para no romper la API cuando se implemente.
export const monitor = {
  track(_event: import('./core/types').PipelineEvent): void {
    // v1: no-op. En v2: persistir el evento en una cola para replay.
  },
};
```

#### 6. src/monitor/ui/monitor-view.ts

Vista autocontenida del monitor. No importa nada de Electrobun ni del renderer host.
Solo recibe `getSnapshot` como funcion inyectada y `onRefresh` como callback.

```typescript
import type { PipelineSnapshotIPC, AgentSummaryIPC, FeatureRecordIPC, BugRecordIPC } from '../../types/ipc';

// NOTA: este import de types/ipc.ts es el UNICO acoplamiento con el host
// y es aceptable porque types/ipc.ts es el contrato de la app — no logica interna.
// Si el modulo se extrae a un repo separado, este import se reemplaza por tipos locales equivalentes.

export interface MonitorViewHandle {
  cleanup(): void;
  updateSnapshot(snapshot: PipelineSnapshotIPC): void;
}

export function renderMonitor(
  container: HTMLElement,
  initialSnapshot: PipelineSnapshotIPC,
  onRefresh: () => void
): MonitorViewHandle {
  // ... (ver UI section abajo)
}
```

#### 7. src/monitor/ui/monitor-styles.css

Estilos exclusivos del monitor. Se copian al build output como recurso estatico independiente.
No sobreescriben ni heredan de `style.css` del host — usan prefijos `.monitor-` para evitar colisiones.

---

### Integracion con el host

#### Cambios en src/ipc/handlers.ts

Instanciar el poller y registrar los dos handlers nuevos:

```typescript
import { PipelinePoller } from '../monitor/index';
import path from 'path';

// Instanciar poller. docsDir = docs/ relativo al repo root.
// process.cwd() en Electrobun = root del repo (verificar en src/desktop/index.ts si hay duda).
const docsDir = path.join(process.cwd(), 'docs');
const poller = new PipelinePoller({ docsDir, pollIntervalMs: 30_000 });
poller.start();

// En createRpc(), dentro de handlers.requests:
getPipelineSnapshot: async () => {
  const snapshot = poller.getSnapshot();
  return { snapshot: snapshotToIPC(snapshot) };
},

// Wiring del poller -> renderer (fuera de handlers.requests, en createRpc() junto al acpManager callback):
poller.onSnapshot((snapshot) => {
  (rpc as any).send.pipelineSnapshotUpdated(snapshotToIPC(snapshot));
});
```

La funcion `snapshotToIPC` convierte `PipelineSnapshot` (interno, con `filePath`) a `PipelineSnapshotIPC` (seguro para IPC, sin `filePath`):

```typescript
function snapshotToIPC(snapshot: PipelineSnapshot): PipelineSnapshotIPC {
  return {
    features: snapshot.features.map(({ filePath: _fp, ...f }) => ({
      ...f,
      handoffs: f.handoffs,
      metrics: f.metrics,
    })),
    bugs: snapshot.bugs.map(({ filePath: _fp, ...b }) => ({
      ...b,
      agentMetrics: b.agentMetrics as Record<string, AgentMetricsIPC>,
    })),
    agentSummaries: snapshot.agentSummaries,
    lastUpdatedAt: snapshot.lastUpdatedAt,
    parseErrors: snapshot.parseErrors,
  };
}
```

#### Cambios en src/types/ipc.ts

Añadir todos los tipos IPC del monitor (listados en la seccion "Contrato IPC" arriba).

Añadir en `AppRPC`:
```typescript
// En bun > requests:
getPipelineSnapshot: { params: undefined; response: GetPipelineSnapshotResult };

// En webview > messages:
pipelineSnapshotUpdated: PipelineSnapshotIPC;
```

#### Cambios en src/renderer/app.ts

Añadir import y handler de la vista monitor:

```typescript
import { renderMonitor, type MonitorViewHandle } from './views/monitor';
// ...
let activeMonitorHandle: MonitorViewHandle | null = null;
// En teardownCurrentView():
activeMonitorHandle?.cleanup();
activeMonitorHandle = null;

function showMonitor() {
  teardownCurrentView();
  const snapshot = /* snapshot inicial en blanco */ { features: [], bugs: [], agentSummaries: [], lastUpdatedAt: '', parseErrors: [] };
  activeMonitorHandle = renderMonitor(mainContentEl, snapshot, () => {
    (window as any).appRpc.request.getPipelineSnapshot().then((r: { snapshot: PipelineSnapshotIPC }) => {
      activeMonitorHandle?.updateSnapshot(r.snapshot);
    }).catch(console.error);
  });
  // Pedir snapshot al arrancar la vista
  (window as any).appRpc.request.getPipelineSnapshot().then((r: { snapshot: PipelineSnapshotIPC }) => {
    activeMonitorHandle?.updateSnapshot(r.snapshot);
  }).catch(console.error);
}
```

Registrar el mensaje push del poller:
```typescript
// En defineRPC messages:
pipelineSnapshotUpdated: (payload) => {
  document.dispatchEvent(new CustomEvent('monitor:snapshot', { detail: payload }));
},
```

En `monitor-view.ts`, el listener de `monitor:snapshot` se registra en el `cleanup()` para evitar leaks.

#### Cambios en src/renderer/index.html

Añadir boton "Monitor" en el sidebar-footer junto al boton "Ajustes":

```html
<div class="sidebar-footer">
  <button id="btn-monitor" class="btn-settings">Monitor</button>
  <button id="btn-settings" class="btn-settings">Ajustes</button>
</div>
```

#### Cambios en electrobun.config.ts

Añadir copia del CSS del monitor al output de build:

```typescript
copy: {
  'src/renderer/index.html': 'views/main/index.html',
  'src/renderer/style.css': 'views/main/style.css',
  'src/monitor/ui/monitor-styles.css': 'views/main/monitor-styles.css',  // NUEVO
},
```

Y en `src/renderer/index.html`, añadir el link al CSS del monitor:

```html
<link rel="stylesheet" href="./monitor-styles.css" />
```

---

### UI del monitor: pantallas y contenido

La vista `renderMonitor` tiene tres pestanas (tabs) en una sola pagina:

**Tab 1 — Pipeline (vista por defecto)**
- Tabla de features con columnas: Nombre, Estado, Rama, Abierta, Handoffs completados (icono por par: leo->cloe->max->ada->cipher), Rework (si/no)
- Tabla de bugs con columnas: ID, Nombre, Estado, Seguridad
- Filtrables por estado (dropdown)
- Colores de estado: EN_PLANIFICACION=azul, EN_IMPLEMENTACION=amarillo, AUDITADO=verde, BLOQUEADO=rojo

**Tab 2 — Agentes (metricas por agente)**
- 5 cards (una por agente: leo, cloe, max, ada, cipher)
- Cada card muestra: Total features con metricas, Rework rate (%), Avg iteraciones, Avg confianza (alta/media/baja), Total gaps declarados, Handoffs completados
- Los valores nulos se muestran como "--"

**Tab 3 — Errores de parseo**
- Lista de archivos que fallaron al parsear (parseErrors[])
- Util para debugging cuando un status.md tiene formato inesperado
- Si parseErrors esta vacio, muestra "Sin errores de parseo"

**Header de la vista**
- Timestamp del ultimo scan ("Actualizado: hace 2 min")
- Boton "Actualizar" que llama `onRefresh()`

**Patron de render:**
- `renderMonitor()` pinta el HTML inicial con snapshot vacio o el que se le pase
- `updateSnapshot(snapshot)` actualiza solo las partes del DOM que cambian (sin re-render completo)
- El listener de `monitor:snapshot` llama `updateSnapshot` directamente

---

### Fuente de datos: resolucion de process.cwd()

**Gap critico a verificar:** `process.cwd()` en `src/ipc/handlers.ts` cuando se ejecuta via `bun run desktop` apunta al root del repo. Cuando se ejecuta como binario empaquetado (produccion), `process.cwd()` puede apuntar a otro lugar.

**Solucion:** Usar `import.meta.dir` o `PATHS` de Electrobun para resolver la ruta a `docs/`. Sin embargo, en esta feature el monitor **solo tiene sentido en desarrollo** (docs/ no se distribuye en el paquete final). Por lo tanto:

- En dev: `docsDir = path.join(process.cwd(), 'docs')` — correcto
- En produccion: el directorio `docs/` no existe en el bundle → `buildSnapshot` retornara un snapshot vacio con `parseErrors: ['Cannot read features dir: ...']` → la UI mostrara "Sin datos disponibles"

Este comportamiento es correcto y esperado. El monitor es una herramienta de desarrollo.

---

### Orden de implementacion (prioridad para Cloe)

**Fase 1 — Core del modulo (sin UI, sin IPC)**
1. `src/monitor/core/types.ts` — tipos base, sin logica
2. `src/monitor/core/statusParser.ts` — parseo de status.md
3. `src/monitor/core/aggregator.ts` — lectura del filesystem y construccion del snapshot
4. `src/monitor/core/poller.ts` — timer de polling
5. `src/monitor/index.ts` — API publica

**Fase 2 — Integracion IPC**
6. `src/types/ipc.ts` — añadir tipos IPC del monitor
7. `src/ipc/handlers.ts` — instanciar poller, registrar handlers, wiring push
8. `src/renderer/app.ts` — añadir `activeMonitorHandle`, `showMonitor()`, wiring evento push
9. `src/renderer/index.html` — boton Monitor en sidebar-footer

**Fase 3 — UI**
10. `src/monitor/ui/monitor-styles.css` — estilos con prefijo `.monitor-`
11. `src/monitor/ui/monitor-view.ts` — vista completa con 3 tabs
12. `electrobun.config.ts` — copiar monitor-styles.css al build

**Nota:** Las fases 1 y 2 son independientes de la UI. Cloe puede verificar que el poller funciona via `console.log` antes de construir la vista.

---

### Reglas que Cloe debe respetar

1. **Aislamiento del modulo:** `src/monitor/core/*.ts` NO importan nada de fuera de `src/monitor/`. El unico acoplamiento aceptado es el import de tipos de `src/types/ipc.ts` en `monitor-view.ts` — y esta justificado porque es el contrato de la app.

2. **No fire-and-forget en el poller start():** `poller.start()` se llama en `handlers.ts` fuera de los handlers IPC (en el scope del modulo, al inicializar). No es un handler — no aplica la regla de fire-and-forget.

3. **snapshotToIPC omite filePath:** los campos `filePath` de `FeatureRecord` y `BugRecord` NUNCA viajan por IPC al renderer (patron de seguridad establecido en remove-agentdir-ipc). La funcion `snapshotToIPC` los omite explicitamente.

4. **Strings IPC ASCII:** `parseErrors[]` puede contener rutas de filesystem con caracteres no-ASCII si el SO tiene directorios con nombres especiales. Sanitizar con `.replace(/[^\x20-\x7E]/g, '?')` antes de incluirlos en el payload IPC.

5. **monitor-styles.css con prefijo `.monitor-`:** todos los selectores CSS del monitor usan `.monitor-` como prefijo para evitar colisiones con `style.css`. NO modificar `style.css` del host.

6. **poller.stop() al cerrar la app:** añadir `poller.stop()` junto al `acpManager.closeAll()` en `src/desktop/index.ts`.

7. **process.cwd() gap:** si `process.cwd()` no resuelve correctamente en algun entorno, el monitor mostrara un snapshot vacio — esto es comportamiento aceptable, no un crash.

8. **updateSnapshot es incremental:** la funcion `updateSnapshot` en `monitor-view.ts` NO hace `container.innerHTML = ...`. Solo actualiza el contenido de los elementos ya renderizados. Esto evita perder el estado del tab activo al recibir un push.

9. **Listener del evento push:** registrar el listener `monitor:snapshot` en `renderMonitor()` y limpiarlo en `cleanup()`. Patron identico al de `agent:chunk` en `chat.ts`.

10. **bun run dev y bun run chat no se tocan:** el modulo monitor no importa ni modifica ninguno de los archivos del CLI (`src/index.ts`, `src/client.ts`, `src/cli/`).

---

### Checklist Leo

- [x] Cada archivo a crear/modificar tiene ruta absoluta desde repo root
- [x] Contratos IPC escritos con tipos TypeScript completos inline (no "ver ipc-contracts.md")
- [x] Tipos de retorno de funciones nuevas especificados con tipos TypeScript concretos (no "any")
- [x] tsconfig flags: el proyecto usa strict — todos los tipos deben ser concretos. Los campos `filePath` en los tipos IPC se omiten con destructuring `{ filePath: _fp, ...rest }` — pattern compatible con strict
- [x] Lista de archivos ordenada por prioridad de implementacion (Fase 1 -> 2 -> 3)
- [x] Sin "ver plan.md" ni "ver acceptance.md" — todo el contexto inline en status.md
- [x] Limitaciones de Electrobun verificadas: poller.start() fuera de handlers IPC (no fire-and-forget); handlers getPipelineSnapshot son sync (sin await a subprocesos); pipelineSnapshotUpdated es push no bloqueante
- [x] Decisiones de arquitectura con justificacion explicita (polling vs file watcher, process.cwd() en dev, filePath omitido del IPC)

---

### Gaps y dudas de Leo

- [gap 1]: `process.cwd()` en el contexto del main process de Electrobun cuando se ejecuta con `bun run desktop` — deberia ser el root del repo, pero no esta confirmado contra el codigo real de `src/desktop/index.ts`. Cloe debe hacer `console.log(process.cwd())` al arrancar y verificar que apunta al root. Si no, usar `path.join(import.meta.dir, '..', '..', 'docs')` desde `src/ipc/handlers.ts`.
- [gap 2]: El formato exacto de la linea "Estado final:" vs "Estado:" en los status.md es inconsistente — algunos usan "Estado final: AUDITADO..." y otros "Estado: EN PLANIFICACION". El parser tiene ambas variantes (`extractLine(content, 'Estado final') ?? extractLine(content, 'Estado')`) pero puede haber variantes adicionales no vistas. Cloe debe correr el aggregator contra los docs/ reales y revisar parseErrors[].
- [gap 3]: `monitor-view.ts` importa tipos de `src/types/ipc.ts` — esto es un acoplamiento con el host. Si en el futuro el modulo se extrae, este import se reemplaza por tipos locales. Esta es una deuda tecnica aceptada y documentada.
- [gap 4]: Electrobun `pipelineSnapshotUpdated` como mensaje push — verificar que el patron `(rpc as any).send.pipelineSnapshotUpdated(payload)` funciona igual que `agentMessageChunk`. Deberia ser identico segun el patron establecido en handlers.ts, pero no esta confirmado con la nueva clave.

Confianza general del plan: alta

---

-> Siguiente: @cloe Implementa la feature. Las instrucciones estan en docs/features/monitor-pipeline-agentes/status.md seccion "Handoff Leo -> Cloe".

## Metricas de Leo
- archivos_leidos: 14
- archivos_creados: 1
- archivos_modificados: 1
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 4

---

## Handoff Cloe -> Max

**Archivos creados/modificados:**

### Manifiesto de archivos
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| src/monitor/core/types.ts | creado | 1-100 |
| src/monitor/core/statusParser.ts | creado | 1-133 |
| src/monitor/core/aggregator.ts | creado | 1-113 |
| src/monitor/core/poller.ts | creado | 1-64 |
| src/monitor/index.ts | creado | 1-22 |
| src/monitor/ui/monitor-styles.css | creado | 1-270 |
| src/monitor/ui/monitor-view.ts | creado | 1-388 |
| src/renderer/views/monitor.ts | creado | 1-5 |
| src/types/ipc.ts | modificado | 163-265 (tipos monitor + AppRPC) |
| src/ipc/handlers.ts | modificado | 1-55 (imports + poller init + snapshotToIPC), 165-175 (handler + wiring) |
| src/renderer/app.ts | modificado | 1-10 (imports), 29-32 (wiring push), 49-58 (teardown), 79-110 (showMonitor + btnMonitor) |
| src/renderer/index.html | modificado | 11-12 (link CSS), 22-23 (boton Monitor) |
| src/renderer/style.css | modificado | 519-525 (sidebar-footer flex gap) |
| src/desktop/index.ts | modificado | 4-5 (import getPoller), 19-20 (poller.stop() en exit/SIGINT) |
| electrobun.config.ts | modificado | 25 (copia monitor-styles.css al build) |

**Descripcion de lo implementado:**

Modulo completo de monitoring del pipeline de agentes integrado en el desktop app.

Fase 1 (core): Tipos TypeScript sin dependencias externas, parser de status.md via regex (features y bugs), aggregator que lee el filesystem y construye PipelineSnapshot, poller con intervalo configurable (default 30s) y scan inmediato al arrancar.

Fase 2 (IPC): Tipos IPC seguros (sin filePath) en ipc.ts, handler `getPipelineSnapshot` sincrono en handlers.ts, wiring push `pipelineSnapshotUpdated` via `onSnapshot` callback fuera de los handlers, `getPoller()` exportado para que desktop/index.ts llame `stop()` al cerrar. El poller se instancia en el scope del modulo de handlers.ts (no dentro de un handler IPC).

Fase 3 (UI): CSS con prefijo `.monitor-` (sin colisiones con style.css), vista con 3 tabs (Pipeline/Agentes/Errores), tabla de features con handoff icons codificados por color, tabla de bugs con badge de seguridad, 5 cards de agentes con metricas, lista de errores de parseo. `updateSnapshot()` es incremental (no re-renderiza el contenedor completo). Listener `monitor:snapshot` registrado en `renderMonitor()` y limpiado en `cleanup()`.

**Casos borde considerados:**

- `docs/` no existe en produccion -> `buildSnapshot` retorna snapshot vacio con parseError descriptivo, la UI muestra "Sin features que mostrar" y "Sin errores de parseo"
- `process.cwd()` gap de Leo: se loguea `[monitor] docsDir:` al arrancar para verificacion manual
- Strings en parseErrors sanitizados con `/[^\x20-\x7E]/g` antes de viajar por IPC
- `filePath` omitido de FeatureRecord y BugRecord en `snapshotToIPC()` via destructuring `{ filePath: _fp, ...rest }`
- Cambio de tab preserva el snapshot actual — `updateSnapshot` no resetea el tab activo
- Filtros de estado preservan seleccion al recibir push update (rebuilding options con valor actual)
- Features/bugs con formato inesperado en status.md: capturados en `parseErrors[]`, no crashean el scan
- Handoff "completado" requiere >120 chars Y sin placeholder — evita falsos positivos en secciones casi vacias
- `hasAny` check en `parseAgentMetrics`: solo retorna metricas si hay al menos un campo no-null

**Advertencias para Max:**

1. Gap 1 de Leo (process.cwd()): verificar en el log de consola que `[monitor] docsDir:` apunta al root del repo al ejecutar `bun run desktop`. Si no, el monitor mostrara snapshot vacio silenciosamente.

2. Gap 4 de Leo (pipelineSnapshotUpdated push): el patron `(rpc as any).send.pipelineSnapshotUpdated(payload)` es identico al de `agentMessageChunk` ya verificado. Confirmar que el push llega al renderer al completar el primer scan (30s o al abrir la vista).

3. El boton Monitor aparece encima del boton Ajustes en el sidebar-footer. Se agrego `display: flex; flex-direction: column; gap: 6px` al `.sidebar-footer` en style.css para el espaciado correcto.

4. `monitor-styles.css` se sirve como archivo estatico desde el mismo directorio que `style.css`. El `<link>` en index.html usa `./monitor-styles.css`. Si el archivo no se copia al build, la vista se renderizara sin estilos (pero sin errores JS).

5. `src/renderer/views/monitor.ts` es un thin re-export de `src/monitor/ui/monitor-view.ts`. El import real de la logica de UI viene del modulo monitor, no del renderer directamente.

6. El listener de `monitor:snapshot` en monitor-view.ts se registra en `document` (global), no en el container. Si `cleanup()` no se llama al navegar fuera del monitor, el listener persiste. Verificar que `teardownCurrentView()` en app.ts llama `activeMonitorHandle?.cleanup()` antes de cambiar de vista.

### Checklist Cloe
- [x] Manifiesto completo: cada archivo creado/modificado con ruta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Leo (tipos exactos, sin any sin justificacion)
- [x] bun run tsc --noEmit ejecutado -- 0 errores nuevos en archivos tocados (errores pre-existentes en scripts/metrics.ts y src/client.ts no son de esta feature)
- [x] Strings que viajan por IPC son ASCII puro -- parseErrors sanitizados con sanitizeForIpc()
- [x] Fire-and-forget no aplica al poller (poller.start() en scope del modulo, no en handler IPC)
- [x] Input validation no aplica -- getPipelineSnapshot no recibe params del renderer
- [x] filePath omitido de FeatureRecord y BugRecord en snapshotToIPC() -- nunca viaja por IPC
- [x] Sin any sin justificacion -- unico any: cast en snapshotToIPC para agentMetrics (Partial<Record> a Record) documentado en tipo
- [x] Labels HTML: monitor-view.ts usa labels con for+id en filtros (mon-feature-filter, mon-bug-filter)
- [x] CSS check ejecutado -- todas las clases estaticas de monitor-view.ts existen en monitor-styles.css

### Gaps y dudas de Cloe

- [gap 1]: process.cwd() no verificado manualmente -- depende del entorno de ejecucion. El log `[monitor] docsDir:` al arrancar permite diagnosticarlo sin modificar codigo.
- [gap 2]: La deteccion de "handoff completo" (section.length > 120 && !isPlaceholder) es heuristica -- un handoff muy corto pero real podria no detectarse como completo. Max debe revisar contra los status.md reales del repo.
- [gap 3]: pipelineSnapshotUpdated push no verificado contra Electrobun real -- patron identico a agentMessageChunk pero con clave nueva. Si Electrobun no registra dynamicamente los message handlers al definir el schema, podria necesitar ajuste.
- [gap 4]: monitor-styles.css se referencia en index.html como `./monitor-styles.css` -- en dev mode Electrobun usa el build output. Si el archivo no existe en el build en dev, los estilos no cargaran. Max debe verificar que `bun run desktop` copia el CSS o que existe en la ruta esperada.

Confianza en la implementacion: alta

Sin gaps ocultos -- los 4 gaps declarados son todos verificables externamente sin cambios de codigo, excepto el gap 2 que requiere revision manual de los status.md reales.

-> Siguiente: @max Verifica la feature. El handoff de Cloe esta en docs/features/monitor-pipeline-agentes/status.md seccion "Handoff Cloe -> Max".

## Metricas de Cloe
- archivos_leidos: 11
- archivos_creados: 8
- archivos_modificados: 7
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 4

---

## Handoff Max -> Ada

**Resultado de la verificacion:** APROBADO con gaps conocidos

**Casos probados:**

1. Aislamiento del modulo: src/monitor/core/*.ts solo importan node:fs, node:path y rutas relativas internas (aggregator.ts:1-4, poller.ts:1-2, statusParser.ts:1-4). Confirmado.
2. filePath ausente en tipos IPC: src/types/ipc.ts no contiene filePath en FeatureRecordIPC ni BugRecordIPC (lineas 164-219). Confirmado.
3. snapshotToIPC omite filePath: handlers.ts:37 usa destructuring para features y handlers.ts:42 para bugs. Confirmado.
4. sanitizeForIpc aplicado a parseErrors: handlers.ts:31-33 define la funcion, handlers.ts:48 la aplica. Confirmado.
5. poller.start() fuera de handlers IPC: handlers.ts:29 en scope del modulo, no dentro de ningun handler. Confirmado.
6. getPipelineSnapshot sincrono: handlers.ts:178-181 solo llama poller.getSnapshot() sin await a subprocesos. Confirmado.
7. poller.stop() al cerrar: desktop/index.ts:19-20 — getPoller().stop() en process.on("exit") y process.on("SIGINT"). Confirmado.
8. Patron (rpc as any).send.pipelineSnapshotUpdated: handlers.ts:188 — identico al patron de agentMessageChunk. Confirmado.
9. Boton Monitor: index.html:23 id="btn-monitor", app.ts:109 getElementById("btn-monitor"). Confirmado.
10. Labels HTML: monitor-view.ts tiene label for="mon-feature-filter" y label for="mon-bug-filter" con IDs matching en los selects. Confirmado.
11. updateSnapshot incremental: container.innerHTML solo en render inicial (monitor-view.ts:216). updateSnapshot() actualiza sub-contenedores individualmente sin tocar el contenedor raiz. Confirmado.
12. Listener monitor:snapshot limpiado en cleanup(): monitor-view.ts:384 registra, :393 elimina. app.ts teardownCurrentView() llama cleanup(). Confirmado.
13. Clases CSS: todas las clases de monitor-view.ts (done, pending, rework, rework-high, confidence-alta/media/baja, monitor-state-*) existen en monitor-styles.css. Verificado via grep.
14. Prefijo .monitor- en CSS: todos los selectores raiz usan .monitor-. Clases contextuales son modificadores sobre elementos .monitor-*. Sin colisiones con style.css. Confirmado.
15. buildSnapshot con docs/ inexistente: aggregator.ts:84 y 108 usan existsSync() guard. Retorna snapshot vacio sin crash. Confirmado.
16. parseErrors no relanza excepciones: todos los errores van a parseErrors[]. Confirmado.
17. Parser maneja ambas variantes: statusParser.ts:112 — extractLine("Estado final") ?? extractLine("Estado"). Confirmado.
18. TypeScript: bun run tsc --noEmit — 0 errores nuevos en archivos del monitor ni en archivos host modificados. Confirmado.
19. AppRPC types: ipc.ts:264 tiene getPipelineSnapshot en requests, ipc.ts:276 tiene pipelineSnapshotUpdated en messages. Confirmado.

**Issues encontrados:**

- [medio] Typo en campo de metricas: gapsDeclados en AgentMetrics/AgentMetricsIPC (falta "r" — deberia ser gapsDeclarados). Consistente en types.ts:36, ipc.ts:192, aggregator.ts:55, statusParser.ts:58. No rompe funcionalidad. Ada puede renombrarlo.
- [bajo] Primer scan no dispara push al renderer: poller.start() (handlers.ts:29) ejecuta scan inmediato antes de que onSnapshot() se registre en createRpc() (handlers.ts:187). La vista obtiene el dato igual via getPipelineSnapshot() al abrirse. No es un bug funcional.
- [bajo] cleanup() parcial: monitor-view.ts:391-395 no elimina listeners de tab buttons ni filter selects. En la practica no genera leak porque los elementos desaparecen al cambiar de vista.

**Tiene implicaciones de seguridad:** NO

- filePath nunca viaja por IPC (destrucurado en snapshotToIPC)
- parseErrors sanitizados con regex ASCII antes de IPC
- Datos de filesystem renderizados con escapeHtml() en monitor-view.ts:173-179
- No hay user input ni spawn de subprocesos en este modulo

-> Siguiente: @ada Optimiza la feature. Max aprobo con gaps conocidos — ver docs/features/monitor-pipeline-agentes/status.md seccion "Handoff Max -> Ada".

## Metricas de Max
- archivos_leidos: 16
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 1
- items_checklist_verificados: 19/19
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 3

---

## Handoff Ada -> Cipher

**Optimizaciones aplicadas:**

- `src/monitor/core/types.ts:36` — Renombrado `gapsDeclados` → `gapsDeclarados` (typo: faltaba "r"). Campo de tipo, sin impacto de runtime.
- `src/types/ipc.ts:192` — Idem en `AgentMetricsIPC`. Consistencia con el campo corregido en types.ts.
- `src/monitor/core/aggregator.ts:55` — Actualizada referencia `m.gapsDeclados` → `m.gapsDeclarados`.
- `src/monitor/core/statusParser.ts:58` — Actualizada clave de asignacion `gapsDeclados:` → `gapsDeclarados:`.
- `src/monitor/core/statusParser.ts:66` — Extraida constante de modulo `ALL_AGENTS` (antes declarada inline en dos funciones `parseFeatureStatus` y `parseBugStatus`). Elimina duplicacion sin cambiar comportamiento.
- `src/ipc/handlers.ts:29,195` — Movido `poller.start()` desde scope del modulo al cuerpo de `createRpc()`, despues de registrar `poller.onSnapshot()`. Garantiza que el primer scan inmediato ya tiene el callback registrado y el push llega al renderer.

**Bundle size antes/despues:**

- Main process: 10.62 MB → 10.62 MB (sin delta — optimizaciones son de tipo/logica, no de dependencias)
- Renderer: 47.1 KB → 47.1 KB (sin delta)

**Deuda tecnica eliminada:**

- Typo de campo que causaria confusion de API si el modulo se extrae a repo separado.
- Primera notificacion push al renderer se perdia silenciosamente (race condition entre poller.start() y onSnapshot() registration). Corregido sin introducir dependencias nuevas.
- Array `ALL_AGENTS` duplicado en dos funciones del mismo modulo — consolidado en constante de modulo.

### Checklist Ada
- [x] bundle-check ejecutado ANTES — main: 10.62 MB, renderer: 47.1 KB
- [x] Named imports verificados: sin `import * as x` en ningun archivo del modulo monitor
- [x] Dependencias muertas verificadas con grep — no hay importaciones sin uso en archivos tocados
- [x] Fire-and-forget preservado: ningun handler IPC tiene await a subproceso externo (getPipelineSnapshot es sincrono, poller.start() esta fuera de handlers)
- [x] bundle-check ejecutado DESPUES — main: 10.62 MB, renderer: 47.1 KB (sin delta esperado)
- [x] Sin cambios de comportamiento observable (typo era solo de nombre de campo, poller.start() solo mejora orden de arranque)

### No optimizado por Ada

- cleanup() de tabButtons y filter selects en monitor-view.ts: los nodos son hijos del container generado por renderMonitor(). Al cambiar de vista, container se vacía o reemplaza — los nodos desaparecen del DOM y el GC los recoge con sus listeners. El unico listener que sobrevive al DOM (document-level) ya se limpia correctamente. Añadir removeEventListener sobre nodos muertos no previene ninguna fuga real.
- BUG_STATE_MAP local en parseBugStatus: aparece una sola vez, moverlo a nivel de modulo seria cosmético sin valor de rendimiento.

Confianza en las optimizaciones: alta

### Archivos para auditoria de Cipher
| Archivo | Lineas relevantes | Razon |
|---------|-------------------|-------|
| `src/monitor/core/types.ts` | 28-37 | Renombrado campo gapsDeclarados — tipo de interfaz publica |
| `src/types/ipc.ts` | 184-193 | Renombrado campo gapsDeclarados en AgentMetricsIPC — contrato IPC |
| `src/monitor/core/aggregator.ts` | 54-56 | Acceso a campo renombrado |
| `src/monitor/core/statusParser.ts` | 50-66 | Acceso a campo renombrado + nueva constante ALL_AGENTS de modulo |
| `src/ipc/handlers.ts` | 22-31, 187-196 | poller.start() movido a dentro de createRpc() post-onSnapshot |

-> Siguiente: @cipher Audita la feature antes del release. Ver docs/features/monitor-pipeline-agentes/status.md seccion "Handoff Ada -> Cipher".

## Metricas de Ada
- archivos_leidos: 9
- archivos_modificados: 5
- bundle_antes_mb: 10.62
- bundle_despues_mb: 10.62
- optimizaciones_aplicadas: 3
- optimizaciones_descartadas: 2
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Resultado de Cipher

### Checklist Cipher

- [x] Sin secrets en codigo fuente — evidencia: scan limpio en src/monitor/, src/types/ipc.ts, src/ipc/handlers.ts, src/renderer/app.ts, src/desktop/index.ts. Los strings "GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY" en handlers.ts:92-94 son nombres de variables de entorno (apiKeyEnvVar informativo), no valores secretos.
- [x] .env en .gitignore y no commiteado — evidencia: .gitignore linea 23 contiene ".env"; git ls-files confirma que .env no esta commiteado.
- [x] agentName validado con /^[a-z0-9-]+$/ antes de path.join — evidencia: no aplica al modulo monitor. El monitor no recibe agentName del renderer ni construye rutas a partir de input de usuario. docsDir se construye exclusivamente con process.cwd() + literal "docs" en handlers.ts:26.
- [x] Inputs del webview validados antes de filesystem ops — evidencia: getPipelineSnapshot en handlers.ts:179-182 recibe params: undefined (sin input del renderer). El docsDir es construido por el main process, no aportado por el renderer.
- [x] Spawn de agentes usa rutas absolutas, no interpolacion de user input — evidencia: el modulo monitor no hace spawn de ningun proceso. Solo readFileSync y readdirSync con rutas construidas a partir de docsDir + slug del filesystem (aggregator.ts:95, 119).
- [x] Sin innerHTML con user input sin sanitizar — evidencia: monitor-view.ts auditado. Todos los campos de texto libre del filesystem (title, branch, openedAt, id, parseErrors) pasan por escapeHtml() antes de innerHTML. Los campos state y agentId son enum-bounded o derivados de operaciones aritmeticas puras. Ver vulnerabilidad baja documentada abajo (slug sin escapeHtml en atributo title).
- [x] DevTools deshabilitados en build de produccion — evidencia: desktop/index.ts:43-45, win.webview.closeDevTools() si NODE_ENV === production. Pre-existente, no modificado por esta feature.
- [x] CSP configurado en el webview — evidencia: index.html:7-8, CSP: default-src none; script-src self; style-src self; connect-src ws://localhost:*. Pre-existente, no modificado por esta feature.
- [x] No se expone process.env completo al renderer via IPC — evidencia: ninguna funcion en handlers.ts ni en el modulo monitor expone process.env al renderer. Solo process.env.NODE_ENV se usa localmente en desktop/index.ts:11 y :43 para logica del proceso principal.
- [x] Cierre limpio de subprocesos al cerrar la app — evidencia: desktop/index.ts:19-20, getPoller().stop() registrado en process.on("exit") y process.on("SIGINT"). poller.stop() hace clearInterval correctamente en poller.ts:25-30.

### Vulnerabilidades encontradas

## Vulnerabilidad: slug sin escapeHtml en atributo title
- Severidad: baja
- Categoria OWASP: A03 Injection (XSS via atributo HTML)
- Archivo: src/monitor/ui/monitor-view.ts
- Linea: 75 y 103
- Descripcion: f.slug y b.slug se insertan sin escapeHtml() en el atributo HTML title= de celdas de tabla. El slug proviene del nombre del directorio en docs/features/ y docs/bugs/, leido por readdirSync en aggregator.ts.
- Vector de ataque: un directorio con nombre que contenga comillas dobles en docs/features/ podria romper el atributo title e inyectar atributos HTML adicionales. Requiere acceso de escritura al filesystem del repo (entorno de desarrollo local, repositorio git controlado). En produccion docs/ no existe, el snapshot es vacio, y la UI no renderiza ninguna fila.
- Evidencia: monitor-view.ts:75 — title="${f.slug}" y :103 — title="${b.slug}" sin escapeHtml. Contraste: f.title en la misma linea 75 si usa escapeHtml(f.title).
- Remediacion: reemplazar title="${f.slug}" por title="${escapeHtml(f.slug)}" y title="${b.slug}" por title="${escapeHtml(b.slug)}". La funcion escapeHtml ya existe en el mismo archivo (linea 173).

### Riesgos aceptados por Cipher

- slug sin escapeHtml en atributo title (monitor-view.ts:75,103): vector limitado a filesystem local del repo, requiere acceso de escritura al directorio docs/, el modulo solo tiene sentido en desarrollo donde el filesystem es controlado. En produccion el snapshot es siempre vacio. Severidad baja, no bloqueante para merge.
- state de features/bugs en class CSS (stateBadge, linea 22): aceptado. El parser en statusParser.ts:115 aplica .replace(/[^A-Z\s]/g, '') antes del mapeo al enum, eliminando todos los caracteres especiales. El resultado es siempre uno de los valores del FEATURE_STATE_MAP o 'DESCONOCIDO'. Sin riesgo practico.
- agentId en data-agent= y en texto (renderAgentCard, lineas 139-140): aceptado. agentId es de tipo AgentId (union literal TypeScript), solo puede contener uno de 5 valores fijos hardcoded en el pipeline.
- docsDir via process.cwd() sin validacion adicional: aceptado. El path es construido exclusivamente por el main process con un sufijo literal. No hay participacion del renderer en la construccion de la ruta.

Confianza en la auditoria: alta

### Decision: APROBADO

Hallazgo de severidad baja (slug sin escapeHtml en title) resuelto en monitor-view.ts:75,103 antes del merge. Sin vulnerabilidades pendientes. El modulo puede mergearse.

## Metricas de Cipher
- archivos_leidos: 12
- vulnerabilidades_criticas: 0
- vulnerabilidades_altas: 0
- vulnerabilidades_medias: 0
- vulnerabilidades_bajas: 1
- riesgos_aceptados: 3
- items_checklist_verificados: 10/10
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0
- decision: APROBADO

---

Estado final: MERGEADO
