# T-002 — Repositorios CRUD para tablas de pipelines

**Status:** TODO
**Phase:** Fase 0.1
**Agente responsable:** Cloe
**Depende de:** T-001
**Esfuerzo estimado:** 3 días

## Descripción

Crear los 3 repositorios que encapsulan el acceso a las nuevas tablas de pipelines, siguiendo el mismo patrón que `src/db/agentRepository.ts` y `src/db/conversationRepository.ts`.

## Solución técnica

Crear 3 archivos nuevos en `src/db/`:

**`pipelineTemplateRepository.ts`** — CRUD para `pipeline_templates`
- `listTemplates()` → array de templates con stepCount calculado
- `getTemplate(id)` → template completo con variables y steps parseados desde JSON
- `createTemplate(data)` → insert, retorna id
- `deleteTemplate(id)` → solo para templates no builtin

**`pipelineRepository.ts`** — CRUD para `pipelines` y `pipeline_steps`
- `listPipelines()` → array con stepCount y lastRun agregados
- `getPipeline(id)` → pipeline con steps ordenados por step_order
- `createPipeline(data)` → insert pipeline + steps en transacción
- `updatePipeline(id, data)` → update pipeline + reemplazar steps en transacción
- `deletePipeline(id)` → cascade borra steps y runs

**`pipelineRunRepository.ts`** — CRUD para `pipeline_runs` y `pipeline_step_runs`
- `createRun(pipelineId, variables)` → insert run con status='pending', retorna id
- `getRun(id)` → run completo con step_runs ordenados
- `listRuns(pipelineId, limit, offset)` → paginado
- `updateRunStatus(id, status, error?)` → update status
- `createStepRun(runId, stepId, stepOrder, agentName)` → insert
- `updateStepRun(id, status, output?, error?)` → update

Todos los métodos reciben la instancia `db` de SQLite como parámetro (igual que los repos existentes).

## Criterios de aceptación

- [ ] `pipelineTemplateRepository.ts` exporta todas las funciones listadas
- [ ] `pipelineRepository.ts` exporta todas las funciones listadas
- [ ] `pipelineRunRepository.ts` exporta todas las funciones listadas
- [ ] Las operaciones de create/update/delete que afectan a múltiples tablas usan transacciones
- [ ] `listPipelines()` devuelve `stepCount` correcto (query con COUNT + JOIN)
- [ ] `getPipeline()` devuelve los steps ordenados por `step_order`
- [ ] Los campos JSON (`variables`, `steps` en pipeline_templates) se serializan/deserializan correctamente

## Subtareas

- [ ] Crear `src/db/pipelineTemplateRepository.ts`
- [ ] Crear `src/db/pipelineRepository.ts` con transacciones para create/update
- [ ] Crear `src/db/pipelineRunRepository.ts`
- [ ] Importar y exponer los repos desde `src/db/database.ts` (o donde se inicializa la DB)

## Notas

- Seguir el patrón de `agentRepository.ts`: funciones puras que reciben `db`, sin estado global.
- Las transacciones en Bun SQLite se hacen con `db.transaction(() => { ... })()`.
- `variables` en `pipeline_templates` se guarda como `JSON.stringify(array)` y se lee con `JSON.parse`.
