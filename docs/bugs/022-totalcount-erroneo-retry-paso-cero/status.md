# Bug #022 — totalCount erróneo en listPipelineRuns y retry siempre desde el paso 0

Estado: RESUELTO
Rama: bug/022-totalcount-erroneo-retry-paso-cero
Fecha apertura: 2026-04-19

---

## Info del bug

**Descripcion:** Dos bugs relacionados con pipeline runs. (1) src/ipc/handlerLogic.ts línea 508: handleListPipelineRuns retorna totalCount: runs.length. Con limit=20 y 50 runs totales, retorna totalCount: 20 en lugar de 50. El campo totalCount en ListPipelineRunsResult queda semánticamente roto para paginación. (2) src/ipc/handlerLogic.ts líneas 512-526: handleRetryPipelineRun llama pipelineRunner.resume({ runId, fromStepIndex: 0 }), siempre reejecutando desde el paso 0. Los pasos ya completados antes del fallo se re-ejecutan innecesariamente.

**Como reproducir:**
Para bug #1:
1. Crear 30+ runs de un pipeline
2. Llamar listPipelineRuns con limit=20
3. Observar que totalCount retorna 20 en lugar del total real

Para bug #2:
1. Ejecutar un pipeline de 5 pasos que falla en el paso 3
2. Usar "Reintentar" — observar que re-ejecuta desde el paso 1 en lugar del paso 3

**Comportamiento esperado:** (1) totalCount refleja el número total de runs en DB independientemente del limit. (2) El retry reanuda desde el paso que falló, no desde el principio.

**Comportamiento actual:** (1) totalCount siempre es igual a la cantidad de items retornados en la página. (2) Retry siempre comienza desde el paso 0, re-ejecutando pasos ya completados.

**Severidad:** MEDIA

**Tiene implicaciones de seguridad:** NO
**Requiere auditoria de Cipher:** NO

---

## Diagnóstico Max

**Fecha:** 2026-04-19

### Bug #1 — totalCount: runs.length

`handleListPipelineRuns` en `src/ipc/handlerLogic.ts:497-511` llama a `pipelineRunRepository.listRuns(db, pipelineId, limit, offset)` (línea 500). Este método ejecuta `SELECT * FROM pipeline_runs WHERE pipeline_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?` y retorna solo los registros de la página actual. La línea 509 usa `runs.length` como `totalCount`, que siempre es `<= limit` — nunca refleja el total real en DB.

**Causa raiz confirmada:** No existe método `countRuns` en `src/db/pipelineRunRepository.ts`. El repositorio expone: `createRun`, `getRun`, `listRuns`, `updateRunStatus`, `createStepRun`, `updateStepRun`. Ninguno hace COUNT.

### Bug #2 — fromStepIndex: 0 hardcodeado

`handleRetryPipelineRun` en `src/ipc/handlerLogic.ts:513-527` llama `pipelineRunner.resume({ runId, fromStepIndex: 0 })` en línea 520. El run se carga vía `pipelineRunRepository.getRun(db, runId)` en línea 517 — y `getRun` ya retorna el run con su campo `stepRuns: PipelineStepRunRecord[]` (ver `pipelineRunRepository.ts:118-130`). Los stepRuns están ordenados por `step_order ASC`. Cada `PipelineStepRunRecord` tiene el campo `status: StepRunStatus` con valores posibles `'pending' | 'running' | 'completed' | 'failed'`. El handler ya tiene todos los datos necesarios para determinar el índice del paso fallido — simplemente no los usa.

**Causa raiz confirmada:** `run.stepRuns` está disponible en la respuesta de `getRun` pero `handleRetryPipelineRun` ignora ese campo y hardcodea `fromStepIndex: 0`.

---

## Handoff Max → Cloe

**Archivos a modificar:**
1. `src/db/pipelineRunRepository.ts` — añadir método `countRuns`
2. `src/ipc/handlerLogic.ts` — corregir `handleListPipelineRuns` (línea 509) y `handleRetryPipelineRun` (línea 520)

### Fix #1 — Añadir `countRuns` al repositorio

En `src/db/pipelineRunRepository.ts`, dentro del objeto `pipelineRunRepository` (después de `listRuns` y antes de `updateRunStatus`), añadir:

