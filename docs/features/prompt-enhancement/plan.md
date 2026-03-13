# Plan — Prompt Enhancement

## Objetivo

Mejorar automáticamente el system prompt de cada agente creado, en background, sin añadir latencia al flujo de creación. El enhance usa LM Studio cuando está disponible; si no lo está, aplica un enhancer estático que estructura el prompt en secciones canónicas.

---

## Estrategia: A + C (LM Studio background + fallback estático)

Dos rutas de enhance, ejecutadas en background tras el DB insert:

- **Propuesta A — LM Studio:** llama al modelo local con un meta-prompt que produce un system prompt mejorado. Requiere que LM Studio esté corriendo en `localhost:1234`.
- **Propuesta C — Enhancer estático:** transforma el prompt original en una estructura de 4 secciones sin ninguna llamada externa. Siempre disponible.

La lógica intenta A primero. Si A falla (timeout, conexión rechazada, modelo no cargado), aplica C como fallback. El resultado final — ya sea A o C — sobreescribe el `system_prompt` en DB y reescribe el `index.ts` del agente en disco.

---

## Archivos a crear

```
src/enhancer/
  promptEnhancer.ts       # Orquestador: intenta LM Studio, fallback a estático
  lmStudioEnhancer.ts     # Propuesta A: llama a LMStudioClient con meta-prompt
  staticEnhancer.ts       # Propuesta C: estructuración determinista sin IA
  metaPrompt.ts           # Meta-prompt para LM Studio (texto constante)
```

---

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/ipc/handlers.ts` | Lanzar enhance en background tras DB insert; emitir `agentEnhanceDone` por rpc.send |
| `src/types/ipc.ts` | Añadir `AgentEnhanceDone` interface + canal `agentEnhanceDone` en `AppRPC` |
| `src/db/agentRepository.ts` | Añadir método `updateSystemPrompt(id, prompt)` |
| `src/db/migrations.ts` | Migración v2: columna `enhance_status TEXT DEFAULT 'pending'` en tabla `agents` |
| `src/generators/agentGenerator.ts` | Exportar `rewriteAgentIndexTs(agentDir, agentName, enhancedPrompt)` |
| `src/renderer/views/create-agent.ts` | Escuchar `agent:enhance-done`, actualizar feedback en UI |

---

## Prioridad de implementación

1. `src/db/migrations.ts` — migración v2 (base de todo)
2. `src/db/agentRepository.ts` — `updateSystemPrompt()` + `setEnhanceStatus()`
3. `src/generators/agentGenerator.ts` — `rewriteAgentIndexTs()`
4. `src/enhancer/staticEnhancer.ts` — fallback determinista
5. `src/enhancer/metaPrompt.ts` — texto constante del meta-prompt
6. `src/enhancer/lmStudioEnhancer.ts` — llamada a LM Studio
7. `src/enhancer/promptEnhancer.ts` — orquestador A+C
8. `src/types/ipc.ts` — nuevos tipos
9. `src/ipc/handlers.ts` — integración en `generateAgent`
10. `src/renderer/views/create-agent.ts` — listener `agent:enhance-done`

---

## Decisiones de diseño

### Por qué background y no await en el handler

El handler `generateAgent` retorna `{ success: true }` inmediatamente tras el DB insert. El enhance corre en una Promise que no bloquea el handler. Esto mantiene la UX sin cambios durante la creación.

### Por qué reescribir index.ts y no solo DB

La fuente de verdad de ejecución es el archivo `index.ts` del agente. Si solo se actualiza la DB, el agente en producción seguiría usando el prompt original. Ambas fuentes deben sincronizarse.

### Por qué `enhance_status` en DB

Permite que la UI sepa en qué estado está el enhance sin depender solo de eventos IPC. Valores: `pending` (creado, enhance no terminó), `done` (mejorado), `failed` (falló A y C), `static` (se usó fallback C).

### Timeout LM Studio

Se aplica un timeout de 15 segundos a la llamada LM Studio. Pasado ese tiempo, se considera fallo y se activa el fallback estático.

### Enhancer estático — estructura canónica

Secciones en orden fijo:
```
## Role
<párrafo de rol derivado del prompt original>

## Capabilities
<lista de capacidades implícitas en el prompt>

## Constraints
- Responde solo en el idioma del usuario.
- No inventes información que no tengas en contexto.
- Si no sabes la respuesta, dilo explícitamente.
- No ejecutes acciones destructivas sin confirmación explícita.

## Output Format
- Respuestas claras y concisas.
- Usa listas cuando hay múltiples items.
- Código siempre en bloques de código con lenguaje especificado.
```

Las secciones Role y Capabilities se derivan del prompt original mediante heurísticas simples (no IA). Constraints y Output Format son constantes que minimizan alucinaciones y definen formato de salida.

### Meta-prompt LM Studio — objetivos

El meta-prompt instruye al modelo para:
1. Clarificar el rol sin ambigüedad
2. Listar capacidades explícitas y límites
3. Añadir constraints anti-alucinación estándar
4. Definir formato de salida estructurado
5. Mantener el idioma del prompt original
6. Devolver SOLO el system prompt mejorado, sin explicaciones adicionales
