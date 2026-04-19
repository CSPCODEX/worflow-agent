# Bug #021 — N+1 queries SQLite en handleGetPipeline — 1 query por paso del pipeline

Estado: RESUELTO
Rama: bug/021-n-plus-1-queries-getpipeline
Fecha apertura: 2026-04-19
Fecha cierre: 2026-04-19

---

## Info del bug

**Descripcion:** src/ipc/handlerLogic.ts líneas 397-407: handleGetPipeline llama agentRepository.findById(s.agentId) en un bucle por cada paso del pipeline. Para un pipeline de N pasos: 1 query para el pipeline + N queries para los agentes = N+1 total. Un pipeline de 5 pasos genera 6 round-trips donde 2 serían suficientes.

**Como reproducir:**
1. Crear un pipeline con 5 o más pasos
2. Abrir la vista de detalle del pipeline
3. Observar en los logs que se realizan N+1 queries SQLite (1 por cada paso)

**Comportamiento esperado:** Como máximo 2 queries SQLite al abrir el detalle de un pipeline (1 para el pipeline + steps, 1 para todos los agentes involucrados).

**Comportamiento actual:** 1 query para el pipeline + 1 query por cada paso = N+1 queries en total.

**Severidad:** MEDIA

**Tiene implicaciones de seguridad:** NO

**Requiere auditoria de Cipher:** NO

---

## Diagnostico de Max

**Causa raiz confirmada (file:line):**

`src/ipc/handlerLogic.ts:397-407` — el metodo `.map()` del array `pipeline.steps` invoca `agentRepository.findById(s.agentId)` de forma sincrona en cada iteracion. Cada llamada abre una query preparada individual contra SQLite:

```
src/ipc/handlerLogic.ts:398  →  agentRepository.findById(s.agentId)
src/db/agentRepository.ts:131-137  →  db.query(...).get(id)  (una query por llamada)
```

Para un pipeline de N pasos el coste es exactamente 1 + N queries.

**Estado del repositorio:**

`src/db/agentRepository.ts` NO tiene metodo `findByIds` ni ninguna variante de bulk lookup. Metodos existentes: `insert`, `createDefaultAgent`, `findByName`, `findById`, `findAll`, `setStatus`, `delete`, `updateSystemPrompt`, `updateAgent`.

**Decision de diseno:**

Anadir `findByIds(ids: string[]): Map<string, AgentRecord>` al objeto `agentRepository` en `src/db/agentRepository.ts`. Razon: mantener la logica de acceso a datos centralizada en el repositorio (patron establecido en el proyecto), y evitar query SQL inline en la capa de handlers. El metodo debe:
- Aceptar un array de strings (puede contener duplicados — debe deduplicar antes de la query)
- Construir la clausula `WHERE id IN (?, ?, ...)` con tantos placeholders como IDs unicos
- Devolver un `Map<string, AgentRecord>` keyed por `id` para lookup O(1) en el bucle del handler
- Retornar un Map vacio si el array de entrada es vacio (evitar `IN ()` que es SQL invalido)

**Nota sobre bun:sqlite y parametros:** Segun el patron confirmado en MEMORY.md, bun:sqlite requiere parametros como argumentos posicionales (spread), NO como array wrapeado. Para la query IN dinamica: `db.query<AgentRow, string[]>(...).all(...uniqueIds)` con spread.

---

## Handoff Max → Cloe

**Archivos a modificar:**

1. `src/db/agentRepository.ts` — anadir metodo `findByIds` al objeto `agentRepository` (despues de `findById`, linea 137)

   Firma exacta a implementar:
   ```
   findByIds(ids: string[]): Map<string, AgentRecord>
   ```
   - Deduplicar con `[...new Set(ids)]`
   - Si `uniqueIds.length === 0` retornar `new Map()`
   - Construir placeholders: `uniqueIds.map(() => '?').join(', ')`
   - Query: `SELECT * FROM agents WHERE id IN (${placeholders})`
   - Parametros con spread: `.all(...uniqueIds)` — NO `.all([uniqueIds])`
   - Mapear cada row con `rowToRecord` y construir el Map

2. `src/ipc/handlerLogic.ts` — modificar `handleGetPipeline` (lineas 385-410)

   Sustituir el bucle N+1 por:
   - Antes del `.map()`: extraer todos los agentId de `pipeline.steps`, llamar `agentRepository.findByIds(agentIds)` y obtener el Map
   - Dentro del `.map()`: usar `agentsMap.get(s.agentId)` en lugar de `agentRepository.findById(s.agentId)`
   - El fallback `?? 'Unknown'` para `agentName` permanece igual

**Cambios de tipo:** Ninguno. El tipo de retorno de `handleGetPipeline` no cambia. No hay cambios en `src/types/ipc.ts`.

**Criterios de verificacion para Max (post-fix):**

1. `bun run tsc --noEmit` — 0 errores nuevos introducidos por el fix
2. `findByIds` usa spread de parametros, no array wrapeado — evidencia: file:line del `.all(...uniqueIds)`
3. Guard para array vacio presente — evidencia: file:line del `if (uniqueIds.length === 0)`
4. En `handlerLogic.ts`, el bucle `.map()` NO contiene ninguna llamada a `agentRepository.findById` — evidencia: grep
5. La query IN no se ejecuta si `pipeline.steps` esta vacio (guard de array vacio previene SQL invalido)
6. Pipelines con el mismo agente en varios pasos no generan queries duplicadas (deduplicacion por Set) — evidencia: file:line del Set

---

## Handoff Cloe → Max

