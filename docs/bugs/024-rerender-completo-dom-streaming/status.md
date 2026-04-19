# Bug #024 — Re-render completo del DOM en cada chunk de streaming del pipeline

Estado: RESUELTO
Rama: bug/024-rerender-completo-dom-streaming
Fecha apertura: 2026-04-19
Fecha cierre: 2026-04-19

---

## Info del bug

**Descripcion:** src/renderer/views/pipeline-execution.ts líneas 79 y 299-301: en el handler de pipelineRunStepUpdated se llama renderSteps() completo, que destruye y re-crea toda la lista de pasos en el DOM en cada chunk de streaming. Para un pipeline de 5 pasos con 100 chunks por paso = 500 re-renders del DOM completo por ejecución. Además, params.onComplete(result.runId) se llama en línea 79 inmediatamente tras obtener el runId, sin esperar a que el pipeline termine — navega a resultados prematuramente.

**Como reproducir:**
1. Ejecutar un pipeline con múltiples pasos y respuestas largas
2. Observar parpadeos y re-renderizado completo de la lista durante el streaming
3. Observar que la navegación a resultados ocurre prematuramente (antes de terminar)

**Comportamiento esperado:** Solo se actualiza en el DOM el paso activo en cada chunk. La navegación a resultados ocurre únicamente cuando el pipeline completa con status='completed'.

**Comportamiento actual:** Se re-renderiza toda la lista de pasos en cada chunk de streaming (500 re-renders para 5 pasos x 100 chunks). La navegación ocurre prematuramente al obtener el runId.

**Severidad:** MEDIA

**Tiene implicaciones de seguridad:** NO

---

## Diagnostico Max

### Hallazgo 1 — renderSteps() completo en cada chunk de streaming

**Evidencia:** `src/renderer/views/pipeline-execution.ts:300`

```
function handleStepUpdated(msg: PipelineRunStepUpdated) {
  // ... actualiza stepStates[stepIndex] ...
  if (msg.output !== undefined) {
    stepStates[stepIndex].output += msg.output;   // linea 297
  }
  renderSteps();   // linea 300 — destruye y re-crea TODO el DOM
}
```

`renderSteps()` (linea 100) hace `stepsListEl.innerHTML = ''` seguido de un `forEach` que crea todos los `div.pipeline-execution-step` de nuevo. Con 5 pasos y 100 chunks = 500 destrucciones/recreaciones del DOM completo.

**Selector disponible:** El `stepEl` en `renderSteps()` (linea 106) asigna `stepEl.dataset.stepIndex = String(index)`. Por lo tanto el selector `[data-step-index="N"]` ya existe en el DOM y es usable para actualizacion quirurgica.

**Nota critica:** El atributo `data-step-index` en la linea 150 existe en el boton de retry (`.btn-retry-step`), NO en el contenedor del paso. El contenedor del paso tiene el dataset en `stepEl.dataset.stepIndex` (linea 106). El selector correcto es `stepsListEl.querySelector('[data-step-index="N"]')`, NO `document.querySelector(...)` — usar `stepsListEl` como contexto para evitar colisiones si hubiera multiples instancias del componente.

**ID auxiliar disponible:** El output content tiene `id="pe-step-output-${index}"` (linea 123) y el contenido interno tiene `id="pe-step-content-${index}"` (lineas 141 y 159). Estos IDs permiten actualizar solo el texto del output y el estado del icono/label sin reconstruir el contenedor del paso.

### Hallazgo 2 — params.onComplete llamado prematuramente

**Evidencia:** `src/renderer/views/pipeline-execution.ts:79`

```
currentRunId = result.runId;
isRunning = true;
// ...
params.onComplete(result.runId);   // linea 79 — se llama ANTES del primer chunk
```

