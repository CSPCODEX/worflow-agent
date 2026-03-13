# Acceptance Criteria — Prompt Enhancement

## Componente: Migración DB (migrations.ts)

- [ ] La migración v2 añade la columna `enhance_status TEXT NOT NULL DEFAULT 'pending'` a la tabla `agents`.
- [ ] La migración es idempotente: correr dos veces no produce error.
- [ ] Agentes existentes en DB antes de la migración quedan con `enhance_status = 'pending'`.
- [ ] El número de versión 2 es mayor que la versión 1 existente (no rompe la lógica de migrations).

---

## Componente: agentRepository

- [ ] El método `updateSystemPrompt(id, systemPrompt, enhanceStatus)` ejecuta un UPDATE con prepared statement.
- [ ] `updateSystemPrompt` no lanza si el id no existe (UPDATE sin filas afectadas es silencioso).
- [ ] `insert()` existente no se modifica.
- [ ] `findByName()` y `findById()` no se modifican.

---

## Componente: staticEnhancer

- [ ] Dado un prompt de texto plano, devuelve un string con exactamente 4 secciones: `## Role`, `## Capabilities`, `## Constraints`, `## Output Format`.
- [ ] Si el prompt de entrada ya contiene `## Role`, el enhancer devuelve el input sin duplicar secciones (idempotente).
- [ ] La función es síncrona y nunca lanza excepciones.
- [ ] Las secciones `## Constraints` y `## Output Format` siempre contienen los bullets anti-alucinación definidos en plan.md.
- [ ] El idioma del contenido original se preserva (no traduce).

---

## Componente: lmStudioEnhancer

- [ ] Si LM Studio está disponible, la función retorna el prompt mejorado en menos de 15 segundos.
- [ ] Si el timeout de 15 segundos se cumple, la función lanza un Error (no retorna string vacío).
- [ ] Si `localhost:1234` rechaza la conexión, la función lanza un Error.
- [ ] El resultado está limpio de tokens de razonamiento interno (`<think>...</think>`, channel tokens).
- [ ] El resultado no está vacío — si el modelo devuelve vacío, la función lanza un Error.

---

## Componente: promptEnhancer (orquestador)

- [ ] Intenta LM Studio primero.
- [ ] Si LM Studio falla (cualquier error), aplica el enhancer estático como fallback sin re-lanzar el error.
- [ ] Devuelve `{ enhancedPrompt, strategy: 'lmstudio' }` cuando LM Studio tiene éxito.
- [ ] Devuelve `{ enhancedPrompt, strategy: 'static' }` cuando se usa el fallback.
- [ ] Devuelve `{ enhancedPrompt: originalPrompt, strategy: 'failed', error }` solo si el enhancer estático también fallara (caso extremo).
- [ ] La función nunca lanza — siempre resuelve la Promise.

---

## Componente: rewriteAgentIndexTs

- [ ] Recibe `(agentDir: string, agentName: string, enhancedPrompt: string)`.
- [ ] Lee `{agentDir}/index.ts` del disco.
- [ ] Reemplaza únicamente el valor de `const SYSTEM_PROMPT = "..."` con el prompt mejorado.
- [ ] El resto del archivo `index.ts` no se modifica.
- [ ] Escapa correctamente comillas dobles y saltos de línea en el prompt mejorado antes de escribir.
- [ ] Si el archivo no existe, la función lanza un Error descriptivo.

---

## Componente: handlers.ts — generateAgent modificado

- [ ] El handler retorna `{ success: true }` ANTES de que el enhance comience (sin latencia añadida).
- [ ] El enhance se lanza en background mediante una Promise sin await.
- [ ] Errores del enhance no propagan al handler ni bloquean la respuesta RPC.
- [ ] `rpc.send.agentEnhanceDone(...)` se emite siempre al terminar el enhance (éxito o fallo).
- [ ] El enhance se lanza en paralelo con `installAgentDeps`, no en secuencia.

---

## Componente: tipos IPC (ipc.ts)

- [ ] Existe la interface `AgentEnhanceDone` con campos: `agentName: string`, `agentDir: string`, `strategy: 'lmstudio' | 'static' | 'failed'`, `error?: string`.
- [ ] `agentEnhanceDone` está registrado en `AppRPC.webview.messages`.
- [ ] No hay cambios en los canales de request existentes.

---

## Componente: renderer — create-agent.ts

- [ ] La vista registra listener para `agent:enhance-done` antes de llamar `generateAgent`.
- [ ] El listener se elimina después de recibir el evento (sin memory leaks).
- [ ] Si `strategy === 'lmstudio'`, muestra un badge o texto "Prompt optimizado con IA".
- [ ] Si `strategy === 'static'`, muestra "Prompt estructurado".
- [ ] Si `strategy === 'failed'`, no muestra badge (el agente funciona con el prompt original).
- [ ] La navegación a la lista de agentes (`onDone()`) espera a que lleguen AMBOS eventos: `agent:install-done` y `agent:enhance-done`.
- [ ] Si el listener de enhance llega para un `agentName` distinto al recién creado, lo ignora.

---

## Criterio de integración end-to-end

- [ ] Crear un agente con LM Studio corriendo: el `index.ts` generado tiene un system prompt diferente al original (más largo o estructurado).
- [ ] Crear un agente con LM Studio apagado: el `index.ts` generado tiene el prompt estructurado en 4 secciones (static enhancer).
- [ ] En ambos casos, el DB `agents.system_prompt` coincide con el contenido de `SYSTEM_PROMPT` en `index.ts` del agente.
- [ ] En ambos casos, `agents.enhance_status` no es `'pending'` tras completarse el enhance.
- [ ] El formulario de creación no tiene latencia adicional perceptible respecto al flujo sin enhancement.