```
countRuns(db: Database, pipelineId: string): number {
  const row = db.query<{ count: number }, string>(
    'SELECT COUNT(*) as count FROM pipeline_runs WHERE pipeline_id = ?'
  ).get(pipelineId);
  return row?.count ?? 0;
},
```

IMPORTANTE: El parámetro se pasa como argumento posicional directo (`.get(pipelineId)`), NO como array (`.get([pipelineId])`). Ver patrón establecido en MEMORY.md — bun:sqlite params como spread, nunca array wrapeado.

### Fix #2 — Corregir `handleListPipelineRuns`

En `src/ipc/handlerLogic.ts`, función `handleListPipelineRuns` (líneas 497-511):

Añadir llamada a `pipelineRunRepository.countRuns(db, params.pipelineId.trim())` antes del return, y usar ese valor como `totalCount` en lugar de `runs.length`.

El código resultante en el bloque return debe quedar con `totalCount: total` donde `total` es el resultado del COUNT.

### Fix #3 — Corregir `handleRetryPipelineRun`

En `src/ipc/handlerLogic.ts`, función `handleRetryPipelineRun` (líneas 513-527), línea 520:

`getRun` ya retorna `run.stepRuns` con todos los stepRuns ordenados por `step_order ASC`. Cloe debe:
1. Buscar en `run.stepRuns` el primer elemento con `status === 'failed'` — su campo `stepOrder` (camelCase, mapeado desde `step_order`) es el índice a pasar.
2. Si ningún step tiene status `'failed'` (caso defensivo: run marcado como failed pero sin stepRun failed), usar `fromStepIndex: 0` como fallback.
3. Pasar el índice encontrado a `pipelineRunner.resume({ runId: params.runId.trim(), fromStepIndex: <indice> })`.

Nota: `PipelineStepRunRecord.stepOrder` es el campo correcto (ver `pipelineRunRepository.ts:60`). Es `number`, compatible con el parámetro `fromStepIndex` de `resume`.

### Criterios de verificacion para Max (post-fix)

1. `bun run tsc --noEmit` — 0 errores nuevos tras el fix
2. `pipelineRunRepository.countRuns` existe en el repositorio con query `SELECT COUNT(*) as count` — verificable con file:line
3. `handleListPipelineRuns` usa el resultado de `countRuns` como `totalCount`, no `runs.length` — verificable con file:line
4. `handleRetryPipelineRun` busca el primer stepRun con `status === 'failed'` antes de llamar `resume` — verificable con file:line
5. El fallback a `fromStepIndex: 0` cuando no hay stepRun fallido está presente — verificable con file:line
6. Params de bun:sqlite pasados como argumento posicional, no como array wrapeado — verificable con file:line

→ Siguiente: @cloe Implementa el fix del bug #022. Lee este status.md para el plan detallado. Archivos a tocar: `src/db/pipelineRunRepository.ts` y `src/ipc/handlerLogic.ts`. No toques ningún otro archivo.

---

## Handoff Cloe → Max

**Fecha:** 2026-04-19

### Checklist Cloe
- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Max (contrato exacto: `countRuns(db, pipelineId): number`)
- [x] bun run tsc --noEmit ejecutado — 0 errores nuevos en los archivos modificados (errores pre-existentes en scripts/ y otros src/db/ no son introducidos por este fix)
- [x] Strings que viajan por IPC son ASCII puro — chars no-ASCII en handlerLogic.ts son pre-existentes (lineas 334, 653, 672, 692), no introducidos
- [x] Fire-and-forget preservado en handleRetryPipelineRun — `.catch()` sin await mantenido
- [x] Sin `any` sin justificacion — no se usa any
- [x] Param bun:sqlite posicional: `.get(pipelineId)` sin array wrap — linea 143 de pipelineRunRepository.ts

### Manifiesto de archivos
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| src/db/pipelineRunRepository.ts | modificado | 140-145 (metodo countRuns anadido) |
| src/ipc/handlerLogic.ts | modificado | 500-514 (handleListPipelineRuns), 519-520 (handleRetryPipelineRun) |

