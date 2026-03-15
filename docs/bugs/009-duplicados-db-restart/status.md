# Bug #009 — Duplicados en DB al reiniciar la app

Estado: RESUELTO
Fecha: 2026-03-15

---

## Descripcion

Cada vez que la app arranca, `PipelinePoller` inicializa `cachedSnapshot = null`. El `changeDetector` compara `null` vs el snapshot actual y detecta todas las features y bugs como "nuevos", insertando eventos duplicados en `pipeline_events` y `agent_metrics_history`.

Con 4 reinicios de la app se detectaron 44 eventos de features y 32 de bugs — todos duplicados del mismo estado.

## Reproduction

1. Arrancar `bun run desktop` con la app ya ejecutada previamente
2. Consultar `SELECT event_type, COUNT(*) FROM pipeline_events GROUP BY event_type`
3. Los conteos se multiplican por cada reinicio

## Causa raiz

`src/monitor/core/poller.ts` — `cachedSnapshot` se inicializa a `null` en cada instancia nueva del poller. No hay mecanismo para seedear el estado inicial desde la DB al arrancar.

## Fix propuesto

En `PipelinePoller.start()`, antes del primer scan, cargar el ultimo estado conocido de cada feature/bug desde `pipeline_events` y reconstruir un snapshot "virtual" como `cachedSnapshot`. Esto evita que el primer scan detecte todo como nuevo.

Alternativa mas simple: antes de insertar un evento, verificar si ya existe un evento identico reciente (mismo `item_slug` + `to_value` + `event_type` en los ultimos N segundos) y deduplicar.

## Archivos afectados

- `src/monitor/core/poller.ts` — inicializacion de cachedSnapshot
- `src/monitor/core/historyRepository.ts` — opcionalmente añadir upsert/dedup logic
- `src/monitor/core/changeDetector.ts` — sin cambios (funcion pura correcta)

## Impacto

- Alto para la utilidad del historial: los datos historicos son incorrectos
- Nulo para el monitor v1 (tab Pipeline y Agentes no usan la DB)

---

## Diagnostico de Max

### Confirmacion de la causa raiz

**Confirmada.** La causa raiz es exactamente la descrita. Traza verificada archivo por archivo:

**`src/monitor/core/poller.ts:13`**
```
private cachedSnapshot: PipelineSnapshot | null = null;
```
`cachedSnapshot` arranca `null` en cada instancia. No hay inicializacion desde DB.

**`src/monitor/core/poller.ts:31-34`**
```
start(): void {
  if (this.intervalId !== null) return;
  this.scan();  // <-- scan inmediato, cachedSnapshot todavia es null
  ...
}
```
`start()` llama `scan()` de inmediato sin ninguna carga previa desde DB.

**`src/monitor/core/poller.ts:70`**
```
const changes = detectChanges(this.cachedSnapshot, snapshot);
```
Llama a `detectChanges(null, snapshot)` en el primer scan.

**`src/monitor/core/changeDetector.ts:41-43`**
```
const prevFeatureMap = new Map(
  (prev?.features ?? []).map((f) => [f.slug, f])
);
```
Con `prev = null`, `prevFeatureMap` queda vacio. Cualquier feature del snapshot actual no tiene entrada previa.

**`src/monitor/core/changeDetector.ts:46-47`**
```
const prev_f = prevFeatureMap.get(curr_f.slug) ?? null;
if (prev_f === null || prev_f.state !== curr_f.state) {
```
`prev_f` es siempre `null` en el primer scan. La condicion se cumple para TODAS las features y bugs. Se genera un `feature_state_changed` o `bug_state_changed` por cada item del repositorio, con `fromValue: null` — exactamente los duplicados observados.

**`src/monitor/core/changeDetector.ts:83-99`**
El bloque de metricas tiene la misma logica: `hadData = false` cuando `prevMetrics === undefined`, lo que ocurre para todos los agentes con metricas en el primer scan. Resultado: duplicados tambien en `agent_metrics_history`.

### Evaluacion de las dos alternativas

#### Alternativa A — Seedear `cachedSnapshot` desde la DB antes del primer scan

**Mecanismo:** En `PipelinePoller.start()`, antes de llamar `scan()`, consultar la DB por el ultimo estado conocido de cada item y construir un `PipelineSnapshot` sintetico que se asigna a `cachedSnapshot`. El primer scan compara contra ese snapshot y solo detecta cambios reales ocurridos entre el ultimo arranque y el actual.

