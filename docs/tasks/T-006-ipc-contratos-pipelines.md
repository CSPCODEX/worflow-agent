# T-006 — Contratos IPC para pipelines

**Status:** TODO
**Phase:** Fase 1
**Agente responsable:** Cloe
**Depende de:** T-002
**Esfuerzo estimado:** 2 días

## Descripción

Actualizar `src/types/ipc.ts` con los tipos TypeScript de todos los handlers de pipelines e implementar la lógica real en `src/ipc/handlerLogic.ts`. Los handlers ya están registrados como skeletons desde T-005.

## Solución técnica

**1. Actualizar `src/types/ipc.ts`**

Añadir al tipo `AppRPC`:
- En `bun.requests`: todos los handlers de pipeline listados en `docs/product/SPECIFICATIONS.md` sección 7.2
- En `webview.messages`: `pipelineRunStepUpdated` y `pipelineRunCompleted`

Crear `src/types/pipeline.ts` con los tipos de dominio:
```typescript
interface Pipeline, PipelineStep, PipelineRun, PipelineStepRun,
PipelineTemplate, TemplateVariable, TemplateStep
```

**2. Implementar lógica en `src/ipc/handlerLogic.ts`**

Añadir funciones para cada handler:
- `handleCreatePipeline` → llama a `pipelineRepository.createPipeline()`
- `handleListPipelines` → llama a `pipelineRepository.listPipelines()`
- `handleGetPipeline` → llama a `pipelineRepository.getPipeline()`
- `handleUpdatePipeline` → llama a `pipelineRepository.updatePipeline()`
- `handleDeletePipeline` → llama a `pipelineRepository.deletePipeline()`
- `handleExecutePipeline` → crea run en DB, lanza `pipelineRunner.execute()` async, retorna runId
- `handleGetPipelineRun` → llama a `pipelineRunRepository.getRun()`
- `handleListPipelineRuns` → llama a `pipelineRunRepository.listRuns()`
- `handleRetryPipelineRun` → llama a `pipelineRunner.resume()`
- `handleListPipelineTemplates` → llama a `pipelineTemplateRepository.listTemplates()`
- `handleGetPipelineTemplate` → llama a `pipelineTemplateRepository.getTemplate()`
- `handleDetectLocalProviders` → ping a localhost:1234 y localhost:11434
- `handleValidateProviderConnection` → request de validación al provider

**3. Conectar callbacks del PipelineRunner con mensajes al renderer**

En `handlers.ts`, cuando se ejecuta un pipeline, registrar los callbacks del runner para emitir `pipelineRunStepUpdated` y `pipelineRunCompleted` al webview.

## Criterios de aceptación

- [ ] `src/types/ipc.ts` compila sin errores con todos los tipos de pipeline añadidos
- [ ] `src/types/pipeline.ts` existe con todos los tipos de dominio
- [ ] `handleExecutePipeline` lanza la ejecución async y retorna `runId` inmediatamente
- [ ] `pipelineRunStepUpdated` se emite al renderer cuando un paso cambia de estado
- [ ] `pipelineRunCompleted` se emite al renderer cuando el pipeline termina
- [ ] `handleDetectLocalProviders` retorna disponibilidad real de LM Studio y Ollama

## Subtareas

- [ ] Crear `src/types/pipeline.ts` con todos los tipos de dominio
- [ ] Actualizar `src/types/ipc.ts` añadiendo requests y messages de pipeline
- [ ] Implementar todos los `handle*` en `src/ipc/handlerLogic.ts`
- [ ] Actualizar `handlers.ts` para reemplazar skeletons con implementaciones reales
- [ ] Conectar callbacks del PipelineRunner a mensajes webview en `handlers.ts`
- [ ] Implementar `handleDetectLocalProviders` con fetch + AbortSignal.timeout(3000)

## Notas

- `handleExecutePipeline` es async fire-and-forget: lanza el runner y retorna el runId inmediatamente. El renderer se actualiza via mensajes push, no polling.
- Los contratos exactos están en `docs/product/SPECIFICATIONS.md` sección 7.1. Seguirlos al pie de la letra para que el renderer los pueda consumir sin cambios.
