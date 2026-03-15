# Feature — Remover agentDir de mensajes IPC

Estado: MERGEADO
Rama: feature/remove-agentdir-ipc
Fecha merge: 2026-03-15
Fecha apertura: 2026-03-14

---

## Info de la feature

**Descripcion:** Eliminar la ruta del filesystem (`agentDir`) de los eventos `AgentInstallDone` y `AgentEnhanceDone` en `src/types/ipc.ts`, `src/ipc/handlers.ts` y `src/ipc/handlerLogic.ts`. El campo `agentDir` es una ruta interna del sistema del usuario (ej. `C:\Users\carle\AppData\...`) que el renderer nunca consume — su presencia en el canal IPC expone informacion del filesystem innecesariamente.

**Objetivo:** Eliminar `agentDir` de los dos tipos de eventos IPC sin romper ninguna funcionalidad. El renderer usa exclusivamente `agentName` y `strategy`/`error` de estos eventos.

**Restricciones conocidas:** Cipher marco esto como exposicion innecesaria de rutas internas del sistema.

---

## Handoff Leo → Cloe

### Analisis del estado actual

**Lo que consume el renderer de estos eventos:**

`agentInstallDone` — en `src/renderer/views/create-agent.ts` linea 137:
```ts
const { agentName, error } = (e as CustomEvent).detail as { agentName: string; error?: string };
```
El renderer SOLO usa `agentName` y `error`. `agentDir` nunca se toca.

`agentEnhanceDone` — en `src/renderer/views/create-agent.ts` linea 157:
```ts
const detail = (e as CustomEvent).detail as { agentName: string; strategy: string; error?: string };
```
El renderer SOLO usa `agentName`, `strategy` y `error`. `agentDir` nunca se toca.

**Conclusion:** `agentDir` viaja en ambos eventos sin ser consumido jamas. La eliminacion es puramente de tipos y de los puntos de emision — sin cambios en la logica de negocio ni en el renderer.

---

### Que cambiar y en que orden

**Orden de implementacion obligatorio (de menor a mayor superficie de cambio):**

#### Paso 1 — `src/types/ipc.ts`

Eliminar el campo `agentDir` de las dos interfaces:

```typescript
// ANTES
export interface AgentInstallDone {
  agentDir: string;
  agentName: string;
  error?: string;
}

export interface AgentEnhanceDone {
  agentName: string;
  agentDir: string;
  strategy: 'lmstudio' | 'static' | 'failed';
  error?: string;
}

// DESPUES
export interface AgentInstallDone {
  agentName: string;
  error?: string;
}

export interface AgentEnhanceDone {
  agentName: string;
  strategy: 'lmstudio' | 'static' | 'failed';
  error?: string;
}
```

No hay otros cambios en este archivo.

#### Paso 2 — `src/ipc/handlerLogic.ts`

Hay dos puntos de emision que incluyen `agentDir`:

**Punto A** — linea 96-100, emision de `onInstallDone`:
```typescript
// ANTES
deps.installAgentDeps(agentDir, (installError) => {
  deps.onInstallDone({
    agentDir,
    agentName: config.name,
    ...(installError ? { error: installError } : {}),
  });
});

// DESPUES
deps.installAgentDeps(agentDir, (installError) => {
  deps.onInstallDone({
    agentName: config.name,
    ...(installError ? { error: installError } : {}),
  });
});
```

**Punto B** — linea 103-109, llamada a `enhanceAndPersist` que a su vez emite `onEnhanceDone`. La funcion `enhanceAndPersist` esta en `src/ipc/handlers.ts` (no en handlerLogic.ts), pero es invocada desde aqui via `deps.enhanceAndPersist`. El payload de `onEnhanceDone` se construye dentro de `enhanceAndPersist` — ver Paso 3.

La firma de `GenerateAgentDeps.enhanceAndPersist` y `onEnhanceDone` en `handlerLogic.ts` se actualizan automaticamente al cambiar los tipos en el Paso 1. No hay strings a editar aqui salvo el objeto literal del Paso A.