`params.onComplete` se invoca inmediatamente despues de obtener el `runId` del IPC, cuando el pipeline apenas acaba de iniciar. El handler `handleRunCompleted` (linea 303) existe pero nunca llama a `params.onComplete`. El caso `status='completed'` en `handleRunCompleted` solo oculta el boton de stop — no navega a resultados.

### Hallazgo 3 — handleRunCompleted no navega a resultados en el caso exitoso

**Evidencia:** `src/renderer/views/pipeline-execution.ts:303-318`

```
function handleRunCompleted(msg: PipelineRunCompleted) {
  if (!currentRunId) return;
  isRunning = false;
  stopBtn.style.display = 'none';

  if (msg.status === 'failed') {     // solo maneja el caso de fallo
    stepStates.forEach((s) => { ... });
    renderSteps();
  }
  // caso 'completed': no hace nada — params.onComplete nunca se llama aqui
}
```

El caso `status='completed'` en `handleRunCompleted` no existe — no hay `else if (msg.status === 'completed')`. La navegacion a resultados depende exclusivamente de la llamada prematura en linea 79.

---

## Handoff Max → Cloe

**Archivo unico a modificar:** `src/renderer/views/pipeline-execution.ts`

**Cambio 1 — Eliminar params.onComplete de startExecution (linea 79)**

Eliminar la linea 79 completa:
```
params.onComplete(result.runId);
```

No debe quedar ninguna llamada a `params.onComplete` dentro de `startExecution`.

**Cambio 2 — Anadir navegacion en handleRunCompleted para status='completed'**

En `handleRunCompleted` (actualmente lineas 303-318), anadir el caso exitoso despues del bloque `if (msg.status === 'failed')`:

```typescript
if (msg.status === 'completed') {
  params.onComplete(currentRunId);
}
```

La variable `currentRunId` es accesible en el closure y tiene el valor correcto en ese punto. No se necesita el runId del mensaje porque `currentRunId` ya es el mismo.

**Cambio 3 — Reemplazar renderSteps() en handleStepUpdated por actualizacion quirurgica**

Reemplazar la llamada a `renderSteps()` en la linea 300 por una funcion nueva `updateStepElement(stepIndex)`. La funcion debe:

1. Obtener el elemento del paso: `stepsListEl.querySelector<HTMLDivElement>('[data-step-index="' + stepIndex + '"]')`
2. Si el elemento no existe, llamar `renderSteps()` como fallback (primer render o reintento).
3. Si el elemento existe, actualizar solo:
   - La clase CSS del contenedor: `stepEl.className = 'pipeline-execution-step pipeline-execution-step-' + step.status`
   - El icono de estado: `stepEl.querySelector('.pipeline-execution-step-status')!.innerHTML = statusIconHtml + statusLabelHtml`
   - El contenido del output: el `div` con id `pe-step-output-${stepIndex}` via `stepsListEl.querySelector('#pe-step-output-' + stepIndex)`

Para actualizar el icono y label, reutilizar las funciones existentes `getStatusIcon(step.status)` y `getStatusLabel(step.status)` — NO duplicar la logica.

Para actualizar el output, llamar `getStepOutputHtml(step, stepIndex)` y asignarlo al `innerHTML` del div `#pe-step-output-${stepIndex}`. `getStepOutputHtml` ya maneja todos los casos (pending, running, completed, failed) y usa `escapeHtml` correctamente.

**Cambio 4 — Mantener renderSteps() para el caso de reintento**

En el handler del boton de retry (linea 266), la llamada `renderSteps()` debe permanecer sin cambios — ese es el reset completo intencional tras un reintento.

**Resumen de cambios:**

| Linea actual | Accion |
|---|---|
| 79 | Eliminar `params.onComplete(result.runId)` |
| 300 | Reemplazar `renderSteps()` por `updateStepElement(stepIndex)` |
| 303-318 | Anadir `if (msg.status === 'completed') { params.onComplete(currentRunId); }` |
| Nueva funcion | Anadir `updateStepElement(stepIndex: number)` antes de `handleRunCompleted` |

