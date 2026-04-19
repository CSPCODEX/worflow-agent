# T-004 — PipelineRunner — motor de ejecución

**Status:** DONE
**Phase:** Fase 0.3
**Agente responsable:** Cloe
**Depende de:** T-002, T-003
**Esfuerzo estimado:** 5 días

## Descripción

Crear `src/ipc/pipelineRunner.ts` — el núcleo del producto. Ejecuta los pasos de un pipeline en orden secuencial, pasando el output de cada paso como input del siguiente, persistiendo el estado en DB en cada paso y emitiendo eventos al renderer.

## Solución técnica

Clase `PipelineRunner` con el ciclo de vida definido en `docs/product/ARCHITECTURE.md` sección 3.1.

**Flujo interno por paso:**
1. Resolver `input_template` reemplazando `{{variable}}` y `{{output_paso_N}}`
2. Crear `step_run` en DB con status `running`
3. Notificar al renderer via callback `onStepStart`
4. Obtener path del agente desde DB → spawn via `acpManager.createSession()`
5. Enviar prompt via `acpManager.sendMessage()`, recibir chunks → `onStepChunk`
6. Al completar: guardar output en DB, `onStepComplete`, cerrar sesión
7. Si error: guardar error en DB, marcar run como `paused`, `onStepError`, return

**Resolución de variables (`resolveInputTemplate`):**
```typescript
function resolveInputTemplate(
  template: string,
  variables: Record<string, string>,
  previousOutputs: Map<number, string>
): string
```
- `{{nombre_variable}}` → valor del usuario
- `{{output_paso_N}}` → output del paso N (1-indexed)

**Gestión de procesos:**
- Un solo agente activo a la vez (secuencial, nunca paralelo)
- El proceso del agente se spawnea al inicio del paso y se cierra al terminar
- Si `stop()` se llama durante ejecución, el paso actual termina y no se inician más

## Criterios de aceptación

- [x] Un pipeline de 3 pasos se ejecuta de punta a punta sin errores
- [x] El output del paso 1 aparece como `{{output_paso_1}}` correctamente resuelto en el paso 2
- [x] Si el paso 2 falla, el pipeline queda con status `paused` y los pasos 1 y 3 con sus estados correctos
- [x] `resume(runId, fromStepIndex)` retoma desde el paso indicado reconstruyendo `previousOutputs` desde DB
- [x] `stop(runId)` detiene la ejecución limpiamente (cierra la sesión ACP activa)
- [x] Los timeouts por paso (120s por defecto) cortan la ejecución con error descriptivo
- [x] El output de cada paso se persiste en DB antes de pasar al siguiente

## Subtareas

- [x] Crear `src/ipc/pipelineRunner.ts` con clase `PipelineRunner`
- [x] Implementar `resolveInputTemplate()` con soporte para variables de usuario y outputs previos
- [x] Implementar `execute()` con el loop secuencial de pasos
- [x] Implementar `resume()` reconstruyendo estado desde DB
- [x] Implementar `stop()` con limpieza de sesión ACP
- [x] Añadir timeout por paso con Promise.race + setTimeout
- [ ] Exponer callbacks: `onStepStart`, `onStepChunk`, `onStepComplete`, `onStepError`, `onPipelineComplete`, `onPipelineError`
- [ ] Instanciar y exportar el runner desde `src/ipc/handlers.ts`

## Notas

- El PipelineRunner no sabe de IPC — solo emite callbacks. Los handlers en `handlers.ts` los convierten en mensajes al renderer.
- `acpManager` ya existe y funciona — reutilizarlo sin modificar.
- Límite de output por paso: 50KB. Si el agente genera más, truncar con aviso (ver SPECIFICATIONS.md sección 5.3).
- No añadir reintentos automáticos en MVP (retryAttempts = 0). El usuario reintenta manualmente.
