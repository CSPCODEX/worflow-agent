# Bug #023 — PipelineRunner.execute y resume — duplicación de lógica y finalOutput vacío en resume

Estado: RESUELTO
Rama: bug/023-pipeline-runner-execute-resume-divergencia
Fecha apertura: 2026-04-19
Fecha cierre: 2026-04-19

---

## Info del bug

**Descripcion:** src/ipc/pipelineRunner.ts líneas 129-219 vs 264-363: los métodos execute y resume contienen ~80 líneas de lógica casi idéntica (bucle de pasos, stepRunId, handling del stop, truncamiento, update DB, callbacks). Divergencia activa: execute calcula finalOutput como stepOutputs.join('\n\n') (línea 216), pero resume llama onPipelineCompleteCb?.({ runId, finalOutput: '' }) (línea 365) — string vacío hardcodeado. Un retry nunca entrega el output final al caller de resume.

**Como reproducir:**
1. Ejecutar un pipeline que falla en el paso 2
2. Usar la función de retry para reintentar
3. Esperar que el retry complete
4. Observar que el output final del retry llega como string vacío

**Comportamiento esperado:** El retry entrega el output acumulado de todos los pasos ejecutados, igual que una ejecución normal.

**Comportamiento actual:** finalOutput siempre es '' (string vacío) cuando el pipeline se completa vía resume/retry.

**Severidad:** MEDIA

**Tiene implicaciones de seguridad:** NO

---

## Diagnóstico Max

**Causa raíz confirmada — evidencia exacta:**

Archivo: `src/ipc/pipelineRunner.ts`

Método `execute` (líneas 129-219):
- Línea 142: `const stepOutputs: string[] = [];` — array declarado
- Línea 213: `stepOutputs.push(truncated);` — cada paso acumula su output
- Línea 216: `const finalOutput = stepOutputs.join('\n\n');` — calcula el output real
- Línea 218: `this.onPipelineCompleteCb?.({ runId, finalOutput });` — entrega el output real

Método `resume` (líneas 267-366):
- NO tiene declaración de `stepOutputs: string[]` — el array nunca existe
- Línea 357: `const truncated = truncateOutput(fullOutput, this.config.maxStepOutputBytes);` — el output del paso se calcula correctamente
- Línea 361: `previousOutputs.set(stepOrder, truncated);` — solo actualiza previousOutputs para template injection
- **Línea 365: `this.onPipelineCompleteCb?.({ runId, finalOutput: '' });`** — hardcodea string vacío

La divergencia es exactamente la descrita: `resume` acumula `previousOutputs` (Map para resolución de templates) pero no tiene el array `stepOutputs` que `execute` usa para calcular `finalOutput`. El resultado es que cualquier callback de completion tras un retry recibe `finalOutput: ''`.

**Fix mínimo para MVP (sin refactorizar en método común — eso es deuda técnica futura):**

En el método `resume`:
1. Declarar `const stepOutputs: string[] = [];` justo antes del bucle `for` (línea 293), inicializado con los outputs de los pasos previos al `fromStepIndex` que ya están en `previousOutputs`.
2. Dentro del bucle, después de línea 361 (`previousOutputs.set(stepOrder, truncated);`), añadir: `stepOutputs.push(truncated);`
3. Antes de la llamada a `onPipelineCompleteCb` (línea 365), calcular: `const finalOutput = stepOutputs.join('\n\n');`
4. Cambiar línea 365 de `finalOutput: ''` a `finalOutput`.

**Nota sobre inicialización de stepOutputs en resume:** Los pasos anteriores a `fromStepIndex` ya están en `run.stepRuns` y sus outputs en `previousOutputs`. Para que `finalOutput` incluya tanto los pasos previos como los recién ejecutados (comportamiento equivalente a `execute`), `stepOutputs` debe pre-cargarse con los outputs de `run.stepRuns[0..fromStepIndex-1]` antes del bucle. Esto es coherente con la inicialización de `previousOutputs` en líneas 284-289.

---

## Handoff Max → Cloe

**Archivo:** `src/ipc/pipelineRunner.ts`

**Cambios requeridos — todos en el método `resume`:**

