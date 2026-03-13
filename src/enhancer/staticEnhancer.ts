/**
 * staticEnhancer.ts
 *
 * Deterministic prompt enhancer — no AI calls, always available.
 * Structures a free-form system prompt into 4 canonical sections.
 */

const CONSTRAINTS_SECTION = `## Constraints
- Responde solo en el idioma del usuario.
- No inventes información que no tengas en contexto.
- Si no sabes la respuesta, dilo explícitamente.
- No ejecutes acciones destructivas sin confirmación explícita.`;

const OUTPUT_FORMAT_SECTION = `## Output Format
- Respuestas claras y concisas.
- Usa listas cuando hay múltiples items.
- Código siempre en bloques de código con lenguaje especificado.`;

// Common action verbs (Spanish + English) used to infer capabilities from the prompt.
const ACTION_VERBS = [
  'analizar', 'analiza', 'analyze',
  'generar', 'genera', 'generate',
  'revisar', 'revisa', 'review',
  'crear', 'crea', 'create',
  'optimizar', 'optimiza', 'optimize',
  'documentar', 'documenta', 'document',
  'traducir', 'traduce', 'translate',
  'responder', 'responde', 'answer',
  'explicar', 'explica', 'explain',
  'buscar', 'busca', 'search',
  'diseñar', 'diseña', 'design',
  'implementar', 'implementa', 'implement',
  'refactorizar', 'refactoriza', 'refactor',
  'depurar', 'depura', 'debug',
  'validar', 'valida', 'validate',
  'sugerir', 'sugiere', 'suggest',
  'calcular', 'calcula', 'calculate',
  'resumir', 'resume', 'summarize',
  'clasificar', 'clasifica', 'classify',
  'comparar', 'compara', 'compare',
];

function extractCapabilities(prompt: string): string[] {
  const words = prompt.toLowerCase().split(/\s+/);
  const found: string[] = [];

  for (const verb of ACTION_VERBS) {
    if (words.includes(verb)) {
      // Capitalize first letter for bullet display
      const display = verb.charAt(0).toUpperCase() + verb.slice(1);
      found.push(`- ${display} tareas relacionadas con el dominio descrito.`);
    }
    // Cap at 5 capability bullets
    if (found.length >= 5) break;
  }

  if (found.length === 0) {
    found.push('- Responder preguntas relacionadas con el dominio descrito.');
  }

  return found;
}

/**
 * Synchronous, never-throws enhancer.
 * If the prompt already has ## Role, returns it unchanged (idempotent).
 */
export function enhanceStatic(originalPrompt: string): string {
  try {
    // Idempotency check
    if (originalPrompt.includes('## Role')) {
      return originalPrompt;
    }

    // Role section: first non-empty paragraph
    const paragraphs = originalPrompt.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const roleContent = paragraphs[0] ?? originalPrompt.trim();

    // Capabilities section
    const capabilities = extractCapabilities(originalPrompt);

    return [
      `## Role\n${roleContent}`,
      `## Capabilities\n${capabilities.join('\n')}`,
      CONSTRAINTS_SECTION,
      OUTPUT_FORMAT_SECTION,
    ].join('\n\n');
  } catch {
    // Last-resort defensive return — should never reach here
    return originalPrompt;
  }
}
