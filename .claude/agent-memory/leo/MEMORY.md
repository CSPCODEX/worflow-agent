# Memoria de Leo — Arquitecto y PM

## Pivot de producto (2026-04-19)

El proyecto pivota de "generador de agentes CLI+desktop" a "plataforma de orquestacion multi-agente para usuarios no tecnicos". Documentacion completa en `docs/product/`.

### Decisiones de arquitectura del pivot
- **PipelineRunner**: ejecucion secuencial, 1 agente a la vez, spawn/kill por paso (libera memoria en hardware modesto)
- **Templates predefinidos**: 4 templates (content-creator, code-review, data-analyst, translator) como JSON en DB
- **Agentes como roles**: tabla `agents` existente sirve como biblioteca de roles reutilizables. Campo `isDefault` para los 6 agentes preinstalados
- **Renderer vanilla TS**: sin framework — UI no es suficientemente compleja, bundle pequeno es critico
- **Monitor de desarrollo se mueve** a `src/dev-tools/monitor/` — no se elimina, se reubica
- **Nuevas tablas**: pipeline_templates, pipelines, pipeline_steps, pipeline_runs, pipeline_step_runs (migracion v4+)
- **Resolucion de variables**: `{{var}}` para inputs del usuario, `{{output_paso_N}}` para outputs de pasos anteriores
- **Provider global por defecto**, override por agente en V1 (no en MVP)
- **Deteccion automatica** de LM Studio/Ollama al iniciar — ping HTTP/WS con timeout de 3s

## Patrones de arquitectura estables (pre-pivot, siguen vigentes)

### Electrobun — modelo de proceso y IPC
- Main process: `src/desktop/index.ts`, renderer: `src/renderer/app.ts`
- IPC tipado via `defineElectrobunRPC<AppRPC>()` en `src/types/ipc.ts`
- Handlers: siempre async, nunca lanzan excepciones al renderer, siempre retornan `{ success, error? }`
- Background tasks: lanzar sin await + `.catch()` + notificar renderer via `rpc.send.evento`
- CSP critica: `connect-src ws://localhost:*` — Electrobun usa WS en puerto dinamico
- `closeDevTools()` en produccion — no hay config de Electrobun para deshabilitarlo

### ACP Manager — gestion de sesiones
- Singleton `acpManager` en `src/ipc/acpManager.ts`
- `createSession(agentName, agentPath)` — recibe path absoluto desde DB
- Streaming: chunks via callback → `rpc.send.agentMessageChunk` → CustomEvent en renderer
- Cleanup: `closeAll()` en `process.on('exit')`

### Base de datos — SQLite con migraciones
- WAL mode + foreign keys ON en `src/db/database.ts`
- Migraciones incrementales en `src/db/migrations.ts` (actualmente v1-v3)
- Repositorios con queries tipadas: agentRepository, conversationRepository, settingsRepository
- `userDataDir.ts` — directorio fijo multiplataforma

### Generador de agentes — reutilizado sin cambios
- `scaffoldAgent()` + `installAgentDeps()` en `src/generators/agentGenerator.ts`
- Templates en `src/templates/basic-agent/` con `{{KEY}}` placeholders
- 5 providers: lmstudio, ollama, openai, anthropic, gemini via factory pattern
- CLI (`bun run dev`, `bun run chat`) permanece intacto

### Renderer — convenciones de UI
- Sin frameworks, TypeScript vanilla
- Vistas exportan `{ cleanup(): void }` — llamada en teardown
- Eventos DOM: kebab-case con prefijo (agent:chunk, agent:end, pipeline:step-updated)
- CSS por componente, sin colisiones de clases

## Contratos IPC clave (existentes)

Los handlers actuales (generateAgent, listAgents, createSession, sendMessage, etc.) NO cambian. Se anaden handlers nuevos para pipelines. Ver `docs/product/SPECIFICATIONS.md` seccion 7.

## Contexto del proyecto

- Stack: Bun + TypeScript + Electrobun + @agentclientprotocol/sdk + bun:sqlite
- Agentes generados: modo TTY + modo ACP, providers en subcarpeta providers/
- Entrypoint desktop: `src/desktop/index.ts`
- El monitor de pipeline (src/monitor/) es meta-herramienta interna, no producto final
