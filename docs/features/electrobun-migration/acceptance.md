# Criterios de aceptación — Electrobun Migration

## `src/types/ipc.ts`
- [ ] Todos los tipos son serializables a JSON
- [ ] No importa nada de Node.js ni de Electrobun
- [ ] `AgentConfig` se reutiliza de `src/cli/prompts.ts`, no se duplica
- [ ] Todos los canales RPC tienen tipos para params y retorno

## `src/generators/agentGenerator.ts` (adaptado)
- [ ] `generateAgentCore(config, baseDir)` existe y opera sin output en consola
- [ ] `generateAgent` (terminal) sigue funcionando exactamente igual
- [ ] `bun run dev` produce el mismo resultado que antes del cambio

## `src/ipc/acpManager.ts`
- [ ] Gestiona múltiples sesiones activas simultáneamente (Map por sessionId)
- [ ] `closeSession` termina el proceso hijo limpiamente
- [ ] `closeAll` termina todos los procesos al cerrar la app
- [ ] Los chunks de texto llegan al renderer en tiempo real (streaming)
- [ ] No quedan procesos zombie al cerrar sesiones

## `src/ipc/handlers.ts`
- [ ] Los 4 handlers registrados: `generateAgent`, `listAgents`, `createSession`, `sendMessage`
- [ ] Todos validan params antes de operar en file system o spawn
- [ ] Errores capturados y retornados como `{ success: false, error }`, nunca lanzados
- [ ] `listAgents` detecta correctamente agentes en el directorio raíz

## `src/main.ts`
- [ ] Crea ventana Electrobun de mínimo 1200x800
- [ ] Registra todos los handlers antes de mostrar la ventana
- [ ] Llama `acpManager.closeAll()` al evento de cierre de la app

## `electrobun.config.ts` + `package.json`
- [ ] `bun run desktop` arranca la app Electrobun en modo dev
- [ ] `bun run dev` y `bun run chat` siguen funcionando sin cambios
- [ ] `bunx electrobun build` genera el bundle sin errores

## `src/renderer/` (UI completa)
- [ ] Sidebar muestra lista de agentes al arrancar
- [ ] Formulario valida inputs con `src/cli/validations.ts` antes de invocar IPC
- [ ] Crear agente nuevo actualiza la sidebar automáticamente
- [ ] Chat muestra la respuesta en streaming (chunk a chunk, no al final)
- [ ] Estado de carga visible mientras el agente responde
- [ ] Error visible en UI si LM Studio no está disponible
- [ ] Navegación entre vistas sin recargar la ventana
- [ ] Funciona completamente offline
