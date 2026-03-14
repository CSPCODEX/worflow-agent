# Memoria de Leo — Arquitecto y PM

## Decisiones de arquitectura tomadas

### Electrobun es capa adicional, no reemplazo del CLI
- `bun run dev` y `bun run chat` permanecen intactos
- `src/index.ts` y `src/client.ts` NO se tocan
- El modo TTY interactivo de los agentes generados NO se toca
- Justificacion: el usuario lo pidio explicitamente y es la decision correcta — reutilizar

### generateAgentCore — separacion de logica pura
- `agentGenerator.ts` exporta `generateAgentCore(config, baseDir)` sin dependencias de terminal
- `generateAgent` (existente) sigue usando @clack/prompts y llama a generateAgentCore internamente
- El main process de Electrobun usa generateAgentCore directamente

### IPC tipado con 4 canales base + expansiones
- `generateAgent`, `listAgents`, `createSession`, `sendMessage` — canales base
- Nuevos canales de persistencia: `createConversation`, `listConversations`, `getMessages`, `saveMessage`, `deleteConversation`
- Canal nuevo multi-provider: `listProviders`
- Canal nuevo delete: `deleteAgent`
- Todos tipados en `src/types/ipc.ts`

### ACPManager como clase singleton
- Map de sesiones activas: sessionId -> { process, connection, acpSessionId, agentName }
- agentName se almacena en Session para permitir busqueda inversa por nombre
- Cleanup de procesos al cerrar sesion o cerrar app
- Emite eventos al renderer: agentMessageChunk, agentError
- `createSession(agentName, agentPath)` — recibe path absoluto desde DB, no compone con process.cwd()
- `closeSessionByAgentName(agentName)` — busqueda inversa en el Map, usado por deleteAgent handler

### Persistencia — userDataDir + bun:sqlite
- `src/db/userDataDir.ts` — directorio fijo multiplataforma, constantes exportadas
- `src/db/database.ts` — singleton bun:sqlite con queries tipadas
- `src/db/migrations.ts` — migrations append-only, version incremental
- Filesystem = fuente de verdad para ejecutables; DB = indice e historial
- Agentes con path inexistente → status 'broken', no crashea
- Migrations siempre idempotentes: CREATE TABLE IF NOT EXISTS; ALTER TABLE para columnas nuevas

### Background tasks en handlers IPC — patron establecido
- Tareas lentas (bun install, LM Studio calls) se lanzan sin await despues del return del handler
- Siempre se termina con `.catch((e) => console.error(...))` para no crashear el proceso
- El renderer es notificado mediante `rpc.send.<evento>` al completarse
- Multiples tareas en background se lanzan en paralelo (no en secuencia)
- Coordinacion en el renderer: flags booleanos (`installDone`, `enhanceDone`) + funcion `tryNavigate()`

### Enhancer de prompts — src/enhancer/
- Modulo independiente en `src/enhancer/` con 4 archivos
- Orquestador `promptEnhancer.ts` nunca lanza — siempre resuelve con `{ enhancedPrompt, strategy }`
- Estrategias: 'lmstudio' | 'static' | 'failed'
- Timeout LM Studio: 15 segundos via `Promise.race`
- `enhance_status` en DB: 'pending' → 'done' | 'static' | 'failed'
- Reescritura de index.ts: regex sobre linea `const SYSTEM_PROMPT = "..."`, no re-render del template

### Multi-provider LLM — Strategy Pattern
- Interfaz `LLMProvider` con `chat()` y `chatStream()` — definida en `providers/types.ts` del agente generado
- Factory `createProvider()` lee `process.env.PROVIDER` y retorna la implementacion correcta
- 5 proveedores: lmstudio, ollama, openai, anthropic, gemini
- Todos los archivos de providers se copian siempre al agente — usuario cambia de provider editando solo .env
- Factory usa imports dinamicos para evitar cargar SDKs no usados
- Ollama no requiere SDK externo — usa fetch nativo de Bun (HTTP localhost:11434)
- El enhancer (src/enhancer/) NO se modifica — sigue usando LM Studio del host, es independiente del provider del agente
- AgentConfig tiene campo `provider: ProviderId` — se propaga automaticamente a todos los call-sites de scaffoldAgent
- DB: columna `provider TEXT DEFAULT 'lmstudio'` — migration v3 — agentes existentes son backward compat

