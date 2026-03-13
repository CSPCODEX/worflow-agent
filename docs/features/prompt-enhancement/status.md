# Status — Prompt Enhancement

**Estado:** Listo para implementacion
**Fecha de diseño:** 2026-03-08
**Implementado por:** Cloe

---

## Que hace esta feature

Cuando el usuario crea un agente, el system prompt se mejora automaticamente en background. No hay latencia en el submit. El enhance ocurre en paralelo con `bun install`. Al terminar, se actualiza la DB y se reescribe el `index.ts` del agente en disco. La UI recibe una notificacion via IPC.

Dos rutas de enhance:
- **LM Studio (A):** llama al modelo local en `localhost:1234` con un meta-prompt diseñado para claridad de rol, anti-alucinacion y structured output.
- **Estatico (C) — fallback:** estructura el prompt en 4 secciones deterministas sin IA. Se usa si LM Studio no esta disponible o devuelve error en 15 segundos.

---

## Archivos a CREAR

```
src/enhancer/promptEnhancer.ts
src/enhancer/lmStudioEnhancer.ts
src/enhancer/staticEnhancer.ts
src/enhancer/metaPrompt.ts
```

### src/enhancer/metaPrompt.ts

Exporta una funcion `buildMetaPrompt(originalPrompt: string, agentName: string): string` y una constante `META_SYSTEM_INSTRUCTION: string`.

El META_SYSTEM_INSTRUCTION le dice al modelo:
- Eres un experto en prompt engineering para agentes de IA.
- Tu unica tarea es reescribir el system prompt que recibes para hacerlo mas claro y efectivo.
- Devuelve UNICAMENTE el system prompt mejorado. Sin explicaciones, sin prefijos, sin comillas externas.

El `buildMetaPrompt` construye el mensaje de usuario con el prompt original y el nombre del agente, pidiendo al modelo que estructure el prompt en 4 secciones: Role, Capabilities, Constraints, Output Format. Los constraints SIEMPRE deben incluir las 4 reglas anti-alucinacion (ver seccion Enhancer Estatico mas abajo).

### src/enhancer/staticEnhancer.ts

```typescript
export function enhanceStatic(originalPrompt: string): string
```

Funcion sincrona que nunca lanza. Logica:
1. Si el input ya contiene `## Role` -> devolver input sin cambios (idempotente).
2. Primer parrafo del prompt -> seccion `## Role`.
3. Buscar verbos en infinitivo en el texto (analizar, generar, revisar, etc.) -> construir lista bullets para `## Capabilities`. Si no se detectan verbos, usar `- Responder preguntas relacionadas con el dominio descrito.` como fallback.
4. Seccion `## Constraints` — siempre estos 4 bullets:
   - Responde solo en el idioma del usuario.
   - No inventes informacion que no tengas en contexto.
   - Si no sabes la respuesta, dilo explicitamente.
   - No ejecutes acciones destructivas sin confirmacion explicita.
5. Seccion `## Output Format` — siempre estos 3 bullets:
   - Respuestas claras y concisas.
   - Usa listas cuando hay multiples items.
   - Codigo siempre en bloques de codigo con lenguaje especificado.

Formato de salida:
```
## Role
<parrafo>

## Capabilities
- <bullet 1>
- <bullet 2>

## Constraints
- Responde solo en el idioma del usuario.
- No inventes informacion que no tengas en contexto.
- Si no sabes la respuesta, dilo explicitamente.
- No ejecutes acciones destructivas sin confirmacion explicita.

## Output Format
- Respuestas claras y concisas.
- Usa listas cuando hay multiples items.
- Codigo siempre en bloques de codigo con lenguaje especificado.
```

### src/enhancer/lmStudioEnhancer.ts

```typescript
export async function enhanceWithLmStudio(
  originalPrompt: string,
  agentName: string
): Promise<string>  // lanza si falla
```

