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
- Canales nuevos settings: `loadSettings`, `saveSettings`
- Canales nuevos monitor v1: `getPipelineSnapshot` (request) + `pipelineSnapshotUpdated` (push message)
- Canales nuevos monitor v2 (historial): `getHistory` (request) + `getAgentTrends` (request)
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

### Settings — tabla `settings` ya existente en migration v1
- Tabla `settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)` creada en migration v1 — NO requiere migration nueva
- `src/db/settingsRepository.ts` — CRUD con defaults hardcodeados en el codigo, no en DB
- Patron de defaults: el repositorio retorna el default si la fila no existe (no se insertan defaults en DB al arrancar)
- Claves definidas: `lmstudio_host` (default `ws://127.0.0.1:1234`), `enhancer_model` (default `""`)
- `dataDir` se expone en loadSettings como campo readonly derivado de USER_DATA_DIR — NO se persiste en settings
- Handlers: `loadSettings` (sync, siempre resuelve con defaults si DB falla) y `saveSettings` (sync, validacion de inputs)
- loadSettings/saveSettings NO son fire-and-forget — son operaciones sincronas sin subprocesos externos

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
- `lmStudioEnhancer.ts` usa `LMStudioClient({ baseUrl: host })` donde host viene de settingsRepository — NO hardcodeado

### Multi-provider LLM — Strategy Pattern
- Interfaz `LLMProvider` con `chat()` y `chatStream()` — definida en `providers/types.ts` del agente generado
- Factory `createProvider()` lee `process.env.PROVIDER` y retorna la implementacion correcta
- 5 proveedores: lmstudio, ollama, openai, anthropic, gemini
- Todos los archivos de providers se copian siempre al agente — usuario cambia de provider editando solo .env
- Factory usa imports dinamicos para evitar cargar SDKs no usados
- Ollama no requiere SDK externo — usa fetch nativo de Bun (HTTP localhost:11434)
- El enhancer (src/enhancer/) usa LM Studio del host via settings — independiente del provider del agente
- AgentConfig tiene campo `provider: ProviderId` — se propaga automaticamente a todos los call-sites de scaffoldAgent
- DB: columna `provider TEXT DEFAULT 'lmstudio'` — migration v3 — agentes existentes son backward compat

### Delete agent — patron de borrado
- Orden: cerrar sesion ACP → rmSync filesystem (best-effort, loguear si falla) → DELETE DB
- `agentRepository.delete(id)` ya existe — hace CASCADE a conversations y messages via FK
- `window.confirm` bloqueado en Electrobun — confirmacion siempre via modal HTML en webview
- Modal inyectado en `document.body`, listener Escape limpiado al cerrar
- Evento DOM `agent:deleted` (patron igual a `agent:created`)
- `activeAgentName: string | null` en app.ts para detectar si el agente eliminado esta en chat

### Reduccion de superficie IPC — patron de seguridad (remove-agentdir-ipc)
- Los payloads de eventos IPC al renderer NO deben incluir rutas de filesystem internas
- Regla: si el renderer no consume un campo, ese campo no viaja en el canal IPC
- Cuando una funcion interna necesita un dato (ej. `agentDir` para `rewriteAgentIndexTs`) pero ese dato
  no debe exponerse al renderer, el dato permanece como parametro de funcion y se omite solo del objeto
  literal que se pasa a `rpcSend`. No se refactoriza la firma de la funcion interna.
- Excepcion: `dataDir` en loadSettings se expone al renderer como campo informativo readonly — aceptable
  porque es el directorio de datos de la app (no una ruta de agente individual)

### DevTools y CSP en Electrobun — limitaciones conocidas
- Electrobun NO tiene opcion de constructor para deshabilitar DevTools (no hay `devTools: false`)
- El unico mecanismo es llamar `win.webview.closeDevTools()` en runtime despues de crear la ventana
- Patron: `if (process.env.NODE_ENV === 'production') { win.webview.closeDevTools(); }`
- `process.env.NODE_ENV` se inyecta en tiempo de build via `build.bun.define` en `electrobun.config.ts`
- `closeDevTools()` no impide que el usuario lo reabra manualmente — es limitacion del framework
- CSP critico: Electrobun IPC usa `ws://localhost:<puerto>` (50000-65535) — SIEMPRE incluir `connect-src ws://localhost:*`
- El renderer NO debe tener `connect-src http://localhost:*` — toda comunicacion con LLMs va via IPC al main process
- CSP base correcta para apps Electrobun: `default-src 'none'; script-src 'self'; style-src 'self'; connect-src ws://localhost:*;`

### Monitor de pipeline — modulo autocontenido (monitor-pipeline-agentes)
- Vive en `src/monitor/` con subcarpetas `core/`, `ui/`, `index.ts`
- `core/*.ts` NO importan nada fuera de `src/monitor/` — solo `node:fs`, `node:path`, `bun:sqlite`, y tipos internos
- `ui/monitor-view.ts` importa SOLO tipos de `src/types/ipc.ts` — unico acoplamiento aceptado con el host
- API publica unica: `src/monitor/index.ts` — el host solo importa desde aqui
- `monitor.track(event)` es no-op en v1 — API declarada para v2
- Fuente de datos: `docs/features/*/status.md` y `docs/bugs/*/status.md` leidos via `node:fs`
- Estrategia: polling cada 30s (no file watcher) — mas portable, suficiente para handoffs
- `PipelinePoller` tiene `start()`, `stop()`, `getSnapshot()`, `forceRefresh()`, `onSnapshot(cb)`
- `poller.start()` se llama en el SCOPE del modulo en handlers.ts — NO dentro de un handler IPC
- `poller.stop()` se llama en `process.on('exit')` en `src/desktop/index.ts` junto a `acpManager.closeAll()`
- Snapshots internos tienen `filePath` en `FeatureRecord` y `BugRecord` — este campo NUNCA viaja por IPC
- `snapshotToIPC()` en handlers.ts omite `filePath` via destructuring `{ filePath: _fp, ...rest }`
- `parseErrors[]` en snapshot deben sanitizarse a ASCII antes de viajar por IPC: `.replace(/[^\x20-\x7E]/g, '?')`
- UI: 3 tabs (Pipeline, Agentes, Errores). CSS con prefijo `.monitor-` para evitar colisiones con style.css
- `updateSnapshot()` en monitor-view.ts es incremental — NO hace re-render completo del container
- El monitor es una herramienta de desarrollo: docs/ no existe en el bundle de produccion → snapshot vacio
- `process.cwd()` para resolver `docs/` desde handlers.ts: correcto en dev, no en produccion (comportamiento aceptable)
- Monitor-styles.css se copia al build via `electrobun.config.ts > build.copy`

