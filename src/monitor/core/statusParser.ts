import type {
  FeatureRecord, BugRecord, AgentMetrics, HandoffStatus,
  FeatureState, BugState, AgentId, AgentBehaviorMetrics,
} from './types';
import { parseBehaviorMetrics } from './behaviorParser';

// Mapa de texto en status.md -> FeatureState enum
const FEATURE_STATE_MAP: Record<string, FeatureState> = {
  'EN PLANIFICACION': 'EN_PLANIFICACION',
  'EN IMPLEMENTACION': 'EN_IMPLEMENTACION',
  'LISTO PARA IMPLEMENTACION': 'EN_IMPLEMENTACION',
  'IMPLEMENTADO': 'EN_VERIFICACION',
  'EN VERIFICACION': 'EN_VERIFICACION',
  'CORRECCION COMPLETADA': 'EN_VERIFICACION',
  'EN OPTIMIZACION': 'EN_OPTIMIZACION',
  'OPTIMIZADO': 'EN_AUDITORIA',
  'EN AUDITORIA': 'EN_AUDITORIA',
  'AUDITADO': 'AUDITADO',
  'LISTO PARA MERGE': 'LISTO_PARA_MERGE',
  'APROBADO PARA MERGE': 'LISTO_PARA_MERGE',
  'APROBADO': 'LISTO_PARA_MERGE',
  'MERGEADO': 'MERGEADO',
  'BLOQUEADO': 'BLOQUEADO',
};

// Extrae el valor de una linea "Clave: valor" o "**Clave:** valor" (formato bold de markdown)
function extractLine(content: string, key: string): string | null {
  const regex = new RegExp(`^\\*{0,2}${key}:\\*{0,2}\\s*(.+)$`, 'mi');
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
    const m = section!.match(new RegExp(`^-?\\s*${key}:\\s*(\\d+)`, 'mi'));
    return m ? parseInt(m[1]!, 10) : null;
  }
  function bool(key: string): boolean | null {
    const m = section!.match(new RegExp(`^-?\\s*${key}:\\s*(si|no|true|false)`, 'mi'));
    if (!m) return null;
    return m[1]!.toLowerCase() === 'si' || m[1]!.toLowerCase() === 'true';
  }
  function conf(): 'alta' | 'media' | 'baja' | null {
    const m = section!.match(/^-?\s*confianza:\s*(alta|media|baja)/mi);
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
    gapsDeclarados: num('gaps_declarados'),
  };

  // Si todos los campos son null, no hay seccion real de metricas
  const hasAny = Object.values(metrics).some((v, i) => i > 0 && v !== null);
  return hasAny ? metrics : null;
}

const ALL_AGENTS: AgentId[] = ['leo', 'cloe', 'max', 'ada', 'cipher'];

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
  filePath: string,
  repoRoot: string = ''
): FeatureRecord {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.replace(/^Feature\s*[--]\s*/i, '').trim() ?? slug;

  const rawState = extractLine(content, 'Estado final') ?? extractLine(content, 'Estado') ?? '';
  // Truncar al primer em-dash (U+2014/U+2013) o guion doble (--) para manejar valores compuestos
  // como "AUDITADO -- listo para merge" o "APROBADO -- LISTO PARA MERGE A MAIN".
  // El texto relevante del estado es siempre la primera parte antes del separador.
  const rawStateTruncated = rawState.split(/\s*[\u2014\u2013]|\s*--/).shift() ?? rawState;
  const normalizedState = rawStateTruncated.toUpperCase().replace(/[^A-Z\s]/g, '').trim();
  const state: FeatureState = FEATURE_STATE_MAP[normalizedState] ?? 'DESCONOCIDO';

  const branch = extractLine(content, 'Rama') ?? '';
  const openedAt = extractLine(content, 'Fecha apertura') ?? '';

  const handoffs = parseHandoffs(content);

  const metrics: AgentMetrics[] = ALL_AGENTS
    .map((id) => parseAgentMetrics(content, id))
    .filter((m): m is AgentMetrics => m !== null);

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
}

export function parseBugStatus(
  content: string,
  id: string,
  slug: string,
  filePath: string
): BugRecord {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.replace(/^Bug\s*#\d+\s*[--]\s*/i, '').trim() ?? slug;

  const rawState =
    extractLine(content, 'Estado') ??
    extractLine(content, 'Status') ??   // formato ingles antiguo (bugs 004/005/006)
    '';
  // Limpiar posibles backticks del valor antes de normalizar
  const normalizedState = rawState.replace(/`/g, '').toUpperCase().trim();
  const BUG_STATE_MAP: Record<string, BugState> = {
    'ABIERTO': 'ABIERTO',
    'EN DIAGNOSTICO': 'EN_DIAGNOSTICO',
    'EN PROGRESO': 'EN_DIAGNOSTICO',
    'EN IMPLEMENTACION': 'EN_IMPLEMENTACION',
    'EN VERIFICACION': 'EN_VERIFICACION',
    'RESUELTO': 'RESUELTO',
    'RESOLVED': 'RESUELTO',
    'VERIFIED': 'RESUELTO',
  };
  const state: BugState = BUG_STATE_MAP[normalizedState] ?? 'DESCONOCIDO';

  const openedAt = extractLine(content, 'Fecha') ?? '';
  const hasSecurityImplication = /implicaciones de seguridad:\s*si/i.test(content);

  const agentMetrics: Partial<Record<AgentId, AgentMetrics>> = {};
  for (const agentId of ALL_AGENTS) {
    const m = parseAgentMetrics(content, agentId);
    if (m) agentMetrics[agentId] = m;
  }

  return { id, slug, title, state, openedAt, hasSecurityImplication, agentMetrics, filePath };
}