1. **Después de línea 290** (después del cierre del bucle `for` que inicializa `previousOutputs`), añadir la inicialización de `stepOutputs` precargada con los outputs previos:
   ```
   const stepOutputs: string[] = [];
   for (let i = 0; i < fromStepIndex && i < run.stepRuns.length; i++) {
     const stepRun = run.stepRuns[i]!;
     if (stepRun.output) {
       stepOutputs.push(stepRun.output);
     }
   }
   ```

2. **Después de línea 361** (`previousOutputs.set(stepOrder, truncated);`), añadir:
   ```
   stepOutputs.push(truncated);
   ```

3. **Antes de línea 364** (`pipelineRunRepository.updateRunStatus(...)`), añadir:
   ```
   const finalOutput = stepOutputs.join('\n\n');
   ```

4. **En línea 365**, cambiar:
   ```
   this.onPipelineCompleteCb?.({ runId, finalOutput: '' });
   ```
   por:
   ```
   this.onPipelineCompleteCb?.({ runId, finalOutput });
   ```

**NO tocar** el método `execute` — funciona correctamente. **NO refactorizar** en método común — es deuda técnica documentada para post-MVP.

**Criterios de verificación para Max (post-fix):**
1. Un retry completado entrega el output real acumulado de todos los pasos ejecutados
2. El output de `execute` y de `resume` son equivalentes para el mismo conjunto de pasos
3. Los pasos previos al punto de retry contribuyen al `finalOutput` (precargados desde `run.stepRuns`)
4. No hay regresión en el comportamiento de `execute` normal
5. `bun run tsc --noEmit` — 0 errores nuevos

→ Siguiente: @cloe Implementa el fix del bug #023. Archivo: `src/ipc/pipelineRunner.ts`, método `resume`. Ver sección "Handoff Max → Cloe" para los 4 cambios exactos requeridos (líneas de referencia en el archivo actual). No tocar `execute`. No refactorizar en método común.

---

## Handoff Cloe → Max

### Cambios implementados

4 cambios quirurgicos en `src/ipc/pipelineRunner.ts`, metodo `resume`. Metodo `execute` no tocado.

**Cambio 1 (lineas 291-297):** Inicializacion de `stepOutputs` precargada con outputs de pasos previos al `fromStepIndex`, paralela al bucle existente de `previousOutputs`:
```
const stepOutputs: string[] = [];
for (let i = 0; i < fromStepIndex && i < run.stepRuns.length; i++) {
  const stepRun = run.stepRuns[i]!;
  if (stepRun.output) {
    stepOutputs.push(stepRun.output);
  }
}
```

**Cambio 2 (linea 370):** Dentro del bucle principal, tras `previousOutputs.set(stepOrder, truncated)`:
```
stepOutputs.push(truncated);
```

**Cambio 3 (linea 373):** Antes de `updateRunStatus`, calculo del output final:
```
const finalOutput = stepOutputs.join('\n\n');
```

**Cambio 4 (linea 375):** Sustitucion del string vacio hardcodeado:
```
this.onPipelineCompleteCb?.({ runId, finalOutput });
```

### Checklist Cloe
- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Leo (no hay tipos nuevos — solo uso de `string[]` existente)
- [x] bun run tsc --noEmit ejecutado — 0 errores nuevos en src/ (errores preexistentes en scripts/metrics.ts no relacionados)
- [x] Strings que viajan por IPC son ASCII puro (sin tildes ni chars > 0x7E en el archivo modificado)
- [x] Fire-and-forget: no aplica (no hay spawn en este fix)
- [x] Input validation: no aplica (no hay nuevos inputs)
- [x] DB: no aplica (no hay INSERT nuevo)
- [x] initDatabase(): no aplica
- [x] Sin `any` sin justificacion
- [x] Labels HTML: no aplica (no hay UI)
- [x] Vistas nuevas: no aplica

### Manifiesto de archivos
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| src/ipc/pipelineRunner.ts | modificado | 291-297 (nuevo bloque stepOutputs init), 370 (push), 373 (finalOutput calc), 375 (callback fix) |

### Gaps y dudas de Cloe

Sin gaps porque: fix de 4 lineas/bloques de logica pura sin nueva logica de negocio, tsc limpio en src/, los cambios son simetricos al patron de `execute` (referencia ya verificada), campo `output` confirmado en `PipelineStepRunRecord`.

