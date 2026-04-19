# T-010 — UI — Vista de ejecución en tiempo real

**Status:** TODO
**Phase:** Fase 1
**Agente responsable:** Cloe
**Depende de:** T-009, T-004
**Esfuerzo estimado:** 4 días

## Descripción

Implementar las vistas de ejecución de pipeline (en tiempo real, paso a paso) y de resultados finales. El usuario debe ver qué paso está ejecutándose, el output en streaming, y el resultado completo al finalizar.

## Solución técnica

Crear en `src/renderer/views/`:

**`pipeline-execution.ts`** — Vista de ejecución activa

Flujo al ejecutar:
1. Modal "Variables requeridas": inputs para cada variable del template (nombre, valor)
2. Click "Ejecutar" → `executePipeline(pipelineId, variables)` IPC → recibe `runId`
3. Escuchar mensajes push del main process:
   - `pipelineRunStepUpdated` → actualizar estado del paso (pendiente/ejecutando/completado/error)
   - `pipelineRunCompleted` → navegar a `pipeline-results.ts`

UI durante ejecución:
```
┌─ Paso 1: Investigador ── COMPLETADO ────────────┐
│  [Output expandible/colapsable]                  │
└──────────────────────────────────────────────────┘
┌─ Paso 2: Redactor ── EJECUTANDO... ─────────────┐
│  [Output en streaming, texto aparece en tiempo real] │
└──────────────────────────────────────────────────┘
┌─ Paso 3: Revisor ── PENDIENTE ──────────────────┐
│                                                  │
└──────────────────────────────────────────────────┘
[Detener ejecución]
```

**`pipeline-results.ts`** — Vista de resultado final

- Output final completo (texto del último paso)
- Botones: "Copiar al portapapeles", "Re-ejecutar"
- Sección "Ver pasos intermedios": expandible con output de cada paso
- Si el pipeline falló: muestra qué paso falló, el error, y botón "Reintentar desde este paso"

**`pipeline-history.ts`** — Historial de ejecuciones

- Tabla de ejecuciones de un pipeline: fecha, status, variables usadas
- Click en ejecución → navega a `pipeline-results.ts` en modo histórico (read-only)
- Paginación básica (limit/offset)

## Criterios de aceptación

- [ ] El modal de variables aparece antes de ejecutar (si el template tiene variables)
- [ ] La vista de ejecución se actualiza en tiempo real sin polling (via mensajes push)
- [ ] El output de cada paso aparece en streaming mientras el agente responde
- [ ] El paso actual muestra un indicador visual de "ejecutando" (spinner o animación)
- [ ] Al completar todos los pasos, se navega automáticamente a la vista de resultados
- [ ] "Copiar al portapapeles" copia el output final correctamente
- [ ] Si un paso falla, se muestra el error y el botón "Reintentar desde este paso"
- [ ] "Reintentar desde este paso" llama a `retryPipelineRun` IPC
- [ ] El historial muestra las últimas ejecuciones del pipeline

## Subtareas

- [ ] Crear `src/renderer/views/pipeline-execution.ts` con modal de variables y vista de pasos
- [ ] Implementar escucha de mensajes push `pipelineRunStepUpdated` y `pipelineRunCompleted`
- [ ] Crear `src/renderer/views/pipeline-results.ts` con output final y pasos intermedios
- [ ] Crear `src/renderer/views/pipeline-history.ts` con tabla de ejecuciones
- [ ] Implementar streaming de output en tiempo real (acumular chunks del `pipelineRunStepUpdated`)
- [ ] Añadir "Copiar al portapapeles" con `navigator.clipboard.writeText()`
- [ ] Actualizar `src/renderer/style.css` con estilos para estados de pasos (pendiente/ejecutando/completado/error)

## Notas

- Los mensajes push del main process ya están definidos en `src/types/ipc.ts` (T-006): `pipelineRunStepUpdated` incluye el chunk de texto para el streaming.
- El output truncado (>50KB) se muestra con aviso "Output truncado" + botón "Ver completo" que llama a `getPipelineRun` para el output completo desde DB.
- "Detener ejecución" llama a `stopPipelineRun` IPC (añadir handler si no existe).