**Criterios de verificacion para Max:**

1. `grep -n "params.onComplete" pipeline-execution.ts` — debe aparecer SOLO en handleRunCompleted, no en startExecution
2. `grep -n "renderSteps()" pipeline-execution.ts` — debe aparecer en: initializeSteps (linea 97), el retry handler (linea 266), handleRunCompleted para el caso failed (linea 316), y el fallback de updateStepElement — NO en handleStepUpdated
3. Estructura de `handleRunCompleted`: debe tener rama `status==='completed'` que llama `params.onComplete` y rama `status==='failed'` que llama `renderSteps()`
4. `updateStepElement` usa `stepsListEl.querySelector` (con el container como contexto), no `document.querySelector`
5. `bun run tsc --noEmit` — 0 errores nuevos

→ Siguiente: @cloe Implementa el fix del bug #024 siguiendo exactamente el handoff de Max en este status.md.

---

## Handoff Cloe → Max

**Estado:** Fix implementado. Listo para verificacion.

### Checklist Cloe
- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Max (sin tipos nuevos — cambios de logica pura)
- [x] bun run tsc --noEmit ejecutado — 0 errores nuevos (errores preexistentes en scripts/metrics.ts)
- [x] Strings que viajan por IPC son ASCII puro (no hay strings nuevos de IPC)
- [x] Fire-and-forget: no aplica (no hay subprocesos nuevos)
- [x] Input validation: no aplica (no hay nuevos handlers IPC)
- [x] DB: no aplica (no hay operaciones DB)
- [x] initDatabase(): no aplica
- [x] Sin `any` sin justificacion
- [x] Labels HTML: no se creo HTML nuevo de formularios
- [x] CSS: no se creo ninguna clase CSS nueva — se reutiliza `pipeline-execution-step-status` y `pipeline-execution-step-status-label` existentes

### Manifiesto de archivos
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| src/renderer/views/pipeline-execution.ts | modificado | 79 (eliminado), 295-330 (updateStepElement nueva), 344-346 (else if completed) |

### Descripcion de los 4 cambios implementados

**Cambio 1 — Eliminado params.onComplete de startExecution:**
- Se elimino la linea `params.onComplete(result.runId)` que existia inmediatamente despues de `initializeSteps(runResult.run)` (antes linea 79). Ya no hay ninguna llamada a `params.onComplete` dentro de `startExecution`.

**Cambio 2 — Reemplazado renderSteps() en handleStepUpdated:**
- La llamada `renderSteps()` al final de `handleStepUpdated` fue reemplazada por `updateStepElement(stepIndex)`.

**Cambio 3 — Nueva funcion updateStepElement(stepIndex: number):**
- Ubicada entre `handleStepUpdated` y `handleRunCompleted`.
- Usa `stepsListEl.querySelector<HTMLDivElement>('[data-step-index="' + stepIndex + '"]')` como context del container (no `document.querySelector`).
- Fallback a `renderSteps()` si el elemento no existe en el DOM.
- Si existe: actualiza `className`, `.pipeline-execution-step-status.innerHTML` (via `getStatusIcon` + `getStatusLabel`), y `#pe-step-output-N.innerHTML` (via `getStepOutputHtml`). Sin duplicar logica.

**Cambio 4 — Rama completed en handleRunCompleted:**
- Anadido `else if (msg.status === 'completed') { params.onComplete(currentRunId); }` despues del bloque `if (msg.status === 'failed')`. `currentRunId` esta garantizado no-null por el guard `if (!currentRunId) return` en linea 331.

### Criterios de verificacion de Max — resultados de auto-verificacion