Confianza en la implementacion: alta

## Metricas de Cloe
- archivos_leidos: 3
- archivos_creados: 0
- archivos_modificados: 1
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

Sin gaps porque: cambio de 4 bloques/lineas sin nueva logica de negocio, tsc limpio en src/, patron simetrico a `execute` (referencia directa en el mismo archivo).

---

## Verificacion Max — Bug #023

### Checklist Max — [bloques activos: ESTATICO | IPC]

## ESTATICO (siempre obligatorio)
- [x] Cada archivo del manifiesto verificado con file:line — evidencia: `src/ipc/pipelineRunner.ts` lineas 291-297, 370, 373, 375 leidas y confirmadas con `git diff`
- [x] bun run tsc --noEmit — 0 errores nuevos — evidencia: todos los errores del output son en `node_modules/`, `scripts/`, y `src/db/` preexistentes; ningun error nuevo en `src/ipc/pipelineRunner.ts`
- [x] Sin logica de negocio rota en los archivos modificados — evidencia: el patron de acumulacion `stepOutputs` es simetrico al de `execute` (lineas 142, 213, 216, 218); la precarga desde `run.stepRuns` es paralela e identica al bucle de `previousOutputs` (lineas 284-289)

## IPC (cambios en src/ipc/pipelineRunner.ts)
- [x] Fire-and-forget en handlers que lanzan subprocesos — evidencia: no aplica, no hay spawn nuevo
- [x] Strings IPC son ASCII puro (sin chars > 0x7E) — evidencia: los nuevos strings introducidos son unicamente variables (`stepOutputs`, `finalOutput`, `truncated`) sin literales de texto
- [x] Inputs validados antes de filesystem ops o spawn — evidencia: no aplica, no hay nuevos inputs ni filesystem ops

### Criterios de verificacion del diagnostico

**Criterio 1: `stepOutputs: string[]` declarado en resume**
- Confirmado. Linea 291: `const stepOutputs: string[] = [];`
- Evidencia: `git diff` muestra `+    const stepOutputs: string[] = [];` en el bloque insertado tras `previousOutputs`

**Criterio 2: Precargado con outputs de pasos previos**
- Confirmado. Lineas 292-296: bucle `for (let i = 0; i < fromStepIndex && i < run.stepRuns.length; i++)` con `stepOutputs.push(stepRun.output)` — identico al bucle de `previousOutputs` (lineas 284-289)
- Evidencia: lectura directa de `pipelineRunner.ts:291-297`

**Criterio 3: Acumula en el bucle con push(truncated)**
- Confirmado. Linea 370: `stepOutputs.push(truncated);` inmediatamente despues de `previousOutputs.set(stepOrder, truncated);` (linea 369)
- Evidencia: `git diff` muestra `+      stepOutputs.push(truncated);` en la posicion correcta

**Criterio 4: finalOutput calculado antes de onPipelineCompleteCb**
- Confirmado. Linea 373: `const finalOutput = stepOutputs.join('\n\n');` — precede a `pipelineRunRepository.updateRunStatus(...)` (linea 374) y a `this.onPipelineCompleteCb?.({ runId, finalOutput })` (linea 375)
- Evidencia: `git diff` y lectura de `pipelineRunner.ts:373-375`

**Criterio 5: `execute` no modificado**
- Confirmado. `git diff` muestra unicamente cambios en el bloque del metodo `resume` (lineas 288+ del diff). El metodo `execute` (lineas 129-219) permanece intacto: `stepOutputs` declarado en linea 142, `push` en linea 213, `join` en linea 216, callback en linea 218.
- Evidencia: lectura de `pipelineRunner.ts:129-219` confirma el patron original sin modificaciones

### No verificado por Max
- Comportamiento en runtime con pipeline real fallando en paso 2 y retrying: requiere entorno desktop con LM Studio activo. El fix es logicamente correcto y simetrico al patron verificado de `execute`.

Confianza en la verificacion: alta

## Metricas de Max
- archivos_leidos: 3
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 0
- items_checklist_verificados: 6/6
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 1

Requiere auditoria de Cipher: NO

QA aprobado con gaps conocidos: comportamiento en runtime no verificable sin entorno desktop activo — el fix es estructuralmente correcto y simetrico al patron de `execute`.