### Checklist Cloe
- [x] Manifiesto completo: cada archivo modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Max (firma exacta `findByIds(ids: string[]): Map<string, AgentRecord>`)
- [x] bun run tsc --noEmit ejecutado — 0 errores nuevos en los archivos modificados (errores preexistentes en src/db/pipelineRepository.ts, conversationRepository.ts, database.ts no introducidos por este fix)
- [x] Strings que viajan por IPC son ASCII puro — no se introdujeron strings nuevos en la capa IPC
- [x] Sin `any` sin justificacion — no se uso `any`
- [x] Guard para array vacio presente — agentRepository.ts:142 `if (uniqueIds.length === 0) return new Map()`
- [x] Deduplicacion por Set presente — agentRepository.ts:141 `[...new Set(ids)]`
- [x] Spread de parametros bun:sqlite — agentRepository.ts:147 `.all(...uniqueIds)`
- [x] El bucle `.map()` en handleGetPipeline NO contiene llamada a `agentRepository.findById` — verificado con grep (0 matches en el contexto de handleGetPipeline)

### Manifiesto de archivos
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| src/db/agentRepository.ts | modificado | 139-153 (metodo findByIds anadido tras findById) |
| src/ipc/handlerLogic.ts | modificado | 391-392 (extraccion agentIds + llamada findByIds antes del .map) y 401 (agentsMap.get en lugar de findById) |

### Evidencias de los criterios de Max (post-fix)
1. tsc: 0 errores nuevos en agentRepository.ts y handlerLogic.ts
2. Spread: `agentRepository.ts:147` — `.all(...uniqueIds)`
3. Guard array vacio: `agentRepository.ts:142` — `if (uniqueIds.length === 0) return new Map()`
4. No findById en el map loop de handleGetPipeline: grep limpio
5. Guard array vacio actua si pipeline.steps esta vacio (agentIds = [] → findByIds([]) → Map vacio, sin IN query)
6. Deduplicacion: `agentRepository.ts:141` — `[...new Set(ids)]`

### Gaps y dudas de Cloe
Sin gaps porque: fix de 2 archivos con logica puntual (anadir metodo + refactorizar 3 lineas), tsc limpio en los archivos tocados, patron bun:sqlite con spread respetado segun MEMORY.md.

Confianza en la implementacion: alta

## Metricas de Cloe
- archivos_leidos: 3 (status.md, agentRepository.ts, handlerLogic.ts lineas 380-430)
- archivos_creados: 0
- archivos_modificados: 2
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

Sin gaps porque: cambio de 15 lineas sin nueva logica de negocio, tsc limpio en archivos tocados, solo sustitucion de N llamadas individuales por una llamada bulk con Map lookup.

---

## Verificacion final de Max

### Checklist Max — [bloques activos: ESTATICO | DB]

## ESTATICO
- [x] Cada archivo del manifiesto verificado con file:line — evidencia: agentRepository.ts:139-153 leido directamente, handlerLogic.ts:385-413 leido directamente
- [x] bun run tsc --noEmit — 0 errores nuevos en agentRepository.ts ni handlerLogic.ts — evidencia: output de tsc no contiene ninguna linea con esos archivos; errores preexistentes en node_modules/electrobun/, scripts/metrics.ts, scripts/verify-monitor.ts, src/db/pipelineRepository.ts, src/db/conversationRepository.ts, src/db/database.ts, src/ipc/acpManager.ts — identicos a los registrados en bugs anteriores (#017, #020)
- [x] Sin logica de negocio rota — evidencia: handleGetPipeline sigue retornando el mismo tipo, el fallback `?? 'Unknown'` permanece, agentsMap.get() es O(1) equivalente funcional a findById()

## DB
- [x] Criterio 2 — Spread de parametros bun:sqlite correcto — evidencia: agentRepository.ts:147 `.all(...uniqueIds)` con spread, NO array wrapeado
- [x] Criterio 3 — Guard para array vacio presente — evidencia: agentRepository.ts:142 `if (uniqueIds.length === 0) return new Map()`
- [x] Criterio 4 — findById ausente del bucle .map() de handleGetPipeline — evidencia: grep de `findById` en handlerLogic.ts — unicas apariciones en lineas 85 (interfaz), 167 (handleGetAgent), 251 (handleDeleteAgent); ninguna dentro de handleGetPipeline (lineas 385-413)
- [x] Criterio 5 — Query IN no se ejecuta si pipeline.steps es vacio — evidencia: agentIds = [] → findByIds([]) → uniqueIds.length === 0 → return new Map() en linea 142, sin llegar a la query
- [x] Criterio 6 — Deduplicacion por Set presente — evidencia: agentRepository.ts:141 `const uniqueIds = [...new Set(ids)]`
- [x] Queries usan prepared statements, sin interpolacion — evidencia: agentRepository.ts:145-147 usa `db.query<AgentRow, string[]>(...)` con placeholders `?` generados dinamicamente; el string SQL solo contiene `?`, no valores interpolados directamente
- [x] No hay migrations involucradas — no aplica nuevo schema

### No verificado por Max
- Verificacion de reduccion real de queries en runtime: requiere entorno de escritorio con Electrobun corriendo.
Confianza en la verificacion: alta

---

## Metricas de Max (verificacion post-fix)
- archivos_leidos: 3 (status.md, agentRepository.ts, handlerLogic.ts:380-430)
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 0 (resuelto)
- items_checklist_verificados: 10/10
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 1 (runtime sin Electrobun)

QA aprobado con gaps conocidos: verificacion de reduccion de queries en runtime no ejecutable sin entorno de escritorio.