1. `grep -n "params.onComplete" pipeline-execution.ts` → SOLO linea 345 (handleRunCompleted) — PASS
2. `grep -n "renderSteps()" pipeline-execution.ts` → lineas 95 (initializeSteps), 264 (retry), 308 (fallback updateStepElement), 343 (failed) — NO en handleStepUpdated — PASS
3. Estructura handleRunCompleted: rama `failed` → `renderSteps()`, rama `completed` → `params.onComplete(currentRunId)` — PASS
4. `updateStepElement` usa `stepsListEl.querySelector` (container como contexto) — PASS
5. `bun run tsc --noEmit` — 0 errores nuevos en archivos del proyecto (errores preexistentes en scripts/metrics.ts sin cambio) — PASS

### Gaps y dudas de Cloe
Sin gaps porque: cambio de logica pura en un solo archivo, sin nueva IPC, sin DB, sin CSS nuevo. tsc limpio. Los 4 criterios de verificacion de Max ejecutados y pasados antes del handoff.

Confianza en la implementacion: alta

## Metricas de Cloe
- archivos_leidos: 3
- archivos_creados: 0
- archivos_modificados: 1
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Verificacion final Max

### Checklist Max — [bloques activos: ESTATICO | RENDERER]

## ESTATICO
- [x] Archivo del manifiesto verificado con file:line — evidencia: `src/renderer/views/pipeline-execution.ts` leido completo (466 lineas)
- [x] bun run tsc --noEmit — 0 errores nuevos — evidencia: todos los errores son preexistentes en `scripts/metrics.ts` y `node_modules/electrobun/` (sin cambio respecto al estado anterior al fix)
- [x] Sin logica de negocio rota en archivos modificados — evidencia: los 4 cambios estan correctamente acotados sin efectos colaterales

## RENDERER
- [x] Labels HTML: no se creo HTML nuevo de formularios — evidencia: unico HTML nuevo es el bloque de actualizacion en `updateStepElement` que reutiliza clases existentes, sin inputs nuevos
- [x] User input usa textContent o escapeHtml, no innerHTML con datos de usuario — evidencia: `updateStepElement:326` llama `getStepOutputHtml(step, stepIndex)` que internamente usa `escapeHtml()` en todo contenido de usuario antes de asignar a `innerHTML`
- [x] Estados de carga y error manejados en UI — evidencia: `updateStepElement` delega a `getStepOutputHtml` que cubre pending/running/completed/failed incluyendo mensajes de error escapados

### Criterios especificos del bug (evidencia independiente de auto-verificacion de Cloe)

1. `params.onComplete` SOLO en handleRunCompleted — evidencia: Grep confirma unica aparicion en linea 345, dentro de rama `else if (msg.status === 'completed')` de `handleRunCompleted`. No existe en `startExecution` (lineas 56-81). PASS.

2. `renderSteps()` ausente en `handleStepUpdated` — evidencia: Grep confirma 4 apariciones: linea 95 (`initializeSteps`), linea 264 (retry handler), linea 308 (fallback `updateStepElement`), linea 343 (`handleRunCompleted` rama `failed`). `handleStepUpdated` (lineas 277-299) termina en `updateStepElement(stepIndex)` linea 298. PASS.

3. `updateStepElement` usa `stepsListEl` como contexto — evidencia: `pipeline-execution.ts:305` — `stepsListEl.querySelector<HTMLDivElement>('[data-step-index="' + stepIndex + '"]')`. No usa `document.querySelector`. PASS.

4. Rama `completed` en `handleRunCompleted` — evidencia: `pipeline-execution.ts:344-346` — `else if (msg.status === 'completed') { params.onComplete(currentRunId); }`. PASS.

5. TSC — evidencia: salida de `bun run tsc --noEmit` muestra solo errores en `scripts/metrics.ts` y `node_modules/electrobun/` — ambos preexistentes. 0 errores nuevos introducidos por el fix. PASS.

### No verificado por Max
Ninguno.

Confianza en la verificacion: alta

**QA aprobado. Requiere auditoria de Cipher: NO.**

## Metricas de Max
- archivos_leidos: 2
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 0
- items_checklist_verificados: 8/8
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0
