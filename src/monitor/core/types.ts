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
  gapsDeclarados: number | null;
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