### Criterios de verificacion — respuestas exactas para Max

1. `bun run tsc --noEmit` — 0 errores nuevos en archivos tocados (verificado)
2. `countRuns` en `src/db/pipelineRunRepository.ts:140-145` — query `SELECT COUNT(*) as count FROM pipeline_runs WHERE pipeline_id = ?` con `.get(pipelineId)` posicional
3. `handleListPipelineRuns` usa `totalCount: total` donde `total = pipelineRunRepository.countRuns(db, pipelineId)` — `src/ipc/handlerLogic.ts:503,513`
4. `handleRetryPipelineRun` busca `run.stepRuns.find((sr) => sr.status === 'failed')` — `src/ipc/handlerLogic.ts:523`
5. Fallback `?? 0` presente — `src/ipc/handlerLogic.ts:524`: `const fromStepIndex = failedStep?.stepOrder ?? 0`
6. Param posicional confirmado — `src/db/pipelineRunRepository.ts:143`: `.get(pipelineId)` sin array

### Gaps y dudas de Cloe
Sin gaps porque: fix de 3 puntos exactos — un metodo nuevo de 6 lineas y 2 correcciones de 1-2 lineas cada una, sin nueva logica compleja, tsc limpio en archivos tocados, patron bun:sqlite seguido exactamente segun MEMORY.md.

Confianza en la implementacion: alta

---

## Handoff Max → Commit

**Fecha:** 2026-04-19

### Checklist Max — bug #022

**Archivos leidos:** 3
- `docs/bugs/022-totalcount-erroneo-retry-paso-cero/status.md`
- `src/db/pipelineRunRepository.ts`
- `src/ipc/handlerLogic.ts`

**Bloques activos:** ESTATICO

### Checklist Max

- [x] Criterio 1 (TSC): `bun run tsc --noEmit` — 0 errores nuevos en archivos tocados. Errores pre-existentes en `pipelineRunRepository.ts:119,124,135,169` y `handlerLogic.ts` son IDENTICOS antes y despues del fix. El fix no introduce errores nuevos. Evidencia: diff TSC pre/post fix mostra identical errors; el nuevo metodo `countRuns` no genera errores en ninguna de sus 6 lineas.
- [x] Criterio 2 (countRuns existe): `src/db/pipelineRunRepository.ts:140-145` — metodo `countRuns` con query `SELECT COUNT(*) as count FROM pipeline_runs WHERE pipeline_id = ?` confirmado. Parametro pasado como argumento posicional directo `.get(pipelineId)` (sin array wrapeado), linea 143. Evidencia: archivo `pipelineRunRepository.ts:140-145`.
- [x] Criterio 3 (totalCount no es runs.length): `src/ipc/handlerLogic.ts:505` llama `pipelineRunRepository.countRuns(db, pipelineId)` y linea 514 usa `totalCount: total`. Evidencia: archivo `handlerLogic.ts:505,514`.
- [x] Criterio 4 (retry busca failed step): `src/ipc/handlerLogic.ts:525` — `const failedStep = run.stepRuns.find((sr) => sr.status === 'failed')`. Evidencia: archivo `handlerLogic.ts:525`.
- [x] Criterio 5 (fallback a fromStepIndex 0): `src/ipc/handlerLogic.ts:526` — `const fromStepIndex = failedStep?.stepOrder ?? 0`. Evidencia: archivo `handlerLogic.ts:526`.
- [x] Criterio 6 (param posicional): `src/db/pipelineRunRepository.ts:143` — `.get(pipelineId)` sin array, cumple patron bun:sqlite. Evidencia: archivo `pipelineRunRepository.ts:143`.

### Sin logica de negocio rota

`countRuns` retorna `row?.count ?? 0` cubriendo el caso null. `handleRetryPipelineRun` usa `.catch()` sin await, preservando fire-and-forget. No hay introduccion de `any` sin justificacion.

### No verificado por Max

Ninguno.

Confianza en la verificacion: alta

### Resolucion

QA aprobado — bug #022 RESUELTO.
Requiere auditoria de Cipher: NO

---

## Metricas de Max
- archivos_leidos: 3
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 0
- items_checklist_verificados: 6/6
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0