### Monitor historial SQLite — extension del modulo monitor (monitor-historial-metricas)
- Decision: persistir eventos de cambio (deltas), NO snapshots completos — snapshots cada 30s generan datos redundantes masivos
- Un evento = un cambio detectado: `feature_state_changed | bug_state_changed | handoff_completed | metrics_updated`
- La DB del historial vive en `path.join(USER_DATA_DIR, 'monitor-history.db')` — decidido por el host, no por el modulo
- `MonitorConfig` extiende con `historyDbPath?: string` — opcional, degradacion graceful si ausente o si falla init
- `historyDb.ts` es un singleton propio del modulo — completamente independiente de `src/db/database.ts`
- Migraciones del historial embebidas en `historyDb.ts::applyHistoryMigrations()` — NO en `src/db/migrations.ts`
- `changeDetector.ts` es una funcion pura — no toca la DB, solo compara dos snapshots y retorna eventos
- Orden en `poller.scan()`: detectChanges(prev, curr) ANTES de actualizar `this.cachedSnapshot`
- `getHistory` y `getAgentTrends` son queries SQLite sincronas — NO fire-and-forget
- Los handlers de historial validan params contra whitelist antes de pasar a queryHistory (seguridad)
- UI: tab 4 "Historial" con tabla de eventos + indicadores de tendencia en cards de agentes existentes
- Sin graficos SVG/Canvas — tablas filtradas responden todas las preguntas de tendencias
- `getHistoryDb` se exporta desde `src/monitor/index.ts` (no desde core/) para mantener API publica del modulo

## Especificaciones entregadas

### [ENTREGADO] Plan de migracion a Electrobun — Estado: pendiente implementacion por Cloe
### [ENTREGADO] Plan de persistencia SQLite + userDataDir — Estado: listo para Cloe
### [ENTREGADO] Plan de prompt-enhancement — Estado: listo para Cloe
### [ENTREGADO] Plan de multi-provider-support — Estado: listo para Cloe
### [ENTREGADO] Plan de delete-agent — Estado: listo para Cloe
### [ENTREGADO] Plan de remove-agentdir-ipc — Estado: listo para Cloe
### [ENTREGADO] Plan de devtools-csp-produccion — Estado: listo para Cloe
### [ENTREGADO] Plan de settings-panel — Estado: listo para Cloe
### [ENTREGADO] Plan de monitor-pipeline-agentes — Estado: listo para Cloe
### [ENTREGADO] Plan de monitor-historial-metricas — Estado: listo para Cloe

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
- Eventos DOM en renderer: kebab-case con prefijo de dominio (agent:install-done, agent:enhance-done, agent:deleted, monitor:snapshot)
- Listeners DOM: registrar ANTES del RPC call, eliminar al recibir el evento (sin memory leaks)
- Handlers IPC estaticos (listas hardcodeadas, sin I/O): retornan directamente sin async complejo
- Payloads IPC: solo incluir campos que el renderer REALMENTE consume — omitir rutas internas, IDs internos, etc.
- NODE_ENV en produccion: inyectar via `build.bun.define: { 'process.env.NODE_ENV': '"production"' }` en electrobun.config.ts
- Vistas renderer: exportan `{ cleanup(): void }` — se llama en `teardownCurrentView()` antes de montar la siguiente vista
- Settings handlers: no son fire-and-forget — son sync; no se necesita notificacion push al renderer
- Modulos autocontenidos (monitor): cero imports hacia fuera de su carpeta, API publica via index.ts, integracion via inyeccion en el host
- Handlers de consulta SQLite (getHistory, getAgentTrends): sync, no fire-and-forget — SQLite bun:sqlite es I/O sincrono
- Extensiones de modulo autocontenido: nuevos archivos van en src/monitor/core/, nuevos exports van en src/monitor/index.ts

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
- Electrobun IPC: WebSocket en localhost puerto dinamico (50000-65535) — afecta CSP del renderer
- Gap conocido: `LMStudioClient` constructor — campo exacto para el host puede ser `baseUrl` u otro — verificar en node_modules
- La linea "Estado final:" y "Estado:" coexisten en status.md — parsear ambas variantes
- status.md de features: "Handoff X -> Y" completado si tiene >120 chars de contenido real (no solo placeholder "> Agente: completa...")

## Pendientes y proximos pasos

- Cloe implementa monitor-historial-metricas segun docs/features/monitor-historial-metricas/status.md
- Max verifica la feature
- Ada optimiza si hay queries repetidas o imports redundantes
- Cipher audita validacion de params en getHistory (whitelist de agentId, eventType, itemType)