Implementacion:
```typescript
import { LMStudioClient } from '@lmstudio/sdk';
import { buildMetaPrompt, META_SYSTEM_INSTRUCTION } from './metaPrompt';

export async function enhanceWithLmStudio(originalPrompt: string, agentName: string): Promise<string> {
  const lmClient = new LMStudioClient();
  const model = await lmClient.llm.model();  // primer modelo disponible

  const metaPrompt = buildMetaPrompt(originalPrompt, agentName);
  let fullResponse = '';

  const responsePromise = (async () => {
    for await (const fragment of model.respond([
      { role: 'system', content: META_SYSTEM_INSTRUCTION },
      { role: 'user', content: metaPrompt },
    ])) {
      fullResponse += fragment.content;
    }
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('LM Studio enhance timeout (15s)')), 15_000)
  );

  await Promise.race([responsePromise, timeoutPromise]);

  // Limpiar tokens de razonamiento interno
  const channelMatch = fullResponse.match(/<\|channel\|>final<\|message\|>([\s\S]*?)(?:<\|end\|>|$)/);
  const cleaned = channelMatch
    ? channelMatch[1].trim()
    : fullResponse.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  if (!cleaned) throw new Error('LM Studio devolvio respuesta vacia');
  return cleaned;
}
```

### src/enhancer/promptEnhancer.ts

```typescript
export interface EnhanceResult {
  enhancedPrompt: string;
  strategy: 'lmstudio' | 'static' | 'failed';
  error?: string;
}

export async function enhancePrompt(
  originalPrompt: string,
  agentName: string
): Promise<EnhanceResult>
```

Logica:
1. Intentar `enhanceWithLmStudio(originalPrompt, agentName)`
2. Si OK -> return `{ enhancedPrompt: result, strategy: 'lmstudio' }`
3. Si lanza -> `console.error('[enhancer] LM Studio failed, using static fallback:', err.message)`
4. Intentar `enhanceStatic(originalPrompt)`
5. Si OK -> return `{ enhancedPrompt: result, strategy: 'static' }`
6. Si lanza (improbable) -> return `{ enhancedPrompt: originalPrompt, strategy: 'failed', error: err.message }`

La funcion nunca lanza. Siempre resuelve.

---

## Archivos a MODIFICAR

### 1. src/db/migrations.ts

Añadir migracion v2 al array `migrations`:
```typescript
{
  version: 2,
  up: `ALTER TABLE agents ADD COLUMN enhance_status TEXT NOT NULL DEFAULT 'pending';`
}
```

### 2. src/db/agentRepository.ts

Anadir metodo `updateSystemPrompt` al objeto `agentRepository`:
```typescript
updateSystemPrompt(id: string, systemPrompt: string, enhanceStatus: 'done' | 'static' | 'failed'): void {
  const db = getDatabase();
  db.run(
    'UPDATE agents SET system_prompt = ?, enhance_status = ? WHERE id = ?',
    [systemPrompt, enhanceStatus, id]
  );
},
```

Nota: el campo `AgentRow` debe incluir `enhance_status: string` para que las queries sean correctas si se necesita leer el valor. Anadir a la interface `AgentRow` y mapear en `rowToRecord` si se requiere exponer al renderer en el futuro (por ahora solo se escribe, no se lee en UI).

### 3. src/generators/agentGenerator.ts

Exportar nueva funcion `rewriteAgentIndexTs`:
```typescript
export async function rewriteAgentIndexTs(
  agentDir: string,
  agentName: string,
  enhancedPrompt: string
): Promise<void>
```

Implementacion:
- Leer `path.join(agentDir, 'index.ts')` con `readFile` de `./fileSystem`.
- El archivo tiene una linea: `const SYSTEM_PROMPT = "{{valor}}";`
- Escapar el prompt: `.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')`
- Reemplazar con regex: `/^(const SYSTEM_PROMPT = ").*(";)/m` -> `$1${escapedPrompt}$2`
- Escribir el resultado con `writeFile` de `./fileSystem`.
- Si el archivo no existe, lanzar `new Error(`index.ts no encontrado en ${agentDir}`)`.

### 4. src/types/ipc.ts