**Ventajas:**
- Elimina el bug en su raiz: el primer scan se comporta identicamente a los scans subsiguientes.
- No requiere cambios en `changeDetector.ts` (funcion pura, correcta, sin tocar).
- No requiere cambios en `historyRepository.ts`.
- El snapshot sintetico puede ser minimal: solo necesita `slug`, `state`, y los datos de metricas — los campos `title`, `branch`, `openedAt`, `handoffs` pueden quedar como valores neutros ya que `detectChanges` solo usa `slug`, `state`, `handoffs.completed`, y `metrics`.

**Desventajas:**
- Requiere una nueva funcion en `historyRepository.ts` para cargar el ultimo estado por item (query: `SELECT DISTINCT item_slug, to_value FROM pipeline_events WHERE event_type IN ('feature_state_changed', 'bug_state_changed') GROUP BY item_slug ORDER BY recorded_at DESC`).
- Si la DB esta vacia (primer arranque real), el snapshot seeded tambien queda vacio — comportamiento correcto, no introduce regresion.
- La reconstruccion del snapshot sintetico es un mapping de ~15 lineas. No compleja pero requiere implementacion cuidadosa.

#### Alternativa B — Deduplicar antes de insertar (ventana de N segundos)

**Mecanismo:** En `persistChanges()`, antes de insertar cada evento, verificar si ya existe una fila con el mismo `item_slug + to_value + event_type` con `recorded_at` en los ultimos N segundos (ej. 60 segundos). Si existe, omitir la insercion.

**Ventajas:**
- Cambio localizado en `historyRepository.ts:persistChanges()`.
- Protege contra duplicados en otros escenarios futuros, no solo al reiniciar.

**Desventajas criticas:**
- **Ventana arbitraria:** elegir N es heuristico. Si el usuario reinicia la app dos veces rapidamente (< N segundos), el segundo arranque no registra el cambio real. Si el reinicio tarda mas de N segundos, el duplicado vuelve a ocurrir.
- **Falsos negativos:** si un item cambia de estado y vuelve al estado original dentro de la ventana (ej. una feature marcada MERGEADO, luego revertida a EN_OPTIMIZACION por un hotfix en el mismo minuto), el segundo cambio real se descarta como duplicado.
- **No resuelve la causa raiz:** el `cachedSnapshot` sigue siendo `null` al arrancar. La deduplicacion es un parche en la capa de persistencia que enmascara el problema de la capa de estado.
- **Complejidad de la query:** necesita leer de la DB por cada evento antes de insertar, lo que convierte la transaccion actual (solo escrituras) en una mezcla de lecturas y escrituras por evento.

### Recomendacion

**Alternativa A — Seedear `cachedSnapshot` desde la DB.** Es la solucion correcta porque elimina el bug en la capa donde vive: el estado del poller.

La Alternativa B introduce heuristica temporal que puede fallar en ambas direcciones (demasiado corta o demasiado larga) y produce falsos negativos para cambios reales rapidos. No es apropiada como solucion principal.

**Implementacion recomendada para Cloe:**

1. Agregar funcion `loadLastKnownStates(db)` en `historyRepository.ts`. Debe retornar un mapa de `item_slug -> { state, metrics[] }` consultando las filas mas recientes de `pipeline_events` y `agent_metrics_history` por item.

2. En `PipelinePoller.start()`, si `getHistoryDb()` no es null y `cachedSnapshot` es null, llamar a esa funcion y construir un `PipelineSnapshot` sintetico. El campo `features` y `bugs` solo necesita los campos que `detectChanges` lee (`slug`, `state`, `metrics`, `handoffs`). El resto puede ser string vacio o array vacio.

3. No modificar `changeDetector.ts` — es una funcion pura correcta.

4. El caso de primer arranque (DB vacia) funciona correctamente sin logica adicional: `loadLastKnownStates` retorna mapa vacio, snapshot sintetico queda con arrays vacios, comportamiento es el mismo que hoy en el primer arranque real.

### Archivos que Cloe debe modificar

- `src/monitor/core/historyRepository.ts` — agregar `loadLastKnownStates(db)`
- `src/monitor/core/poller.ts` — en `start()`, seedear `cachedSnapshot` si DB disponible

### Archivos que Cloe NO debe modificar

- `src/monitor/core/changeDetector.ts` — funcion pura, correcta, sin tocar
- `src/monitor/core/historyDb.ts` — sin cambios
- `src/monitor/core/types.ts` — sin cambios

## Implementacion de Cloe

### Resumen del fix

