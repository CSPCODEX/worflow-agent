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
- Canal nuevo monitor v3 (graficas): `getAgentTimeline` (request) — { agentId } -> serie temporal por agente
- Canal nuevo monitor v4 (comportamiento): `getAgentBehaviorTimeline` (request) — { agentId } -> serie de comportamiento
- Canales nuevos compliance: `getComplianceScores` + `getRejectionPatterns`
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

### Graficas SVG inline — monitor tab Agentes (graficas-evolucion-metricas-agentes)
- `queryAgentTrends` NO es util para graficas — devuelve promedios, no series temporales
- Nueva funcion `queryAgentTimeline(db, agentId)` en `src/monitor/core/timelineRepository.ts` — retorna filas ordenadas ASC
- Canal IPC nuevo `getAgentTimeline { agentId }` — bajo demanda, un agente a la vez
- Seccion colapsable por agente con boton toggle — no siempre visible para no saturar la UI
- Tres graficas SVG por agente: Rework (0-1), Iteraciones (0-max), Confianza (0-3)
- SVG generado como string en TypeScript — sin canvas, sin librerias externas
- Coordenadas: area 30..260 x 15..80, puntos null omitidos de polyline (segmentos separados)
- Cache en memoria: `chartsCache: Map<agentId, AgentTimelinePoint[]>` en el closure de renderMonitor
- Event delegation en `agentsGridEl` para clicks de toggle — los cards se re-renderizan en updateSnapshot
- Al re-renderizar cards en updateSnapshot: restaurar graficas desde chartsCache para agentes en expandedAgents
- Confianza mapeada: alta=3, media=2, baja=1, null=null (numero para eje Y numerico)
- El ancho SVG (280px) puede exceder cards de 200px min — `overflow: visible` en SVG mitiga el recorte

### Tests de comportamiento async — bun-test-ipc-handlers
- `handlers.ts` NO se puede importar en tests — llama `defineElectrobunRPC` que require entorno Electrobun
- Patron establecido: testear `handlerLogic.ts` (logica pura con DI) para handlers, nunca `handlers.ts`
- `tests/helpers/testHistoryDb.ts` — helper analogo a `testDb.ts` pero para el schema del monitor (monitor-history.db)
- El schema de `testHistoryDb.ts` es una copia literal de las migrations de `historyDb.ts` — sincronizar manualmente si se añaden migrations futuras
- Tests async miden timing con `performance.now()` — threshold de 50ms para fire-and-forget (handler debe retornar en < 50ms aunque stub tenga delay de 80ms)
- La distincion macrotask (`setTimeout`) vs microtask (`Promise.resolve`) es critica para los asserts de ordering: `onInstallDone` usa setTimeout, por lo que el flag es false inmediatamente despues del `await handleGenerateAgent(...)`
- Tests de monitor importan directamente desde `src/monitor/core/` (no desde `src/monitor/index.ts`) — las funciones reciben `db: Database` como parametro, son 100% testeables sin deps externas
- Scripts nuevos en package.json: `test:async` y `test:monitor` — el script `test` existente no cambia

### Scripts CLI standalone — sync-docs-git-state
- Scripts en `scripts/` son standalone — NO importan nada de `src/`
- Solo imports de Node.js built-ins: `node:child_process`, `node:fs`, `node:path`
- `spawnSync` es correcto en scripts CLI — bloqueo del event loop aceptable (no es handler IPC)
- Idempotencia obligatoria: ejecutar dos veces no cambia el resultado ni duplica lineas
- Regex de parseo de status.md deben ser exactos con `^` (inicio de linea) — no usar includes()/startsWith()
- Formato lineas de estado en status.md: `Estado:` y `Estado final:` (ambas variantes, regex separados)
- Posible variacion en status.md antiguos: `**Estado:**` (con markdown bold) — verificar antes de implementar
- `git branch --merged main` puede fallar si `main` no existe localmente — fallback a `origin/main`
- `git fetch` puede fallar sin internet — siempre try/catch en fetch, continuar con datos locales

### Metricas de comportamiento — extension del monitor (metricas-comportamiento-agentes-tab)
- Fuente de datos: parseo de status.md + verificacion de filesystem — NO auto-reportado por el agente
- 4 metricas por agente por feature: checklistRate, structureScore, hallucinationRate, memoryRead
- `behaviorParser.ts` es funcion pura en `src/monitor/core/` — unica dependencia externa: `node:fs`, `node:path`
- `repoRoot = path.dirname(docsDir)` — calculado en handlers.ts top-level, pasado a PipelinePoller config
- `MonitorConfig` añade campo `repoRoot?: string` — opcional, sin repoRoot la verificacion de refs retorna null
- Migration v2 en historyDb.ts: tabla `agent_behavior_history` con campos raw (num/den, not rates)
- `DetectedChanges` añade campo `newBehavior: AgentBehaviorEntry[]` — mismo patron que `newMetrics`
- `BugRecord` NO recibe `behaviorMetrics` en v1 — bugs tienen flujo sin checklist formal de Leo
- `FeatureRecord.behaviorMetrics` es `Partial<Record<AgentId, AgentBehaviorMetrics>>` (campo obligatorio)
- `FeatureRecordIPC.behaviorMetrics` es `Record<string, AgentBehaviorMetricsIPC>` (objeto plano, serializable)
- Tabla en UI por agente (columnas: Feature, Checklist, Estructura, Alucinacion, Memoria) — no SVG
- `getAgentBehaviorTimeline` es query SQLite sincrona — NO fire-and-forget, igual que `getAgentTimeline`
- `behaviorCache: Map<agentId, AgentBehaviorPointIPC[]>` en closure de renderMonitor — mismo patron que chartsCache
- Gap critico: separador en "## Handoff X → Y" puede ser → (U+2192) o -> ASCII — verificar con grep antes de implementar
- `loadLastKnownStates()` en historyRepository.ts debe inicializar `behaviorMetrics: {}` en FeatureRecord sintetico

