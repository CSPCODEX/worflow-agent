// ============================================================
// complianceParser.ts -- Funciones puras de parseo de compliance
// Sin imports externos -- solo tipos internos del modulo.
// No toca filesystem ni red.
// ============================================================

import type { LeoContract, RejectionRecord, AgentId } from './types';

const VALID_INSTRUCTION_SOURCES = ['CLAUDE.md', 'agent_system_prompt', 'handoff_anterior'] as const;
const VALID_FAILURE_TYPES = ['patron_conocido', 'instruccion_ambigua', 'instruccion_ausente'] as const;
const VALID_AGENTS: AgentId[] = ['leo', 'cloe', 'max', 'ada', 'cipher'];

/**
 * Parsea el bloque "### Leo Contract\n```yaml\n...\n```" del status.md.
 * Retorna null si no existe el bloque o si el YAML es invalido.
 * No lanza excepciones.
 *
 * IMPORTANTE: No usar JSON.parse para YAML -- parsear manualmente las listas.
 * El YAML del contrato es intencionalmente simple: solo listas bajo claves conocidas.
 */
export function parseLeoContract(content: string): LeoContract | null {
  // Buscar bloque "### Leo Contract" seguido de fenced code block yaml
  const blockMatch = content.match(
    /###\s+Leo Contract\s*\n```yaml\s*\n([\s\S]*?)```/i
  );
  if (!blockMatch || !blockMatch[1]) return null;

  const yaml = blockMatch[1];

  try {
    const create = extractYamlList(yaml, 'create');
    const modify = extractYamlList(yaml, 'modify');
    const no_touch = extractYamlList(yaml, 'no_touch');
    // Al menos create o modify deben tener entradas para que sea un contrato valido
    if (create.length === 0 && modify.length === 0) return null;
    return { create, modify, no_touch };
  } catch {
    return null;
  }
}

/**
 * Extrae una lista YAML bajo una clave. Formato esperado:
 *   key:
 *     - item1
 *     - item2
 */
function extractYamlList(yaml: string, key: string): string[] {
  const keyRegex = new RegExp(`^${key}:\\s*$`, 'm');
  const keyMatch = yaml.match(keyRegex);
  if (!keyMatch || keyMatch.index === undefined) return [];

  const after = yaml.slice(keyMatch.index + keyMatch[0].length);
  const items: string[] = [];
  for (const line of after.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      items.push(trimmed.slice(2).trim());
    } else if (trimmed && !trimmed.startsWith('#')) {
      // Nueva clave YAML -- fin del bloque de la lista actual
      break;
    }
  }
  return items;
}

/**
 * Parsea todos los bloques "### Rejection Record\n```yaml\n...\n```" del status.md.
 * Retorna [] si no hay ningun bloque. YAML invalido se omite silenciosamente.
 */
export function parseRejectionRecords(
  content: string,
  featureSlug: string,
  recordedAt: string
): RejectionRecord[] {
  const records: RejectionRecord[] = [];

  // Iterar sobre todos los bloques Rejection Record en el archivo
  const blockRegex = /###\s+Rejection Record\s*\n```yaml\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(content)) !== null) {
    const yaml = match[1] ?? '';
    try {
      const record = parseRejectionYaml(yaml, featureSlug, recordedAt);
      if (record) records.push(record);
    } catch {
      // Omitir silenciosamente records invalidos
    }
  }

  return records;
}

function parseRejectionYaml(
  yaml: string,
  featureSlug: string,
  recordedAt: string
): RejectionRecord | null {
  const get = (key: string): string | null => {
    const m = yaml.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?\\s*$`, 'm'));
    return m?.[1]?.trim() ?? null;
  };

  const instructionViolated = get('instruction_violated');
  const instructionSource = get('instruction_source');
  const failureType = get('failure_type');
  const agentAtFault = get('agent_at_fault');

  if (!instructionViolated || !instructionSource || !failureType || !agentAtFault) return null;

  // Validar valores contra whitelists
  if (!(VALID_INSTRUCTION_SOURCES as readonly string[]).includes(instructionSource)) return null;
  if (!(VALID_FAILURE_TYPES as readonly string[]).includes(failureType)) return null;
  if (!VALID_AGENTS.includes(agentAtFault as AgentId)) return null;

  return {
    featureSlug,
    agentAtFault: agentAtFault as AgentId,
    instructionViolated,
    instructionSource: instructionSource as RejectionRecord['instructionSource'],
    failureType: failureType as RejectionRecord['failureType'],
    recordedAt,
  };
}