Se implemento la Alternativa A tal como recomienda Max: seedear `cachedSnapshot` desde la DB antes del primer scan.

**`src/monitor/core/historyRepository.ts`** — nueva funcion `loadLastKnownStates(db)`:
- Query 1: obtiene el ultimo `to_value` por `(item_slug, item_type)` usando `MAX(id)` como proxy del registro mas reciente, filtrando solo `event_type IN ('feature_state_changed', 'bug_state_changed')`. Prepared statement, sin interpolacion.
- Query 2: obtiene todos los handoffs completados (`DISTINCT item_slug, to_value` donde `event_type = 'handoff_completed'`). Necesario para que `detectChanges` no genere `handoff_completed` duplicados.
- Query 3: obtiene las metricas mas recientes por `(agent_id, item_slug, item_type)` usando `MAX(id)`. Necesario para que `detectChanges` no genere `metrics_updated` duplicados.
- Construye `FeatureRecord[]` y `BugRecord[]` sinteticos con solo los campos que `detectChanges` usa: `slug`, `state`, `handoffs[].{from,to,completed}`, `metrics[].{agentId,rework,iteraciones,confianza,gapsDeclarados}`. Campos no usados por el detector quedan como string vacio o false.
- Si la DB esta vacia, devuelve `{ features: [], bugs: [] }` — comportamiento identico al primer arranque real.

**`src/monitor/core/poller.ts`** — modificacion de `start()`:
- Importa `loadLastKnownStates` desde `historyRepository`.
- Antes de llamar `this.scan()`, si `getHistoryDb()` retorna una DB y `cachedSnapshot` es null, llama `loadLastKnownStates(db)` y asigna el resultado a `this.cachedSnapshot` (solo si el resultado tiene al menos 1 feature o 1 bug).
- Envuelto en try/catch con degradacion graceful: si la carga falla, el poller sigue con `cachedSnapshot = null` (primer scan genera bootstrap, mejor que crash).
- No se toca `scan()`, `detectChanges`, `persistChanges` ni ningun otro metodo.

### Checklist Cloe

- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Leo (o documentado por que difieren)
- [x] bun run tsc --noEmit ejecutado - 0 errores nuevos en src/monitor antes de entregar
- [x] Strings que viajan por IPC son ASCII puro (no se tocan strings IPC en este fix)
- [x] Fire-and-forget en todos los handlers IPC que lanzan subprocesos (no aplica a este fix)
- [x] Input validation en todos los IPC handlers que tocan filesystem o spawn (no aplica)
- [x] DB: no hay INSERT en este fix, solo SELECTs de lectura
- [x] initDatabase() ya existia en try/catch, no se modifico
- [x] Sin `any` sin justificacion escrita
- [x] Labels HTML: no aplica (no hay UI en este fix)
- [x] CSS: no aplica (no hay vistas nuevas)

### Manifiesto de archivos

| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| `src/monitor/core/historyRepository.ts` | modificado | 1-17 (imports), 47-212 (nueva funcion `loadLastKnownStates` + interfaces auxiliares) |
| `src/monitor/core/poller.ts` | modificado | 5 (import), 34-56 (seed en `start()`) |

### Gaps y dudas de Cloe

- La query de handoffs seedea TODOS los handoffs que alguna vez se marcaron completados. Si un handoff fue completado, luego revertido (estado vuelto a `false`), el snapshot sintetico lo mostraria como completado aun cuando ya no lo es. Sin embargo, `changeDetector` solo detecta la transicion `false -> true` para handoffs (`if (h.completed && !prevH?.completed)`), nunca al reves, por lo que este caso no genera duplicados — no es un gap real para el fix del bug.
- No se pudo verificar manualmente con la DB real de produccion. El test de verificacion lo hara Max.

Confianza en la implementacion: alta

### Metricas de Cloe

- archivos_leidos: 5
- archivos_creados: 0
- archivos_modificados: 2
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 1

---

Siguiente: @max Reverifica el bug #009. Cloe implemento la Alternativa A (seedear cachedSnapshot desde DB en start()). Los archivos modificados son src/monitor/core/historyRepository.ts (nueva funcion loadLastKnownStates) y src/monitor/core/poller.ts (seed en start() antes del primer scan). tsc limpio en src/monitor, 0 errores nuevos.

## Re-verificacion de Max

### Checklist Max — [bloques activos: ESTATICO | DB]

#### ESTATICO (obligatorio)