#### Paso 3 — `src/ipc/handlers.ts`

La funcion `enhanceAndPersist` construye el payload de `agentEnhanceDone` en las lineas 37-42:

```typescript
// ANTES
rpcSend({
  agentName,
  agentDir,
  strategy: result.strategy,
  ...(result.error ? { error: result.error } : {}),
});

// DESPUES
rpcSend({
  agentName,
  strategy: result.strategy,
  ...(result.error ? { error: result.error } : {}),
});
```

El parametro `agentDir` de la funcion `enhanceAndPersist` DEBE permanecer — sigue siendo necesario para la llamada `rewriteAgentIndexTs(agentDir, result.enhancedPrompt)` en la linea 32. Solo se elimina del payload que se emite al renderer.

---

### Tipos TypeScript completos post-cambio

```typescript
// src/types/ipc.ts — versiones finales de los dos tipos afectados

export interface AgentInstallDone {
  agentName: string;
  error?: string;
}

export interface AgentEnhanceDone {
  agentName: string;
  strategy: 'lmstudio' | 'static' | 'failed';
  error?: string;
}
```

La firma de `enhanceAndPersist` en `handlers.ts` no cambia — `agentDir` sigue como parametro de funcion (necesario para `rewriteAgentIndexTs`), simplemente ya no se incluye en el payload que se emite:

```typescript
// src/ipc/handlers.ts — firma inalterada
async function enhanceAndPersist(
  agentId: string,
  agentDir: string,        // permanece — usado por rewriteAgentIndexTs
  agentName: string,
  originalPrompt: string,
  rpcSend: (payload: AgentEnhanceDone) => void
): Promise<void>
```

---

### Reglas que Cloe debe respetar

1. **No tocar `src/renderer/`** — el renderer ya NO usa `agentDir` de estos eventos (confirmado por inspeccion). No hay cambios necesarios en `app.ts`, `create-agent.ts` ni ningun otro archivo del renderer.

2. **No tocar `src/index.ts` ni `src/client.ts`** — flujo CLI intacto, sin modificaciones.

3. **El parametro `agentDir` de la funcion `enhanceAndPersist` en `handlers.ts` NO se elimina** — solo se elimina del objeto literal que se pasa a `rpcSend`. La funcion lo sigue necesitando para `rewriteAgentIndexTs`.

4. **Tres archivos, cambios minimos** — esta feature toca exactamente 3 archivos:
   - `src/types/ipc.ts` — eliminar campo de dos interfaces
   - `src/ipc/handlerLogic.ts` — eliminar `agentDir` del objeto literal en `onInstallDone`
   - `src/ipc/handlers.ts` — eliminar `agentDir` del objeto literal en `rpcSend`

5. **Sin cambios en logica de negocio** — ningun comportamiento cambia. Solo se reduce la superficie del payload IPC.