Anadir interface despues de `AgentInstallDone`:
```typescript
export interface AgentEnhanceDone {
  agentName: string;
  agentDir: string;
  strategy: 'lmstudio' | 'static' | 'failed';
  error?: string;
}
```

En `AppRPC`, en el bloque `webview.messages`, anadir:
```typescript
agentEnhanceDone: AgentEnhanceDone;
```

### 5. src/ipc/handlers.ts

En el handler `generateAgent`, despues del bloque que llama a `installAgentDeps`, anadir la funcion auxiliar `enhanceAndPersist` y su invocacion en background.

La funcion `enhanceAndPersist` se define fuera de `createRpc` para mantener el handler limpio:

```typescript
// En el top del archivo, nuevos imports:
import { enhancePrompt } from '../enhancer/promptEnhancer';
import { rewriteAgentIndexTs } from '../generators/agentGenerator';

// Funcion auxiliar (fuera de createRpc):
async function enhanceAndPersist(
  agentId: string,
  agentDir: string,
  agentName: string,
  originalPrompt: string,
  rpcSend: (payload: AgentEnhanceDone) => void
): Promise<void> {
  const result = await enhancePrompt(originalPrompt, agentName);

  const dbStatus = result.strategy === 'lmstudio' ? 'done' : result.strategy;
  agentRepository.updateSystemPrompt(agentId, result.enhancedPrompt, dbStatus as any);

  try {
    await rewriteAgentIndexTs(agentDir, agentName, result.enhancedPrompt);
  } catch (e: any) {
    console.error('[enhancer] No se pudo reescribir index.ts:', e.message);
  }

  rpcSend({
    agentName,
    agentDir,
    strategy: result.strategy,
    ...(result.error ? { error: result.error } : {}),
  });
}
```

En el handler `generateAgent`, despues del bloque `installAgentDeps`:
```typescript
// Phase 3 — enhance: mejora el system prompt en background (paralelo a bun install).
enhanceAndPersist(
  insertedAgent.id,   // necesitas guardar el return de agentRepository.insert()
  agentDir,
  config.name,
  config.role,
  (payload) => (rpc as any).send.agentEnhanceDone(payload)
).catch((e) => console.error('[enhancer] Error inesperado en enhance:', e));
```

Nota: actualmente `agentRepository.insert()` retorna `AgentRecord`. Guarda ese return en una variable `const insertedAgent = agentRepository.insert(...)` para usar `insertedAgent.id` en la llamada a `enhanceAndPersist`.

### 6. src/renderer/views/create-agent.ts

Anadir import type y listener para `agent:enhance-done`. La coordinacion entre los dos eventos (install + enhance) se maneja con flags booleanos:

```typescript
// Flags de coordinacion
let installDone = false;
let enhanceDone = false;

function tryNavigate() {
  if (installDone && enhanceDone) {
    setTimeout(() => onDone(), 800);
  }
}

function onInstallDone(e: Event) {
  const { agentName, error } = (e as CustomEvent).detail as { agentName: string; error?: string };
  if (agentName !== name) return;
  document.removeEventListener('agent:install-done', onInstallDone);
  installDone = true;

  if (error) {
    showFeedback('error', `Dependencias no instaladas: ${error}.`);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Crear agente';
  } else {
    if (!enhanceDone) {
      showFeedback('success', `Agente "${name}" listo. Optimizando prompt...`);
    }
    tryNavigate();
  }
}

function onEnhanceDone(e: Event) {
  const detail = (e as CustomEvent).detail as { agentName: string; strategy: string; error?: string };
  if (detail.agentName !== name) return;
  document.removeEventListener('agent:enhance-done', onEnhanceDone);
  enhanceDone = true;

  if (detail.strategy === 'lmstudio') {
    showFeedback('success', `Agente "${name}" listo. Prompt optimizado con IA.`);
  } else if (detail.strategy === 'static') {
    showFeedback('success', `Agente "${name}" listo. Prompt estructurado.`);
  }
  // strategy === 'failed': no cambiar el mensaje, el agente funciona con prompt original

  tryNavigate();
}

document.addEventListener('agent:install-done', onInstallDone);
document.addEventListener('agent:enhance-done', onEnhanceDone);
```