### Compliance tracking — Opcion A (diff vs plan) + Opcion C (causa raiz) (compliance-tracking-diff-rework)
- Opcion A: Leo escribe bloque "### Leo Contract" con YAML fenced en su handoff — contrato de archivos a crear/modificar/no tocar
- Opcion C: Max escribe bloque "### Rejection Record" con YAML fenced cuando rechaza un handoff
- `complianceParser.ts`: funcion pura sin dependencias externas — parsea YAML simple manualmente, no usa librerias YAML
- YAML del contrato es intencionalmente simple (listas bajo claves fijas) — parsear con regex/split, nunca JSON.parse
- Migration v4 en historyDb.ts: tablas `compliance_scores` y `rejection_records`
- `rejection_records` tiene UNIQUE INDEX en (feature_slug, agent_at_fault, instruction_violated) — INSERT OR IGNORE previene duplicados
- `complianceRepository.ts`: inserciones y queries; `buildRejectionAggregates()` calcula mostFrequentViolation
- `DetectedChanges` añade campo `newRejections: RejectionRecord[]` — mismo patron que `newBehavior`
- Script `scripts/compliance-check.ts` PUEDE importar desde `src/monitor/core/complianceParser.ts` — excepcion justificada porque es funcion pura sin runtime deps de Electrobun
- Compliance score formula: `penalized = max(0, (filesOk/filesSpec) - filesViol * 0.1)`
- UI: tab "Compliance" (5to tab del monitor), lazy load al hacer click — no cargar al montar
- CSS nuevas clases: prefijo `.monitor-compliance-` para no colisionar con clases existentes
- `getComplianceScores` y `getRejectionPatterns` son queries SQLite sincronas — NO fire-and-forget
- El bloque "### Leo Contract" en el handoff del propio status.md sirve doble funcion: documental + medible

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
### [ENTREGADO] Plan de graficas-evolucion-metricas-agentes — Estado: APROBADO (Cipher)
### [ENTREGADO] Plan de bun-test-ipc-handlers — Estado: listo para Cloe
### [ENTREGADO] Plan de sync-docs-git-state — Estado: listo para Cloe
### [ENTREGADO] Plan de metricas-comportamiento-agentes-tab — Estado: listo para Cloe
### [ENTREGADO] Plan de compliance-tracking-diff-rework — Estado: listo para Cloe

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
- Handlers de consulta SQLite (getHistory, getAgentTrends, getAgentTimeline, getAgentBehaviorTimeline, getComplianceScores, getRejectionPatterns): sync, no fire-and-forget — SQLite bun:sqlite es I/O sincrono
- Extensiones de modulo autocontenido: nuevos archivos van en src/monitor/core/, nuevos exports van en src/monitor/index.ts
- Event delegation en contenedores re-renderizables: un listener en el padre, no por elemento hijo
- Graficas en UI: SVG inline como string — sin canvas ni librerias, funciona en cualquier webview
- Tests de handlers: NUNCA importar `handlers.ts` en tests — usar `handlerLogic.ts` con DI. `handlers.ts` crashea fuera de Electrobun por `defineElectrobunRPC`
- Tests de DB del monitor: usar `testHistoryDb.ts` (DB :memory: con schema de historyDb.ts) — analogo a testDb.ts para la DB principal
- Scripts CLI en `scripts/`: standalone, solo built-ins de Node.js, spawnSync aceptable (no son handlers IPC)
- Scripts CLI PUEDEN importar funciones puras de `src/monitor/core/` si no tienen deps de runtime Electrobun — exception justificada
- Metricas verificables en monitor: funcion pura `behaviorParser.ts` con `existsSync` para verificar file refs, no auto-reportadas
- CSS nuevas clases en monitor: prefijo `.monitor-behavior-` para comportamiento, `.monitor-compliance-` para compliance — no colisionar con `.monitor-agent-` ni con `style.css`
- Tabs del monitor con lazy load para datos pesados — compliance data se carga solo al hacer click en el tab
- El contrato "### Leo Contract" en el propio handoff del status.md sirve como contrato medible + documentacion para Cloe

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
- Separador en headers "## Handoff X → Y": puede ser → (Unicode) o -> (ASCII) — regex debe cubrir ambas variantes
- historyDb.ts schema version: v1 (pipeline_events, agent_metrics_history), v2 (agent_behavior_history), v3 (unique index behavior), v4 (compliance_scores, rejection_records)

## Pendientes y proximos pasos

- Cloe implementa compliance-tracking-diff-rework segun docs/features/compliance-tracking-diff-rework/status.md
- Cloe implementa metricas-comportamiento-agentes-tab segun docs/features/metricas-comportamiento-agentes-tab/status.md
- Cloe implementa sync-docs-git-state segun docs/features/sync-docs-git-state/status.md
- Cloe implementa bun-test-ipc-handlers segun docs/features/bun-test-ipc-handlers/status.md
- graficas-evolucion-metricas-agentes ya esta APROBADA — merge pendiente
- Max verifica bun-test-ipc-handlers tras implementacion de Cloe
