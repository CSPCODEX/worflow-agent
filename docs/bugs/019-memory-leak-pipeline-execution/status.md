# Bug #019 — Memory leak — suscripciones IPC de pipeline-execution nunca se limpian

Estado: RESUELTO
Rama: feature/dev
Fecha apertura: 2026-04-19
Requiere auditoria de Cipher: NO

---

## Info del bug

**Descripcion:** src/renderer/views/pipeline-execution.ts líneas 224-225: las suscripciones a pipelineRunStepUpdated y pipelineRunCompleted nunca tienen unsubscribe. Al navegar fuera de la vista y volver a ejecutar un pipeline, los handlers previos siguen activos, acumulando handlers que procesan mensajes de runs anteriores. Con cada ejecución nueva se acumula un nuevo listener, lo que en sesiones largas puede causar comportamiento errático (múltiples handlers procesando el mismo evento) y leak de memoria.

**Como reproducir:**
1. Ejecutar un pipeline y observar la vista de ejecución
2. Navegar fuera de la vista de ejecución
3. Ejecutar otro pipeline
4. Repetir el proceso 5+ veces
5. Observar comportamiento duplicado en la UI de ejecución (eventos procesados múltiples veces)

**Comportamiento esperado:** La vista limpia sus suscripciones IPC al destruirse o al navegar fuera de ella.

**Comportamiento actual:** Las suscripciones se acumulan indefinidamente sin limpieza, causando comportamiento errático y leak de memoria en sesiones largas.

**Severidad:** ALTA

**Tiene implicaciones de seguridad:** NO

---

## Diagnostico de Max

### Causa raiz confirmada

`renderPipelineExecution` en `src/renderer/views/pipeline-execution.ts` líneas 224-225 realiza dos llamadas `.subscribe(msgHandler)` sin capturar ni invocar el unsubscribe retornado:

```
// pipeline-execution.ts:224-225
(window as any).appRpc?.messages?.pipelineRunStepUpdated?.subscribe(msgHandler);
(window as any).appRpc?.messages?.pipelineRunCompleted?.subscribe(msgHandler);
```

Ambas llamadas descarten el valor de retorno (la funcion de unsubscribe). La funcion `renderPipelineExecution` no retorna nada (`void`), por lo que el caller no tiene mecanismo para limpiar.

### Gap en el caller (app.ts)

`app.ts` línea 59 ya declara `activePipelineExecutionCleanup: (() => void) | null` y la usa correctamente en `teardownCurrentView()` (líneas 146-149). El slot de cleanup esta preparado y conectado a teardown. Sin embargo, `showPipelineExecution()` (línea 310) llama `renderPipelineExecution(...)` sin capturar su retorno ni asignar `activePipelineExecutionCleanup`:

```
// app.ts:310-316 — retorno ignorado, activePipelineExecutionCleanup nunca se asigna
renderPipelineExecution(mainContentEl, {
  pipelineId,
  pipelineName: pipelineInfo.name,
  variables: pipelineInfo.variables,
  onComplete: handleComplete,
  onCancel: handleCancel,
});
```

### Patron correcto de referencia

Tres vistas del mismo proyecto ya implementan el patron correcto:

**settings.ts (lineas 11 y 408-412):**
```typescript
export function renderSettings(container: HTMLElement): { cleanup(): void } {
  // ...
  return {
    cleanup() {
      saveBtn.removeEventListener('click', onSave);
    },
  };
}
```

**agent-preview.ts (lineas 171-179):**
```typescript
function cleanup() {
  if (responseTimeout) clearTimeout(responseTimeout);
  document.removeEventListener('agent:chunk', onChunk);
  document.removeEventListener('agent:end', onEnd);
  if (sessionId) rpc.request.closeSession({ sessionId }).catch(() => {});
}
return { cleanup };
```

**onboarding.ts (lineas 12 y 248-250):**
```typescript
export function renderOnboarding(...): { cleanup(): void } {
  // ...
  return {
    cleanup() {},
  };
}
```

---

## Handoff Max → Cloe

**Archivos a modificar:**

1. `src/renderer/views/pipeline-execution.ts`
2. `src/renderer/app.ts`

**Cambio en pipeline-execution.ts:**