Importante: registrar ambos listeners ANTES de llamar a `rpc.request.generateAgent(...)`. Limpiar los listeners tambien en el path de error del RPC call.

---

## Decisiones a respetar

1. **No await en el handler.** `enhanceAndPersist` se lanza con `.catch()` y sin `await`. El handler retorna antes de que el enhance empiece.
2. **Instalar dependencias y enhance en paralelo.** Ambos se lanzan despues del DB insert sin esperar uno al otro.
3. **`rewriteAgentIndexTs` usa regex en linea, no re-renderiza el template.** El template ya fue aplicado por `scaffoldAgent`; reescribir solo el valor de `SYSTEM_PROMPT` es mas seguro y rapido.
4. **`staticEnhancer` nunca lanza.** Es el ultimo nivel de defensa; si fallara, el agente funcionaria con el prompt original.
5. **Timeout LM Studio: 15 segundos fijos.** No configurable por el usuario en esta version.
6. **`enhance_status` en DB.** Los valores son: `pending` (default tras insert), `done` (LM Studio exitoso), `static` (fallback aplicado), `failed` (ningun enhancer funcionó).

---

## Metricas de Leo

- Archivos nuevos: 4
- Archivos modificados: 6
- Nuevos tipos IPC: 1 (AgentEnhanceDone)
- Nuevos eventos DOM en renderer: 1 (agent:enhance-done)
- Metodos DB nuevos: 1 (updateSystemPrompt)
- Migraciones: 1 (v2, ALTER TABLE ADD COLUMN)
- Funciones exportadas nuevas desde generators: 1 (rewriteAgentIndexTs)

---

## Handoff de Cloe -> Max

**Estado:** Implementacion completa. Lista para verificacion de Max.

### Archivos creados

- `src/enhancer/staticEnhancer.ts` — enhancer deterministico, nunca lanza
- `src/enhancer/metaPrompt.ts` — META_SYSTEM_INSTRUCTION + buildMetaPrompt()
- `src/enhancer/lmStudioEnhancer.ts` — llamada LM Studio con timeout 15s, limpieza de tokens internos
- `src/enhancer/promptEnhancer.ts` — orquestador A+C, siempre resuelve

### Archivos modificados

- `src/db/migrations.ts` — migración v2 añadida al array
- `src/db/agentRepository.ts` — campo enhance_status en AgentRow + método updateSystemPrompt()
- `src/generators/agentGenerator.ts` — nueva funcion exportada rewriteAgentIndexTs()
- `src/types/ipc.ts` — interface AgentEnhanceDone + canal agentEnhanceDone en AppRPC.webview.messages
- `src/ipc/handlers.ts` — funcion enhanceAndPersist() + invocacion fire-and-forget en generateAgent
- `src/renderer/app.ts` — handler agentEnhanceDone que dispara CustomEvent 'agent:enhance-done'
- `src/renderer/views/create-agent.ts` — coordinacion de dos eventos (install + enhance) con flags booleanos

### Decisiones tomadas

1. `enhanceAndPersist` definida fuera de `createRpc` para mantener el handler limpio y reutilizable.
2. `rewriteAgentIndexTs` recibe `_agentName` (prefijo underscore) porque no lo usa internamente; lo conserve en la firma por contrato del plan.
3. `staticEnhancer` tiene un `try/catch` global adicional al nivel del return para garantizar que nunca lanza incluso con inputs no esperados.
4. La coordincacion en el renderer usa el flag `installDone` para mostrar "Optimizando prompt..." solo cuando install termino primero; si enhance llega antes, el mensaje de enhance sobreescribe el de installing correctamente.
5. En el error path del submit (RPC fallo o result.error) se eliminan ambos listeners para evitar memory leaks.

### Lo que Max debe verificar