- [x] Cada archivo del manifiesto verificado con file:line
  - `src/monitor/core/historyRepository.ts` — nueva funcion `loadLastKnownStates` en lineas 81-212, interfaces auxiliares en lineas 48-69. Confirmado.
  - `src/monitor/core/poller.ts` — import en linea 5, bloque seed en lineas 34-56, `this.scan()` en linea 58. Confirmado.
  - `changeDetector.ts`, `historyDb.ts`, `types.ts` — sin modificaciones. Confirmado.
- [x] `bun run tsc --noEmit` — 0 errores en `src/monitor/` — evidencia: output filtrado con `grep "src/monitor"` devuelve linea vacia (sin errores). Los errores existentes son en `node_modules/`, `scripts/metrics.ts`, `src/client.ts`, `src/db/`, `src/ipc/acpManager.ts`, `src/renderer/` — todos preexistentes.
- [x] Sin logica de negocio rota — evidencia: el orden seed-antes-de-scan en `start()` es correcto. Los tres statements usan la API sincrona de `bun:sqlite`. No hay `await`, no hay subprocesos, no hay efectos secundarios en la DB (solo SELECTs).

#### DB (cambios en historyRepository.ts)

- [x] Queries usan prepared statements, sin interpolacion — evidencia:
  - `historyRepository.ts:84` — `db.prepare<LastStateRow, []>(...)` con `.all()` sin params
  - `historyRepository.ts:97` — `db.prepare<HandoffRow, []>(...)` con `.all()` sin params
  - `historyRepository.ts:114` — `db.prepare<SeedMetricsRow, []>(...)` con `.all()` sin params
  - Las tres queries de la nueva funcion son solo SELECT, sin parametros de usuario, sin interpolacion de strings.
- [x] No hay INSERT en este fix — evidencia: la nueva funcion `loadLastKnownStates` solo contiene `.prepare().all()`. `persistChanges()` y `queryHistory()` preexistentes no se modificaron.
- [x] initDatabase() ya existia en try/catch — evidencia: `historyDb.ts:11-20` sin cambios.

### Verificacion de escenarios criticos

**Escenario A: Reinicio con datos en DB (bug original)**
- `loadLastKnownStates` devuelve features y bugs con su ultimo estado conocido.
- `cachedSnapshot` se popula con el snapshot sintetico (`poller.ts:44-50`).
- `detectChanges(sintetico, real)` en el primer scan: si el estado no cambio, `prev_f.state === curr_f.state` — no se emite evento. Los handoffs y metricas ya estan seeded. Sin duplicados.

**Escenario B: Primer arranque (DB vacia)**
- `lastStatesStmt.all()` devuelve `[]`. El bucle no itera. `features = []`, `bugs = []`.
- La condicion `poller.ts:43` (`seeded.features.length > 0 || seeded.bugs.length > 0`) es `false`.
- `cachedSnapshot` permanece `null`. El primer scan es bootstrap normal. Sin regresion.

**Escenario C: DB disponible pero falla la query**
- El try/catch en `poller.ts:41-55` captura el error. Solo `console.error(...)`. `cachedSnapshot` permanece `null`. El poller continua con `this.scan()`. Degradacion graceful correcta.

**Coherencia de claves de bugs en el snapshot sintetico**
- `changeDetector.ts:120`: clave de mapa = `` `${b.id}-${b.slug}` `` (ej. `"001-validacion-encoding"`)
- `historyRepository.ts:180-182`: el `item_slug` almacenado en DB es la misma clave que inserto `changeDetector`. El split en `id` y `slug` reconstruye `BugRecord.id = "001"` y `BugRecord.slug = "validacion-encoding"`.
- La lookup en `detectChanges` reconstruye `` `${curr_b.id}-${curr_b.slug}` `` = `"001-validacion-encoding"` — coincide con la clave del mapa `prevBugMap`. Correcto.

**Gap de Cloe sobre handoffs revertidos**
- Verificado: `changeDetector.ts:69` solo dispara para transicion `false -> true` (`h.completed && !prevH?.completed`). Con handoff seeded como `completed: true`, `!prevH?.completed` es `false` — no se genera evento duplicado. El gap no produce duplicados.

### No verificado por Max

- Ejecucion real contra DB de produccion con datos: no hay entorno de runtime disponible en esta sesion. La verificacion es estatica (lectura de codigo + razonamiento de escenarios).

Confianza en la verificacion: alta

### Metricas de Max

- archivos_leidos: 5
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 0
- items_checklist_verificados: 5/5
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 1

---

**QA aprobado con gaps conocidos: verificacion estatica unicamente — ejecucion contra DB real no disponible en esta sesion.**
