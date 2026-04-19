# T-005 — Limpiar código obsoleto y mover monitor

**Status:** DONE
**Phase:** Fase 0.4
**Agente responsable:** Cloe
**Depende de:** T-004
**Esfuerzo estimado:** 2 días

## Descripción

Mover el monitor interno de desarrollo (`src/monitor/`) a `src/dev-tools/monitor/` para separarlo del producto. Preparar el renderer y los handlers IPC para la nueva estructura de navegación sin romper lo que funciona.

## Solución técnica

**1. Mover monitor a dev-tools**
```
src/monitor/ → src/dev-tools/monitor/
```
Actualizar todos los imports que referencien `src/monitor/`. El monitor sigue funcionando — solo cambia de ubicación.

**2. Preparar renderer para nueva navegación**

El renderer actual tiene navegación centrada en agentes individuales. Añadir el esqueleto de la nueva estructura sin implementar las vistas todavía (eso va en T-009, T-010, T-011):
- `src/renderer/app.ts`: añadir sección "Pipelines" en el sidebar (placeholder, sin funcionalidad)
- Mantener toda la funcionalidad existente (crear agente, chat, settings) intacta

**3. Registrar handlers IPC de pipelines (esqueleto)**

En `src/ipc/handlers.ts`, registrar los nuevos handlers de pipelines devolviendo `{ error: 'not implemented' }` temporalmente. Esto permite que T-006 los implemente sin tocar el archivo de registro.

Handlers a registrar como skeleton:
`createPipeline`, `listPipelines`, `getPipeline`, `updatePipeline`, `deletePipeline`, `executePipeline`, `getPipelineRun`, `listPipelineRuns`, `retryPipelineRun`, `listPipelineTemplates`, `getPipelineTemplate`, `detectLocalProviders`, `validateProviderConnection`

## Criterios de aceptación

- [x] `bun run desktop` arranca sin errores tras mover el monitor
- [x] No hay imports rotos de `src/monitor/` en ningún archivo
- [x] La funcionalidad existente (crear agente, chat, settings) sigue funcionando
- [x] El sidebar muestra una sección "Pipelines" (aunque sea un placeholder)
- [x] Los 13 handlers de pipelines están registrados en `handlers.ts` (aunque devuelvan `not implemented`)

## Subtareas

- [x] Crear `src/dev-tools/` y mover `src/monitor/` a `src/dev-tools/monitor/`
- [x] Buscar y actualizar todos los imports de `src/monitor/` en el codebase
- [x] Actualizar `src/renderer/app.ts` con el esqueleto de navegación de pipelines
- [x] Registrar handlers de pipelines como skeletons en `src/ipc/handlers.ts`
- [x] Verificar que `bun run desktop` arranca sin errores

## Notas

- NO eliminar el monitor — solo moverlo. Sigue siendo útil como herramienta interna del equipo (Leo→Cloe→Max→Ada→Cipher).
- NO implementar ninguna vista de pipeline aquí — solo el esqueleto de navegación. Las vistas van en T-009 y T-010.
- Si algún import del monitor está referenciado en `src/desktop/index.ts`, actualizarlo con cuidado.
