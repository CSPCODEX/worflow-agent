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

// Extrae el bloque de texto del handoff del agente hasta el siguiente header ## (no ###)
// Retorna '' si no se encuentra o si el handoff es un placeholder (incompleto)
// Fix: (?=\n##(?!#)|$) evita que ### sub-secciones corten la extraccion prematuramente
// Cipher es especial: su seccion se llama "## Resultado de Cipher", no "## Handoff Cipher →"
function extractHandoffSection(content: string, agentId: AgentId): string {
  const agentName = AGENT_DISPLAY[agentId];

  let sectionRegex: RegExp;
  if (agentId === 'cipher') {
    // Cipher no tiene "Handoff" — su seccion es "## Resultado de Cipher"
    sectionRegex = /## Resultado de Cipher[\s\S]*?(?=\n##(?!#)|$)/i;
  } else {
    // Cubre: "## Handoff Leo → Cloe", "## Handoff de Leo -> Cloe", "## Handoff de Leo a Cloe"
    sectionRegex = new RegExp(
      `## Handoff (?:de )?${agentName}[^\\n]*?(?:->|\\u2192|\\ba\\b)[\\s\\S]*?(?=\\n##(?!#)|$)`,
      'i'
    );
  }

  const section = content.match(sectionRegex)?.[0] ?? '';
  if (!section || section.length < 30) return '';
  // Si es placeholder, no hay datos de comportamiento
  const isPlaceholder = />\s*(Leo|Cloe|Max|Ada|Cipher):\s*completa esta seccion/i.test(section);
  if (isPlaceholder) return '';
  return section;
}

// Cuenta items de checklist -- solo en la seccion "### Checklist <Agent>"
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
