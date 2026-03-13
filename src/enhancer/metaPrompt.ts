/**
 * metaPrompt.ts
 *
 * System instruction and user-message builder for the LM Studio prompt-enhancement call.
 */

export const META_SYSTEM_INSTRUCTION = `Eres un experto en prompt engineering para agentes de IA.
Tu única tarea es reescribir el system prompt que recibes para hacerlo más claro y efectivo.

Reglas estrictas:
- Devuelve ÚNICAMENTE el system prompt mejorado. Sin explicaciones, sin prefijos, sin comillas externas.
- Mantén el idioma del prompt original (no traduzcas).
- Estructura el resultado en exactamente estas 4 secciones en orden: ## Role, ## Capabilities, ## Constraints, ## Output Format.
- La sección ## Constraints SIEMPRE debe incluir exactamente estas 4 reglas:
  - Responde solo en el idioma del usuario.
  - No inventes información que no tengas en contexto.
  - Si no sabes la respuesta, dilo explícitamente.
  - No ejecutes acciones destructivas sin confirmación explícita.
- La sección ## Output Format SIEMPRE debe incluir exactamente estos 3 bullets:
  - Respuestas claras y concisas.
  - Usa listas cuando hay múltiples items.
  - Código siempre en bloques de código con lenguaje especificado.`;

/**
 * Builds the user-message that is sent to the model alongside META_SYSTEM_INSTRUCTION.
 */
export function buildMetaPrompt(originalPrompt: string, agentName: string): string {
  return `Nombre del agente: ${agentName}

System prompt original:
---
${originalPrompt}
---

Reescribe el system prompt anterior estructurándolo en las 4 secciones canónicas: ## Role, ## Capabilities, ## Constraints, ## Output Format. Devuelve SOLO el nuevo system prompt, sin ningún texto adicional.`;
}