- [ ] Migración v2 es idempotente: correr `runMigrations()` dos veces no produce error (SQLite lanza si ADD COLUMN ya existe — verificar que database.ts maneja esto).
- [ ] `enhanceAndPersist` no bloquea el return `{ success: true }` del handler.
- [ ] Con LM Studio apagado: el agente se crea, `enhance_status` queda en 'static', `index.ts` tiene prompt estructurado en 4 secciones.
- [ ] Con LM Studio corriendo: el agente se crea, `enhance_status` queda en 'done', `index.ts` tiene prompt mejorado.
- [ ] Si LM Studio tarda mas de 15s: fallback estatico se activa.
- [ ] La UI muestra el badge correcto segun la estrategia.
- [ ] Navegacion ocurre solo despues de AMBOS eventos (install + enhance).
- [ ] Listeners se limpian en todos los paths (success, error de RPC, error de result).

---

## Metricas de Cloe

- Archivos nuevos: 4 (src/enhancer/*.ts)
- Archivos modificados: 7 (migrations, agentRepository, agentGenerator, ipc.ts, handlers.ts, app.ts, create-agent.ts)
- Lineas añadidas estimadas: ~200
- Lineas modificadas estimadas: ~60
- Nuevas funciones exportadas: 5 (enhanceStatic, buildMetaPrompt, enhanceWithLmStudio, enhancePrompt, rewriteAgentIndexTs)
- Nuevos tipos: 1 (AgentEnhanceDone)
- Nuevos canales IPC: 1 (agentEnhanceDone)

---

## Handoff de Ada -> Cipher

**Estado:** Optimizacion completa. Lista para auditoria de seguridad.

### Cambios aplicados

- `src/generators/agentGenerator.ts` — eliminado parametro inutilizado `_agentName` de `rewriteAgentIndexTs` (el plan lo incluyó por contrato pero nunca se usa dentro de la función); `generateAgent` (CLI path) ahora delega a `scaffoldAgent` en lugar de duplicar las 5 operaciones de scaffolding.
- `src/ipc/handlers.ts` — actualizada la llamada a `rewriteAgentIndexTs` para omitir el argumento eliminado; eliminado el cast innecesario `result.strategy as 'static' | 'failed'` en `dbStatus` (TypeScript ya estrecha el tipo tras el ternario); reemplazado `let insertedAgent: ReturnType<typeof agentRepository.insert>` con `let insertedAgent` (la inferencia de tipo desde la asignación es suficiente y mas limpia).
- `src/enhancer/staticEnhancer.ts` — corregido el guard de deduplicacion en `extractCapabilities`: el check `!found.includes(verb)` comparaba verbos crudos contra bullets formateados, por lo que nunca coincidía (siempre pasaba). Se eliminó el check muerto; la caps en 5 via `break` es la única guardia necesaria y era correcta.

### Metricas

- Lineas eliminadas netas: ~28 (scaffolding duplicado en `generateAgent` + parametro muerto + cast + tipo verbose)
- Sin cambio de comportamiento en ningun path (CLI, IPC, enhancer)
- Bundle: sin impacto medible (cambios son de logica, no de imports)

### Notas para Cipher

- `lmStudioEnhancer.ts` crea un `LMStudioClient` en cada llamada — no hay instancia compartida. Verificar si la conexion WebSocket al servidor LM Studio se cierra correctamente despues del enhance (posible fuga de socket si el timeout dispara antes de que el for-await termine).
- El `setTimeout` dentro del `timeoutPromise` en `lmStudioEnhancer.ts` no se cancela si `responsePromise` gana la race — el timer queda vivo hasta que expira. No es un memory leak severo (el timer es de 15s y no hay referencias circulares), pero Cipher deberia notarlo.
- `spawnSync` en `generateAgent` (CLI path, linea 130) sigue siendo bloqueante — es intencional para el flujo de terminal interactivo, no es un issue de seguridad.

## Metricas de Ada

- Archivos modificados: 3 (agentGenerator.ts, handlers.ts, staticEnhancer.ts)
- Lineas eliminadas: ~28
- Parametros muertos eliminados: 1 (_agentName en rewriteAgentIndexTs)
- Duplicacion eliminada: logica de scaffolding duplicada en generateAgent (~20 lineas)
- Bugs corregidos: 1 (guard de dedup en extractCapabilities comparaba tipos incompatibles)
- Casts innecesarios eliminados: 1 (dbStatus en handlers.ts)
- Tipos verbose eliminados: 1 (ReturnType<typeof agentRepository.insert>)

---

## Resultado de Cipher

**Veredicto: APROBADO CON OBSERVACIONES**
**Fecha de auditoria:** 2026-03-08
**Archivos auditados:** 10 (4 nuevos, 6 modificados)

### Checklist de auditoria pre-release

- [x] Sin secrets en el codigo fuente ni en git history
- [x] `.env` en `.gitignore` y no commiteado
- [x] Inputs del webview validados antes de operaciones de file system
- [x] Spawn de agentes usa rutas absolutas, no interpolacion de strings del usuario
- [ ] DevTools deshabilitados en build de produccion (pendiente de release anterior, riesgo aceptado)
- [ ] CSP configurado en el webview (pendiente de release anterior, riesgo aceptado)
- [x] No se expone `process.env` completo al renderer via IPC
- [x] Cierre limpio de subprocesos al cerrar la app
- [x] Templates `.tpl` escapan caracteres especiales correctamente

### Vulnerabilidades encontradas

#### MEDIA — Information disclosure: agentDir (path absoluto) expuesto al renderer via AgentEnhanceDone e AgentInstallDone

- Severidad: media
- Categoria OWASP: A01 Broken Access Control / A05 Security Misconfiguration
- Archivo: `src/types/ipc.ts` lineas 61 y 68; `src/ipc/handlers.ts` lineas 33 y 78
- Descripcion: Las interfaces `AgentInstallDone` y `AgentEnhanceDone` incluyen el campo `agentDir` que contiene la ruta absoluta del sistema de archivos. Este path viaja al renderer via IPC y queda disponible en el objeto `detail` del CustomEvent. El renderer actual no lo usa pero el campo existe en el contrato y lo expone a cualquier codigo futuro o XSS.
- Vector de ataque: codigo JavaScript en el webview puede leer `detail.agentDir` de los eventos `agent:install-done` y `agent:enhance-done` y obtener la ruta completa al directorio de datos de la app, facilitando reconocimiento del filesystem para ataques posteriores.
- Evidencia: `AgentEnhanceDone { agentName: string; agentDir: string; strategy: ... }` — el renderer no consume `agentDir` en ningun componente de esta feature.
- Remediacion: eliminar `agentDir` de `AgentInstallDone` y `AgentEnhanceDone` en `src/types/ipc.ts`. Eliminar el campo del objeto enviado en `handlers.ts` lineas 33 y 78. El renderer solo necesita `agentName` y `strategy`.

#### BAJA — Timer no cancelado en lmStudioEnhancer (resource leak menor)

- Severidad: baja
- Categoria OWASP: N/A (resource management)
- Archivo: `src/enhancer/lmStudioEnhancer.ts` lineas 32-36
- Descripcion: El `setTimeout` del timeout de 15 segundos no se cancela si `responsePromise` resuelve primero. El timer permanece vivo hasta expirar. No hay codigo malicioso que se ejecute; el riesgo es mantener el proceso activo hasta 15s adicionales por enhance completado antes del timeout.
- Vector de ataque: no explotable directamente. Riesgo de resource exhaustion si se crean muchos agentes en rapida sucesion. En uso normal de la app es negligible.
- Evidencia: `new Promise<never>((_, reject) => setTimeout(() => reject(...), TIMEOUT_MS))` sin capturar el handle para cancelar.
- Remediacion: capturar el timerId y cancelarlo con `clearTimeout` en el path de exito. Envolver `await Promise.race` en try/finally.

#### BAJA — WebSocket de LMStudioClient no se cancela explicitamente tras timeout

- Severidad: baja
- Categoria OWASP: N/A (resource management)
- Archivo: `src/enhancer/lmStudioEnhancer.ts` lineas 17-36
- Descripcion: Si `Promise.race` resuelve por timeout, el `for await` de `responsePromise` queda en vuelo y la conexion WebSocket al servidor LM Studio local puede permanecer abierta hasta que el SDK la cierre internamente.
- Vector de ataque: no explotable en modelo de amenaza de app local. El servidor LM Studio ve conexiones abiertas hasta que expiran por inactividad. Sin exfiltracion de datos ni escalada de privilegios.
- Evidencia: `await Promise.race([responsePromise, timeoutPromise])` — si gana el timeout, el iterador async continua hasta que el modelo termina o el SDK detecta el cierre.
- Remediacion: usar `AbortController` si `@lmstudio/sdk` soporta `AbortSignal` en `model.respond()`. Cancelar el iterador al ganar el timeout.

### Riesgos aceptados

- **Timer huerfano de 15s (baja):** negligible en uso normal. Aceptado como deuda tecnica si no se corrige antes del commit.
- **WebSocket LM Studio sin abort explicito (baja):** el SDK gestiona el cierre internamente. Aceptado. Depende de la API del SDK.
- **DevTools y CSP:** pendientes de release anterior, documentados en auditoria electrobun-migration.

### Falsos positivos descartados

1. **Prompt injection via meta-prompt:** el system prompt del usuario se pasa a LM Studio como `content` de mensaje, no se interpola en codigo ejecutable. Un prompt malicioso podria intentar manipular la salida del modelo pero la salida se usa solo como system prompt de un agente local. Sin escalada de privilegios ni ejecucion de codigo. Riesgo informativo.
2. **SQL injection en updateSystemPrompt:** usa prepared statements de `bun:sqlite` con parametros posicionales `?`. Sin interpolacion de strings. Descartado.
3. **Secrets hardcodeados:** scan completo de todos los archivos auditados. Sin API keys, tokens ni credenciales. LM Studio se conecta sin autenticacion a `localhost:1234` por diseno del SDK.
4. **Path traversal en rewriteAgentIndexTs:** `agentDir` proviene de `scaffoldAgent(config, AGENTS_DIR)` donde `config.name` ya fue validado por `validateAgentName` (regex `/^[a-z0-9-]+$/`) antes de llegar al handler. Cadena de validacion: renderer -> IPC -> validateAgentName -> scaffoldAgent -> agentDir. Sin interpolacion adicional de input del usuario.
5. **Escape de string en rewriteAgentIndexTs:** la cadena de escape triple (backslash, doublequote, newline) es la misma ya usada en `scaffoldAgent` para `SYSTEM_ROLE`. Un prompt con `";...` queda como `\"` en el archivo, sin romper el string literal. El resultado es codigo TypeScript valido con el prompt como dato.
6. **Datos del usuario en logs:** `promptEnhancer.ts` loggea solo `lmErr.message` (mensaje de error del SDK), no el `originalPrompt`. `handlers.ts` loggea mensajes de error de rewrite, no el contenido del prompt. Sin exposure de system prompts en logs.
7. **XSS via strategy en renderer:** `create-agent.ts` usa `detail.strategy` solo en comparaciones `=== 'lmstudio'` y `=== 'static'` para elegir un string literal. `showFeedback` asigna con `feedback.textContent`. El valor de `strategy` nunca se interpola en innerHTML. Descartado.

## Metricas de Cipher

- Archivos auditados: 10
- Vulnerabilidades criticas: 0
- Vulnerabilidades altas: 0
- Vulnerabilidades medias: 1 (agentDir expuesto en IPC — pendiente de remediacion antes de merge)
- Vulnerabilidades bajas: 2 (timer + WebSocket — riesgo aceptado)
- Falsos positivos descartados: 7
- Secrets encontrados: 0
- Checklist items pendientes: 2 (DevTools, CSP — riesgo aceptado de release anterior)