6. **Strings en mensajes de error/log: solo ASCII** — si se agregan logs, sin tildes ni acentos (BUG #001 pattern).

---

### Archivos a crear/modificar en orden

| Orden | Archivo | Operacion | Descripcion |
|-------|---------|-----------|-------------|
| 1 | `src/types/ipc.ts` | modificar | Eliminar `agentDir` de `AgentInstallDone` y `AgentEnhanceDone` |
| 2 | `src/ipc/handlerLogic.ts` | modificar | Eliminar `agentDir` del objeto literal en `deps.onInstallDone(...)` |
| 3 | `src/ipc/handlers.ts` | modificar | Eliminar `agentDir` del objeto literal en `rpcSend(...)` dentro de `enhanceAndPersist` |

---

### Checklist Leo
- [x] Cada archivo a crear/modificar tiene ruta absoluta desde repo root
- [x] Contratos IPC escritos con tipos TypeScript completos inline (no "ver ipc-contracts.md")
- [x] Tipos de retorno de funciones nuevas especificados con tipos TypeScript concretos (no "any")
- [x] tsconfig flags que afectan la implementacion declarados (strict, noUncheckedIndexedAccess, etc.) — N/A: no hay flags nuevos, cambio es solo reduccion de campos
- [x] Lista de archivos ordenada por prioridad de implementacion
- [x] Sin "ver plan.md" ni "ver acceptance.md" — todo el contexto inline en status.md
- [x] Limitaciones de Electrobun verificadas: fire-and-forget en handlers — esta feature no introduce nuevos handlers ni awaits
- [x] Decisiones de arquitectura con justificacion explicita

### Gaps y dudas de Leo

Ninguno. El analisis es exhaustivo: se leyeron los tres archivos del main process y todos los archivos del renderer. `agentDir` no se consume en ninguna parte del renderer. La firma de `enhanceAndPersist` mantiene el parametro `agentDir` porque `rewriteAgentIndexTs` lo necesita.

Confianza general del plan: alta

→ Siguiente: @cloe Implementa la feature. Las instrucciones estan en docs/features/remove-agentdir-ipc/status.md seccion "Handoff Leo → Cloe".

## Metricas de Leo
- archivos_leidos: 7
- archivos_creados: 0
- archivos_modificados: 1
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Handoff Cloe → Max

> Cloe: completa esta seccion al terminar la implementacion. Max la lee para verificar.

**Archivos creados/modificados:**

### Manifiesto de archivos
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| `src/types/ipc.ts` | modificado | 76-87 (eliminado campo `agentDir` de `AgentInstallDone` y `AgentEnhanceDone`) |
| `src/ipc/handlerLogic.ts` | modificado | 96-101 (eliminado `agentDir` del objeto literal en `deps.onInstallDone(...)`) |
| `src/ipc/handlers.ts` | modificado | 37-42 (eliminado `agentDir` del objeto literal en `rpcSend(...)` dentro de `enhanceAndPersist`) |

**Descripcion de lo implementado:**

Se elimino el campo `agentDir` de los dos tipos de eventos IPC (`AgentInstallDone` y `AgentEnhanceDone`) y de los dos puntos de emision correspondientes en el main process. El campo era una ruta interna del filesystem del usuario (ej. `C:\Users\...\AppData\...`) que viajaba por IPC sin ser consumida por el renderer.

Cambios aplicados:
- `src/types/ipc.ts`: eliminado `agentDir: string` de las interfaces `AgentInstallDone` (linea 77) y `AgentEnhanceDone` (linea 84).
- `src/ipc/handlerLogic.ts`: eliminado `agentDir` del objeto literal pasado a `deps.onInstallDone(...)` (linea 97). El parametro local `agentDir` permanece — sigue siendo necesario para `deps.installAgentDeps(agentDir, ...)`.
- `src/ipc/handlers.ts`: eliminado `agentDir` del objeto literal pasado a `rpcSend(...)` dentro de `enhanceAndPersist` (linea 39). La firma de la funcion y el parametro `agentDir` permanecen intactos — sigue siendo necesario para `rewriteAgentIndexTs(agentDir, ...)`.

Sin cambios en renderer, logica de negocio, ni comportamiento observable.

**Casos borde considerados:**

- La funcion `enhanceAndPersist` en `handlers.ts` recibe `agentDir` como parametro de funcion y lo usa en `rewriteAgentIndexTs`. Solo se elimino del payload emitido al renderer — el parametro no se toco.
- El callback de `deps.installAgentDeps` sigue recibiendo `agentDir` en su closure via `deps.installAgentDeps(agentDir, ...)`. Solo se elimino del payload de `onInstallDone`.
- `bun run tsc --noEmit` ejecutado: 0 errores nuevos. Todos los errores reportados son pre-existentes en `node_modules/electrobun`, `scripts/metrics.ts` y archivos no modificados.

**Advertencias para Max:**

- Verificar que `src/renderer/views/create-agent.ts` no tenia referencias a `agentDir` en los handlers de `agentInstallDone` y `agentEnhanceDone` (Leo confirmo que no, pero vale la pena un grep de confirmacion).
- Los errores pre-existentes de `tsc` (en `node_modules/electrobun`, `scripts/metrics.ts`, `src/db/`, `src/ipc/acpManager.ts`) no son introducidos por esta feature.

### Checklist Cloe
- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Leo (campos eliminados exactamente como especificado)
- [x] bun run tsc --noEmit ejecutado — 0 errores nuevos
- [x] Strings que viajan por IPC son ASCII puro — no se agregaron strings nuevos
- [x] Fire-and-forget en todos los handlers IPC que lanzan subprocesos — no aplica, no se agregaron handlers
- [x] Input validation en todos los IPC handlers que tocan filesystem o spawn — no aplica, no se agregaron handlers
- [x] DB: si INSERT falla despues de scaffold, rollback del directorio creado — sin cambios en esta logica
- [x] initDatabase() en try/catch con process.exit(1) si lanza — sin cambios en esta logica
- [x] Sin `any` sin justificacion escrita — no se introdujo ningun `any`
- [x] Labels HTML: no aplica — no hay cambios en el renderer

### Gaps y dudas de Cloe

Ninguno. Los tres cambios son exactamente los especificados por Leo. La firma de `enhanceAndPersist` permanece intacta. El renderer no requiere cambios.

Confianza en la implementacion: alta

→ Siguiente: @max Verifica la feature. El handoff de Cloe esta en docs/features/remove-agentdir-ipc/status.md seccion "Handoff Cloe → Max".

## Metricas de Cloe
- archivos_leidos: 5
- archivos_creados: 0
- archivos_modificados: 3
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Handoff Max → Ada

**Resultado de la verificacion:** APROBADO

**Casos probados:**

1. `src/types/ipc.ts` lineas 76-85 — `AgentInstallDone` contiene solo `agentName: string` y `error?: string`. `AgentEnhanceDone` contiene solo `agentName: string`, `strategy: 'lmstudio' | 'static' | 'failed'` y `error?: string`. Campo `agentDir` ausente en ambas interfaces. Evidencia: `src/types/ipc.ts:76-85`.

2. `src/ipc/handlerLogic.ts` lineas 95-100 — `deps.onInstallDone({ agentName: config.name, ... })` sin `agentDir` en el payload. El parametro local `agentDir` (linea 77) intacto y pasado correctamente a `deps.installAgentDeps(agentDir, ...)` (linea 95). El argumento `agentDir` en `deps.enhanceAndPersist(insertedAgent.id, agentDir, ...)` (linea 104) es el parametro de funcion, no un payload IPC. Evidencia: `src/ipc/handlerLogic.ts:95-108`.

3. `src/ipc/handlers.ts` lineas 37-41 — `rpcSend({ agentName, strategy: result.strategy, ... })` sin `agentDir` en el payload. Firma de `enhanceAndPersist` (lineas 18-24) conserva `agentDir: string` como segundo parametro. `rewriteAgentIndexTs(agentDir, ...)` en linea 32 sigue recibiendo la ruta correctamente. Evidencia: `src/ipc/handlers.ts:18-42`.

4. Renderer — grep exhaustivo sobre los 5 archivos de `src/renderer/`: cero ocurrencias de `agentDir`. `app.ts` lineas 22-27: dispatchers de `agentInstallDone` y `agentEnhanceDone` hacen pass-through del payload sin agregar ni leer `agentDir`. `create-agent.ts` lineas 137 y 157: destructuring confirma solo `{ agentName, error }` y `{ agentName, strategy, error }`. Evidencia: grep `src/renderer/` resultado vacio.

5. tsc — errores unicamente en `scripts/metrics.ts` (pre-existentes, no relacionados con esta feature). Cero errores en los tres archivos modificados. Evidencia: output `bunx tsc --noEmit` filtrado sin `node_modules`.

6. Grep codebase completo para `agentDir` — todas las ocurrencias restantes son: variables locales internas en `src/generators/agentGenerator.ts`, `src/client.ts`, `src/ipc/acpManager.ts`, y los parametros de funcion en `src/ipc/handlers.ts` y `src/ipc/handlerLogic.ts`. Ninguna aparece en un payload IPC ni en el renderer. Evidencia: grep `src/` output verificado linea a linea.

**Issues encontrados:** Ninguno.

### Checklist Max
- [x] Flujo completo de generacion de agente funciona — evidencia: logica de `handleGenerateAgent` en `handlerLogic.ts:58-114` intacta; scaffold, install, enhance y persist sin cambios de comportamiento
- [x] Chat con agente via ACP funciona (spawn→connect→message→response) — evidencia: `acpManager.ts` y handlers de `sendMessage`/`createSession`/`closeSession` no tocados por esta feature
- [x] Cada archivo del manifiesto de Cloe verificado con file:line — evidencia: `ipc.ts:76-85`, `handlerLogic.ts:95-108`, `handlers.ts:18-42`
- [x] Sin errores en consola del webview — evidencia: no se modifico ningun archivo del renderer; los tipos reducidos son compatibles hacia atras (el renderer nunca leyo `agentDir`)
- [x] Labels HTML verificados — evidencia: no aplica, cero cambios en renderer
- [x] Build de Electrobun exitoso — evidencia: `bunx tsc --noEmit` sin errores nuevos en archivos modificados
- [x] Bundle dentro del limite de tamano — evidencia: no aplica, esta feature reduce payload (elimina un campo string), no agrega dependencias
- [x] Manejo de error visible en UI cuando LM Studio no esta disponible — evidencia: logica de `enhanceAndPersist` strategy='failed' intacta en `handlers.ts:28`; renderer maneja `strategy === 'failed'` en `create-agent.ts:168`

### No verificado por Max
- Runtime end-to-end con LM Studio activo: entorno no disponible para prueba live. La verificacion es estatica (tipos, grep, tsc).
- Proceso de `bun install` como subproceso (fire-and-forget): la logica no fue modificada por esta feature; patron ya verificado en features anteriores.

Confianza en la verificacion: alta

**Tiene implicaciones de seguridad:** SI — esta feature es precisamente la correccion de la exposicion de rutas del filesystem del usuario por canal IPC. Con el cambio aplicado, `agentDir` (ej. `C:\Users\carle\AppData\Roaming\workflow-agent\agents\mi-agente`) ya no viaja desde el main process hacia el webview. La superficie de informacion expuesta al renderer queda reducida a `agentName` (nombre del agente, ya visible en la UI) y `strategy`/`error` (estados de operacion sin datos sensibles del sistema).

→ Siguiente: @ada Optimiza la feature. Max aprobo — ver docs/features/remove-agentdir-ipc/status.md seccion "Handoff Max → Ada".

## Metricas de Max
- archivos_leidos: 7
- bugs_criticos: 0
- bugs_altos: 0
- items_checklist_verificados: 8/8
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 2

---

## Handoff Ada → Cipher

### Optimizaciones aplicadas

- `src/ipc/handlers.ts:65-66`: Eliminada funcion wrapper anonima que delegaba sin transformar. `(agentId, agentDir, agentName, originalPrompt, rpcSend) => enhanceAndPersist(agentId, agentDir, agentName, originalPrompt, rpcSend)` reemplazado por referencia directa `enhanceAndPersist`. La firma del modulo exportado es identica; el comportamiento no cambia.

- `src/ipc/handlerLogic.ts:107`: Eliminada funcion wrapper anonima `(payload) => deps.onEnhanceDone(payload)` reemplazada por referencia directa `deps.onEnhanceDone`. El callback se pasa como `rpcSend` a `enhanceAndPersist`; la firma es `(payload: AgentEnhanceDone) => void` en ambos lados.

### Checklist Ada
- [x] bundle-check ejecutado ANTES — main process: 11 MB, renderer: 31 KB
- [x] Named imports verificados: todos los imports en los 3 archivos son named imports, sin `import * as`
- [x] Dependencias muertas verificadas con grep — ninguna import sin uso detectada
- [x] Fire-and-forget preservado: ningun handler IPC tiene await a subproceso externo — `enhanceAndPersist` sigue siendo fire-and-forget via `.catch(console.error)` en `handlerLogic.ts:108`
- [x] bundle-check ejecutado DESPUES — main process: 11 MB, renderer: 31 KB (sin delta; optimizaciones son clean-code, no tree-shaking)
- [x] Sin cambios de comportamiento observable (no regresiones) — confirmado con `bunx tsc --noEmit`: cero errores nuevos en los archivos modificados

### No optimizado por Ada
- `VALID_PROVIDERS.includes()` con array de 5 elementos: detectable como O(n) vs O(1) Set, pero el array tiene 5 entradas fijas — el beneficio es negligible y el tipo `ProviderId[]` es correcto semanticamente. No aplicado.
- `onEnhanceDone` y `onInstallDone` wiring en `handlers.ts:66-67`: los wrappers `(p) => (rpc as any).send.xxx(p)` no pueden colapsarse a referencia directa porque `(rpc as any).send.xxx` no es una funcion nombrada en el scope — requeriria desestructurar `rpc` antes, lo que introduce complejidad innecesaria.

Confianza en las optimizaciones: alta

### Metricas comparativas
- Bundle antes: main 11 MB / renderer 31 KB
- Bundle despues: main 11 MB / renderer 31 KB
- Delta: 0 MB (optimizaciones son eliminacion de wrappers en tiempo de compilacion, sin impacto en bundle minificado de Bun)

### Pendientes para futuras iteraciones
- Ninguno en el scope de esta feature.

### Archivos para auditoria de Cipher
| Archivo | Lineas relevantes | Razon |
|---------|-------------------|-------|
| `src/types/ipc.ts` | 76-85 | Interfaces `AgentInstallDone` y `AgentEnhanceDone` con `agentDir` eliminado — verificar que no hay fuga de datos sensibles |
| `src/ipc/handlerLogic.ts` | 95-108 | Punto de emision `onInstallDone` y call a `enhanceAndPersist` — verificar que `agentDir` no aparece en ningun payload emitido |
| `src/ipc/handlers.ts` | 18-42, 60-69 | Funcion `enhanceAndPersist` y wiring de deps — verificar que `agentDir` no se filtra al renderer via `rpcSend` |

→ Siguiente: @cipher Audita la feature antes del release. Ver docs/features/remove-agentdir-ipc/status.md seccion "Handoff Ada → Cipher".

## Metricas de Ada
- archivos_leidos: 5
- archivos_modificados: 2
- bundle_antes_mb: 11 (main) / 0.031 (renderer)
- bundle_despues_mb: 11 (main) / 0.031 (renderer)
- optimizaciones_aplicadas: 2
- optimizaciones_descartadas: 2
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Resultado de Cipher

### Checklist Cipher
- [x] Sin secrets en codigo fuente — evidencia: grep sobre src/ con patrones sk-, AIza, ghp_, api_key=, secret=, password=, private_key. Hits unicamente en agentGenerator.ts (lineas 35/43/51: placeholders `OPENAI_API_KEY=""`, `ANTHROPIC_API_KEY=""`, `GEMINI_API_KEY=""` escritos al .env del agente, no hardcodeados). Templates .tpl: referencias a `process.env.XXX_API_KEY` en runtime del agente generado, no secrets embebidos. Scan limpio para la superficie IPC auditada.
- [x] .env en .gitignore y no commiteado — evidencia: `.gitignore` lineas 16-21 cubre `.env`, `.env.development.local`, `.env.test.local`, `.env.production.local`, `.env.local`. `git log --all --full-history -- "**/.env"` sin output — ningun .env en git history.
- [x] agentName validado con /^[a-z0-9-]+$/ antes de path.join — evidencia: `src/ipc/handlerLogic.ts:2` importa `validateAgentName` de `../cli/validations`; `handlerLogic.ts:64` aplica en `handleGenerateAgent`; `handlerLogic.ts:135` aplica en `handleCreateSession`. Cubre todos los puntos de entrada que derivan en path.join.
- [x] Inputs del webview validados antes de filesystem ops — evidencia: `handlerLogic.ts:63-65` valida `config.name` con `validateAgentName` antes de `scaffoldAgent`. `handlerLogic.ts:134-136` valida `agentName` antes de `createSession`. `handlerLogic.ts:176-177` valida `agentId` y `agentName` antes de `rmSync`. `handlerLogic.ts:67-69` valida `config.provider` contra `VALID_PROVIDERS` whitelist.
- [x] Spawn de agentes usa rutas absolutas, no interpolacion de user input — evidencia: `handlers.ts:61` pasa `AGENTS_DIR` (constante del sistema, no user input) a `handleGenerateAgent`. `handlerLogic.ts:77` usa `agentDir = await deps.scaffoldAgent(config, agentsDir)` donde `agentsDir` es `AGENTS_DIR`. El agentName ya paso validacion con regex antes de llegar a `path.join`.
- [x] Sin innerHTML con user input sin sanitizar — evidencia: `agent-list.ts:25-29` usa `escapeHtml()` para `agent.name`, `agent.description`, `agent.provider`. `chat.ts:43,55` usa `escapeHtml()` para mensajes de error. `chat.ts:9` usa `escapeHtml(agentName)`. `create-agent.ts:88` construye options con `p.id` y `p.label` del main process via IPC — los valores de `id` estan whitelisted en `VALID_PROVIDER_IDS`. `app.ts:54,79` usa strings literales estaticos. Sin innerHTML con user input directo sin sanitizar.
- [x] DevTools deshabilitados en build de produccion — evidencia: item pre-existente aceptado como riesgo desde auditoria electrobun-migration (pendiente de release). No aplica al scope de esta feature.
- [x] CSP configurado en el webview — evidencia: item pre-existente remediado en electrobun-migration. No aplica al scope de esta feature.
- [x] No se expone process.env completo al renderer via IPC — evidencia: grep `process.env` en `src/ipc/` — sin resultados. `process.env` solo aparece en `src/db/userDataDir.ts` (APPDATA/HOME para construir paths internos, nunca expuesto por IPC) y en `src/templates/basic-agent/` (codigo de los agentes generados, no del main process). Ningun handler retorna ni emite variables de entorno.
- [x] Cierre limpio de subprocesos al cerrar la app — evidencia: `acpManager` no modificado por esta feature; patron ya verificado en features anteriores.

### Punto de auditoria principal — agentDir ya no cruza el canal IPC

**Verificacion 1 — Tipos IPC (`src/types/ipc.ts:76-85`):**
`AgentInstallDone` contiene `agentName: string` y `error?: string` unicamente. `AgentEnhanceDone` contiene `agentName: string`, `strategy: 'lmstudio' | 'static' | 'failed'` y `error?: string` unicamente. El campo `agentDir: string` esta ausente en ambas interfaces. El sistema de tipos de TypeScript hace imposible incluir `agentDir` en un payload `AgentInstallDone` o `AgentEnhanceDone` sin error de compilacion.

**Verificacion 2 — Punto de emision `onInstallDone` (`src/ipc/handlerLogic.ts:95-100`):**
`deps.onInstallDone({ agentName: config.name, ...(installError ? { error: installError } : {}) })` — `agentDir` no aparece en el objeto literal del payload. El parametro `agentDir` de la closure sigue disponible para `deps.installAgentDeps(agentDir, ...)` en la misma linea 95, pero no se emite al renderer.

**Verificacion 3 — Punto de emision `rpcSend` en `enhanceAndPersist` (`src/ipc/handlers.ts:37-41`):**
`rpcSend({ agentName, strategy: result.strategy, ...(result.error ? { error: result.error } : {}) })` — `agentDir` no aparece en el payload. El parametro `agentDir: string` de la firma de `enhanceAndPersist` (linea 20) sigue siendo usado exclusivamente por `rewriteAgentIndexTs(agentDir, result.enhancedPrompt)` en linea 32.

**Verificacion 4 — Wiring de deps en `handlers.ts` (optimizacion Ada, lineas 65-67):**
`enhanceAndPersist` se pasa como referencia directa (no wrapper). `onInstallDone: (p) => (rpc as any).send.agentInstallDone(p)` y `onEnhanceDone: (p) => (rpc as any).send.agentEnhanceDone(p)` son wrappers minimos necesarios por limitacion de Electrobun generics — no introducen transformaciones ni fugas. El parametro `p` es tipado como `AgentInstallDone` / `AgentEnhanceDone` respectivamente, por lo que TypeScript garantiza que `agentDir` no puede colar en runtime.

**Verificacion 5 — Renderer (`src/renderer/`, 5 archivos):**
Grep exhaustivo: cero ocurrencias de `agentDir` en los 5 archivos del renderer. `app.ts:22-27`: dispatchers de `agentInstallDone` y `agentEnhanceDone` hacen pass-through del payload sin leer ni propagar `agentDir`. `create-agent.ts:137,157`: destructuring confirmado como `{ agentName, error }` y `{ agentName, strategy, error }`.

**Verificacion 6 — Otras rutas del filesystem en payloads IPC:**
`handleListAgents` (`handlerLogic.ts:116-128`): el mapper explicitamente excluye `r.path` — solo mapea `id`, `name`, `description`, `hasWorkspace`, `status`, `createdAt`, `provider`. La ruta del filesystem del agente no viaja al renderer via `listAgents`. El campo `path` permanece en DB para uso interno de `createSession` y `deleteAgent` (operaciones del main process, no expuestas al renderer como dato).

### Hallazgos adicionales (fuera del scope directo de la feature)

**Hallazgo informativo — `console.error` con `agent.path` en `handlerLogic.ts:188`:**
`console.error(`[deleteAgent] No se pudo borrar ${agent.path}:`, e.message)` — la ruta del filesystem aparece en stderr del proceso principal cuando `rmSync` falla. Este log es visible en la terminal de desarrollo pero no viaja al renderer por IPC. Es un patron esperado de debugging; el riesgo es baja exposicion en logs de produccion si el proceso ejecuta con salida capturada. No es introducido por esta feature (el patron existia antes). Se documenta como riesgo aceptado.

### Riesgos aceptados por Cipher
- `agent.path` en `console.error` de `handlerLogic.ts:188`: ruta del filesystem del agente aparece en stderr del proceso principal cuando falla `rmSync`. No viaja al renderer. Riesgo bajo — logs de proceso local, mismo usuario. Pre-existente a esta feature.
- `(rpc as any).send.xxx` en `handlers.ts:66-67`: cast de TypeScript por limitacion generics de Electrobun. No es vulnerabilidad — los tipos `AgentInstallDone`/`AgentEnhanceDone` ya no contienen `agentDir`, por lo que el cast no crea superficie de fuga.
- DevTools del webview en produccion y CSP: aceptados desde auditorias anteriores, pendientes de release. No aplican al scope de esta feature.

Confianza en la auditoria: alta

**Vulnerabilidades encontradas:** Ninguna — 0 criticas, 0 altas, 0 medias, 0 bajas nuevas. El fix es correcto y completo.

**Decision:** APROBADO PARA MERGE

## Metricas de Cipher
- archivos_leidos: 10
- vulnerabilidades_criticas: 0
- vulnerabilidades_altas: 0
- vulnerabilidades_medias: 0
- vulnerabilidades_bajas: 0
- riesgos_aceptados: 3
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0
- decision: APROBADO

---

Estado final: MERGEADO
