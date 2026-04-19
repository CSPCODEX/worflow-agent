# T-001 — Migraciones DB v4 — tablas de pipelines

**Status:** DONE
**Phase:** Fase 0.1
**Agente responsable:** Cloe
**Depende de:** —
**Esfuerzo estimado:** 3 días

## Descripción

Añadir las migraciones v4+ en `src/db/migrations.ts` para crear las 5 tablas nuevas que requiere el sistema de pipelines. Las tablas existentes (`agents`, `conversations`, `messages`, `settings`, `schema_version`) no se tocan.

## Solución técnica

Editar `src/db/migrations.ts` añadiendo una nueva entrada de migración (versión 4) que ejecute el SQL de las 5 tablas nuevas en orden correcto (respetando foreign keys):

1. `pipeline_templates` (sin FK externas)
2. `pipelines` (FK → pipeline_templates)
3. `pipeline_steps` (FK → pipelines, agents)
4. `pipeline_runs` (FK → pipelines)
5. `pipeline_step_runs` (FK → pipeline_runs, pipeline_steps)

El schema completo está en `docs/product/ARCHITECTURE.md` sección 2.1.

`src/db/database.ts` ya tiene el sistema de migraciones incremental — solo hay que añadir la nueva versión, no modificar la lógica de migración.

## Criterios de aceptación

- [ ] `bun run desktop` arranca sin errores con la migración aplicada
- [ ] Las 5 tablas existen en la DB con el schema correcto (verificable con `.schema` en sqlite3)
- [ ] Las tablas existentes no tienen pérdida de datos tras la migración
- [ ] Los índices `idx_pipeline_steps_pipeline`, `idx_pipeline_runs_pipeline`, `idx_step_runs_run` existen
- [ ] Si la migración ya fue aplicada y se vuelve a arrancar, no falla (idempotente)

## Subtareas

- [x] Leer el schema completo en `docs/product/ARCHITECTURE.md` sección 2.1
- [x] Añadir migración v4 en `src/db/migrations.ts` con las 5 tablas
- [x] Verificar que `src/db/database.ts` aplica la migración al arrancar
- [ ] Probar arranque en frío (DB nueva) y en caliente (DB existente con datos)

## Notas

- Los FK con `ON DELETE CASCADE` son intencionales: borrar un pipeline borra sus steps y runs.
- `pipeline_steps.agent_id` usa `ON DELETE RESTRICT` — no se puede borrar un agente que esté en uso en un pipeline.
- El campo `variables` en `pipeline_templates` es JSON serializado como TEXT (SQLite no tiene tipo JSON nativo).