Capturar los unsubscribes en líneas 224-225 y retornar `{ cleanup() }` que los invoque. La firma de la funcion debe cambiar de `void` a `{ cleanup(): void }`:

```typescript
// ANTES (líneas 224-225):
(window as any).appRpc?.messages?.pipelineRunStepUpdated?.subscribe(msgHandler);
(window as any).appRpc?.messages?.pipelineRunCompleted?.subscribe(msgHandler);
// ... sin retorno

// DESPUES — al final de renderPipelineExecution, antes del bloque de startExecution:
const unsubStep = (window as any).appRpc?.messages?.pipelineRunStepUpdated?.subscribe(msgHandler);
const unsubCompleted = (window as any).appRpc?.messages?.pipelineRunCompleted?.subscribe(msgHandler);
// ...
// Al final de la funcion, retornar cleanup:
return {
  cleanup() {
    if (typeof unsubStep === 'function') unsubStep();
    if (typeof unsubCompleted === 'function') unsubCompleted();
  },
};
```

**Cambio en app.ts:**

En `showPipelineExecution()` (línea 310), capturar el retorno y asignarlo a `activePipelineExecutionCleanup`:

```typescript
// ANTES (línea 310):
renderPipelineExecution(mainContentEl, { ... });

// DESPUES:
const handle = renderPipelineExecution(mainContentEl, { ... });
activePipelineExecutionCleanup = handle.cleanup;
```

**Criterios de verificacion para Max:**
1. `renderPipelineExecution` tiene tipo de retorno `{ cleanup(): void }` — evidencia: file:line
2. `unsubStep` y `unsubCompleted` capturan el valor de `.subscribe()` — evidencia: file:line
3. `cleanup()` invoca ambos unsubscribes con guarda `typeof === 'function'` — evidencia: file:line
4. `app.ts showPipelineExecution` asigna el retorno a `activePipelineExecutionCleanup` — evidencia: file:line
5. `teardownCurrentView` en app.ts ya llama `activePipelineExecutionCleanup()` correctamente (sin cambio) — evidencia: app.ts:146-149
6. 0 errores nuevos en `bun run tsc --noEmit`

→ Siguiente: @cloe Implementa el fix del bug #019 siguiendo el handoff anterior. Modifica `src/renderer/views/pipeline-execution.ts` para capturar los unsubscribes y retornar `{ cleanup(): void }`, y `src/renderer/app.ts` para asignar el retorno a `activePipelineExecutionCleanup` en `showPipelineExecution()`.

---

## Metricas de Max (diagnostico inicial)

- archivos_leidos: 4
- bugs_criticos: 0
- bugs_altos: 1 (confirmado — memory leak por suscripciones sin cleanup)
- bugs_medios: 0
- items_checklist_verificados: pendiente de fix
- confianza: alta
- gaps_declarados: 0

---

## Handoff Cloe -> Max

### Cambios implementados

**pipeline-execution.ts:**
- Linea 25: firma cambiada de `void` a `{ cleanup(): void }`
- Lineas 224-225: retorno de `.subscribe()` capturado en `unsubStep` y `unsubCompleted`
- Lineas 335-340: bloque `return { cleanup() { ... } }` anadido al final de la funcion

**app.ts:**
- Lineas 310-317: `renderPipelineExecution(...)` asignado a `const handle`, y `activePipelineExecutionCleanup = handle.cleanup` anadido a continuacion

### Evidencia para criterios de verificacion de Max

1. `renderPipelineExecution` tiene tipo de retorno `{ cleanup(): void }` — `pipeline-execution.ts:25`
2. `unsubStep` y `unsubCompleted` capturan el valor de `.subscribe()` — `pipeline-execution.ts:224-225`
3. `cleanup()` invoca ambos unsubscribes con guarda `typeof === 'function'` — `pipeline-execution.ts:337-338`
4. `app.ts showPipelineExecution` asigna el retorno a `activePipelineExecutionCleanup` — `app.ts:317`
5. `teardownCurrentView` en app.ts llama `activePipelineExecutionCleanup()` sin cambio — `app.ts:146-149`
6. 0 errores nuevos en `bun run tsc --noEmit` (los errores existentes son todos en `scripts/metrics.ts`, preexistentes)

### Checklist Cloe

- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Leo (firma actualizada a `{ cleanup(): void }`)
- [x] bun run tsc --noEmit ejecutado — 0 errores nuevos antes de entregar
- [x] Strings que viajan por IPC son ASCII puro — pipeline-execution.ts 0 chars no-ASCII; cambios en app.ts no introducen chars no-ASCII
- [x] Sin `any` sin justificacion — los `(window as any)` preexistentes no fueron tocados
- [x] No aplica: fire-and-forget, input validation, DB, initDatabase, labels HTML, CSS
- [x] No aplica: vistas nuevas (no se crearon vistas)

### Manifiesto de archivos

| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| src/renderer/views/pipeline-execution.ts | modificado | 25, 224-225, 335-340 |
| src/renderer/app.ts | modificado | 310-317 |

### Gaps y dudas de Cloe

Sin gaps porque: fix de 4 lineas sin nueva logica, siguiendo patron identico a settings.ts y onboarding.ts, tsc limpio (0 errores nuevos), cambios minimos y focalizados.

Confianza en la implementacion: alta

## Metricas de Cloe

- archivos_leidos: 5
- archivos_creados: 0
- archivos_modificados: 2
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Verificacion final de Max

### Checklist Max — bloques activos: ESTATICO | RENDERER

## ESTATICO (siempre obligatorio)
- [x] Cada archivo del manifiesto verificado con file:line — evidencia: pipeline-execution.ts leido completo; app.ts lineas 55-320 leidas
- [x] bun run tsc --noEmit — 0 errores nuevos — evidencia: output sin ninguna linea referenciando pipeline-execution.ts ni app.ts; todos los errores son en scripts/metrics.ts, scripts/verify-monitor.ts, src/db/, src/ipc/acpManager.ts, node_modules/ — todos preexistentes
- [x] Sin logica de negocio rota en los archivos modificados — evidencia: unico cambio es captura de retornos y adicion de bloque return al final; no se altero ningun condicional, flujo de ejecucion, ni handler existente

## RENDERER (cambios en src/renderer/)
- [x] User input usa textContent o escapeHtml, no innerHTML — evidencia: los cambios no tocan ninguna asignacion innerHTML; escapeHtml ya usado en el archivo (importado en linea 3)
- [x] Estados de carga y error manejados en UI — evidencia: no se modificaron estados de carga/error; el fix es exclusivamente en cleanup de suscripciones

### Criterios especificos del bug #019

1. `renderPipelineExecution` tiene tipo de retorno `{ cleanup(): void }` — CONFIRMADO: pipeline-execution.ts:25 `export function renderPipelineExecution(container: HTMLElement, params: PipelineExecutionParams): { cleanup(): void }`
2. `unsubStep` y `unsubCompleted` capturan el valor de `.subscribe()` — CONFIRMADO: pipeline-execution.ts:224 `const unsubStep = (window as any).appRpc?.messages?.pipelineRunStepUpdated?.subscribe(msgHandler)` y :225 `const unsubCompleted = (window as any).appRpc?.messages?.pipelineRunCompleted?.subscribe(msgHandler)`
3. `cleanup()` invoca ambos unsubscribes con guarda `typeof === 'function'` — CONFIRMADO: pipeline-execution.ts:335-340 `return { cleanup() { if (typeof unsubStep === 'function') unsubStep(); if (typeof unsubCompleted === 'function') unsubCompleted(); } }`
4. `app.ts showPipelineExecution` asigna el retorno a `activePipelineExecutionCleanup` — CONFIRMADO: app.ts:310 `const handle = renderPipelineExecution(mainContentEl, { ... })` y :317 `activePipelineExecutionCleanup = handle.cleanup`
5. `teardownCurrentView` llama `activePipelineExecutionCleanup()` correctamente — CONFIRMADO sin cambio: app.ts:146-149 `if (activePipelineExecutionCleanup) { activePipelineExecutionCleanup(); activePipelineExecutionCleanup = null; }`
6. 0 errores nuevos en tsc — CONFIRMADO: ninguna linea de pipeline-execution.ts ni app.ts en el output de tsc

### No verificado por Max

Ninguno.

Confianza en la verificacion: alta

## Metricas de Max (verificacion final)

- archivos_leidos: 4
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 0
- items_checklist_verificados: 5/5
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0