### Delete agent — patron de borrado
- Orden: cerrar sesion ACP → rmSync filesystem (best-effort, loguear si falla) → DELETE DB
- `agentRepository.delete(id)` ya existe — hace CASCADE a conversations y messages via FK
- `window.confirm` bloqueado en Electrobun — confirmacion siempre via modal HTML en webview
- Modal inyectado en `document.body`, listener Escape limpiado al cerrar
- Evento DOM `agent:deleted` (patron igual a `agent:created`)
- `activeAgentName: string | null` en app.ts para detectar si el agente eliminado esta en chat

## Especificaciones entregadas

### [ENTREGADO] Plan de migracion a Electrobun — Estado: pendiente implementacion por Cloe
### [ENTREGADO] Plan de persistencia SQLite + userDataDir — Estado: listo para Cloe
### [ENTREGADO] Plan de prompt-enhancement — Estado: listo para Cloe
### [ENTREGADO] Plan de multi-provider-support — Estado: listo para Cloe
### [ENTREGADO] Plan de delete-agent — Estado: listo para Cloe

## Patrones y convenciones definidas

- Tipos IPC: no importan Node.js, solo tipos serializables a JSON
- Handlers IPC: siempre async, siempre capturan errores, nunca lanzan excepciones al renderer
- Nombres de canales RPC: camelCase descriptivo
- Renderer: sin imports de Node.js, sin frameworks pesados salvo que se justifique
- Validacion: usar src/cli/validations.ts existente en el renderer antes de invocar IPC
- Orden en handlers que crean recursos: validar → verificar duplicado en DB → crear filesystem → insertar DB
- Orden en handlers que destruyen recursos: validar → verificar en DB → cerrar sesiones activas → borrar filesystem → borrar DB
- Si una operacion falla tras crear un directorio, intentar limpiar filesystem (best-effort)
- DB queries: siempre prepared statements, nunca interpolacion de strings
- Eventos DOM en renderer: kebab-case con prefijo de dominio (agent:install-done, agent:enhance-done, agent:deleted)
- Listeners DOM: registrar ANTES del RPC call, eliminar al recibir el evento (sin memory leaks)
- Handlers IPC estaticos (listas hardcodeadas, sin I/O): retornan directamente sin async complejo

## Contexto acumulado del proyecto

- Stack: Bun + TypeScript + Electrobun + @agentclientprotocol/sdk + @lmstudio/sdk + bun:sqlite (built-in)
- Los agentes generados tienen modo TTY (terminal interactiva) Y modo ACP (subproceso)
- El cliente ACP en src/client.ts es la referencia para implementar acpManager.ts
- AgentConfig definido en src/cli/prompts.ts: { name, description, role, needsWorkspace, provider }
- Templates en src/templates/basic-agent/ con placeholders {{KEY}}
- Agentes generados tienen subcarpeta providers/ con 7 archivos (types, factory, 5 impls)
- Entrypoint del desktop: src/desktop/index.ts (no src/main.ts)
- package.json raiz tenia dependencia @google/generative-ai huerfana — ya usada en gemini.ts.tpl del agente
- index.ts de agentes generados: SYSTEM_PROMPT esta en linea `const SYSTEM_PROMPT = "...";`

## Pendientes y proximos pasos

- Cloe implementa delete-agent segun docs/features/delete-agent/status.md
- Max verifica cada componente con su checklist
- Ada limpia si hay dependencias huerfanas
- Cipher audita IPC handlers (validacion de inputs) y spawn de procesos antes del release
