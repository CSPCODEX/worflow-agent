# Memoria de Cloe — Ingeniera de Software

## Electrobun API patterns (v1.15.1)

- `defineElectrobunRPC<Schema, 'bun'>('bun', { handlers: { requests, messages } })` — main process RPC
- `Electroview.defineRPC<Schema>({ handlers: { requests, messages } })` — webview RPC
- `new Electroview({ rpc } as any)` — constructor needs `as any` due to generic constraint
- `(rpc as any).send.xxx(payload)` — sending messages to webview (type inference limitation)
- `BrowserWindow({ url, rpc, frame: {x,y,width,height}, title })` — main window
- `PATHS.VIEWS_FOLDER` — abs path to views; on Windows use `file:///` + replace backslashes
- `electrobun.config.ts`: `{ app, build: { bun: { entrypoint, define }, views: { name: { entrypoint } }, copy } }`
- `build.bun.define`: inyecta literales JS en tiempo de build (solo `electrobun build`); en dev mode `NODE_ENV` queda `undefined` — correcto para guards `=== 'production'`
- `win.webview.closeDevTools()` — unico mecanismo para deshabilitar DevTools en Electrobun (no hay flag de constructor); llamar DESPUES del constructor, sincrono, no requiere await
- `copy` in config maps `'src/file'` → `'dest/file'` relative to build output

## Schema direction (critical)
- `AppRPC.bun.requests` = requests bun HANDLES (incoming from webview)
- `AppRPC.webview.messages` = messages webview RECEIVES (bun sends via `rpc.send`)
- `AppRPC.bun.messages` = messages bun receives from webview (typically empty)
- On webview: `rpc.request.xxx(params)` → calls AppRPC.bun.requests handler

## ACP session manager pattern
- Spawn: `spawn('bun', ['run', agentEntry], { stdio: ['pipe','pipe','pipe'], cwd })`
- Stream: `acp.ndJsonStream(Writable.toWeb(stdin), Readable.toWeb(stdout))`
- Connect: `new acp.ClientSideConnection(cb, stream)` → `initialize` → `newSession`
- Sessions stored in `Map<sessionId, { process, connection, acpSessionId }>`
- Cleanup: `process.kill()` + delete from Map on close/error/exit

## Agent detection
- Agent dirs have `package.json` (with `@agentclientprotocol/sdk` dep) AND `.env`
- `pkg.name` = agent name, `pkg.description` = description, check `workspace/` for hasWorkspace

## Worflow project rules
- DO NOT modify: `src/index.ts`, `src/client.ts`, TTY mode in agent templates
- `generateAgentCore(config, baseDir)` = spinner-free version of `generateAgent`
- Desktop: `bun run desktop` → `electrobun dev` (binary at `node_modules/electrobun/.cache/electrobun.exe`)

## Patrones de implementacion usados
- Routing SPA con funciones `renderXxx(container, ...args)` sin framework
- Cleanup de views con MutationObserver (detecta cuando el nodo sale del DOM)
- Eventos DOM (`CustomEvent`) como bus de mensajes entre Electroview y views

## Problemas resueltos
- Electrobun API no documentada → solución: leer source en `node_modules/electrobun/dist/`
- `rpc.send` type inference falla → usar `(rpc as any).send.xxx`
- `new Electroview({ rpc })` falla en tipos → usar `as any`
- `db.pragma()` no existe en bun:sqlite → usar `db.exec('PRAGMA journal_mode = WAL')`

## Background fire-and-forget con rpc.send
- Lanzar Promise sin await dentro de un RPC handler: `myAsyncFn(...).catch(console.error)`
- El handler retorna `{ success: true }` antes de que la Promise resuelva (sin latencia añadida)
- Para pasar `rpc.send` a una funcion auxiliar: usar tipo `(payload: T) => void` como parametro
- Definir la funcion auxiliar fuera de `createRpc` para mantener el handler limpio

## Coordinacion de dos eventos asincrono en el renderer
- Dos flags booleanos `let aDone = false; let bDone = false`
- Funcion `tryNavigate()` que verifica ambos flags antes de navegar
- Limpiar ambos listeners en TODOS los paths: success, error de RPC, error de result

## Template crypto autocontenido para agentes generados
- Agentes generados NO tienen acceso a `src/utils/` — si el generador necesita exponer crypto a los agentes, crear `providers/crypto.ts.tpl` con `decryptIfNeeded()` autocontenido que resuelve el path de master.key identico a `userDataDir.ts` (mismo switch de platform)
- El archivo master.key vive en `<USER_DATA_DIR>/master.key` (hex, 32 bytes)

## Strategy + Registry Map para providers intercambiables en agentes
- Patron: interfaz `LLMProvider` con `chat()` y `chatStream()`; `factory.ts` con registry map de dynamic imports; `createProvider()` lee `process.env.PROVIDER`
- Los providers se copian TODOS al agente (no solo el elegido) — permite cambio de provider editando solo `.env`
- `createProvider()` se llama UNA VEZ antes del if TTY/ACP; se pasa como argumento al constructor de la clase ACP

## LMStudioClient API (@lmstudio/sdk)
- Constructor acepta `{ baseUrl: string }` — campo exacto es `baseUrl` (no `wsBaseUrl`)
- `lmClient.llm.model()` — primer modelo disponible
- `lmClient.llm.model(key: string)` — modelo por nombre exacto
- Confirmado en `node_modules/@lmstudio/sdk/dist/index.d.ts` linea 5762

## settingsRepository patron
- Tabla `settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)` ya existe en migration v1
- `db.run('INSERT OR REPLACE INTO settings ...', [key, value])` — patron correcto para upsert
- Patron identico a agentRepository: `db.query<T, [string]>(...).get([param])` — TS2345 es preexistente

## CSS para clases nuevas del renderer
- Siempre añadir CSS para TODAS las clases nuevas usadas en templates de vistas y botones
- Las clases de vistas SPA (`.xxx-view`) requieren `flex: 1; overflow-y: auto` para ocupar el area disponible — sin esto el contenido colapsa a tamano cero
- Patron de referencia: `.create-agent-view { flex: 1; overflow-y: auto; padding: 32px; max-width: 560px }` — copiar este patron para cada vista nueva
- Botones en sidebar: `width: 100%; background: transparent; cursor: pointer; text-align: left` + `:hover` con background
- Footers del sidebar: `padding + border-top` para separacion visual
- Checklist antes de entregar: grep de TODAS las clases nuevas en `style.css` — si alguna no existe, añadirla

## Patron modulo autocontenido (monitor)
- Estructura: `src/<modulo>/core/*.ts` (sin imports externos) + `src/<modulo>/ui/*.ts` (solo tipos IPC del host) + `src/<modulo>/index.ts` (API publica)
- Thin re-export en `src/renderer/views/<modulo>.ts` para mantener convencion de imports del renderer
- Poller/timer: instanciar en scope del modulo de handlers.ts (NO dentro de createRpc ni de un handler IPC)
- Exportar `getPoller()` desde handlers.ts para que desktop/index.ts pueda llamar `stop()` en process.on('exit')
- `snapshotToIPC()`: omitir `filePath` con destructuring `{ filePath: _fp, ...rest }` — patron de seguridad
- CSS de modulo: prefijo unico (`.monitor-`) para evitar colisiones; copiado al build via `copy` en electrobun.config.ts
- sidebar-footer con 2+ botones: añadir `display: flex; flex-direction: column; gap: 6px` al CSS del footer

## SQLite modulo-local (historial del monitor)
- La DB del historial vive en historyDb.ts con su propio singleton `_historyDb` — completamente independiente de src/db/database.ts
- `db.query<T, []>(...).get([])` y `db.run(..., [val])` generan TS2345/TS2554 en este proyecto — son errores preexistentes del tipado de bun:sqlite, no regresiones nuevas
- `detectChanges(prev, curr)`: funcion pura sin efectos secundarios — si prev=null, genera eventos de bootstrap para TODOS los items existentes (comportamiento correcto para el primer scan)
- Transaccion en persistChanges: `db.transaction(() => { for events; for metrics })()` — atomicidad garantizada
- Paginacion con innerHTML reemplazado: los botones Anterior/Siguiente se recrean en cada llamada, por lo que los listeners son seguros (no hay acumulacion)
- cleanupHistoryDb en process.on('exit') AND process.on('SIGINT') en desktop/index.ts — siempre cerrar la DB en ambos handlers
- Callbacks on-demand para historial: loadHistory() se llama al activar el tab, no al montar la vista — evita llamadas IPC innecesarias
- Tabs con logica on-demand: patron `if (tab === 'xxx') loadXxx()` dentro de activateTab() para cargar datos solo cuando el usuario los solicita

## Seeding de estado desde SQLite al arrancar un poller/worker
- Patron "seed from DB on start": si un componente tiene `cachedState = null` en cada proceso nuevo, leer el ultimo estado desde la DB antes del primer ciclo de procesamiento — evita detectar como "nuevo" todo lo que ya existia
- Query optima para "ultimo valor por key": `SELECT x FROM t INNER JOIN (SELECT key, MAX(id) as max_id FROM t GROUP BY key) latest ON t.id = latest.max_id` — usa MAX(id) como proxy de recencia, sin subconsultas correlacionadas
- `.prepare<T, []>(...).all()` — para statements sin parametros en bun:sqlite, usar `.all()` sin argumentos (no `.all([])`); con parametros usar `.all(...params)` como spread
- Guard en el seed: solo asignar `cachedSnapshot` si el resultado tiene al menos 1 item — si la DB esta vacia, dejar `null` para comportamiento de bootstrap correcto
- Degradacion graceful en seed: try/catch que loguea pero no relanza — el componente sigue funcionando en modo "cold start" si el seed falla

## SVG inline generado desde TypeScript (graficas)
- Patron: funcion pura `renderLineChart(points, metric, color): string` — retorna string SVG, sin efectos DOM
- Polilines segmentadas: acumular puntos en `currentSegment[]`, vaciar al encontrar null — genera multiples `<polyline>` en lugar de uno con gaps
- Caso 1 punto: `step = 0`, coordenada X = `DRAW_X0 + DRAW_W / 2` (centrado)
- Guard division por cero: `if (maxY === 0) maxY = 1` — siempre antes de calcular coordenadas Y
- `escapeHtml()` obligatorio en etiquetas SVG `<text>` que muestran datos del filesystem (slugs)
- `overflow: visible` en el SVG para que el contenido no se recorte — pero el contenedor padre puede tener `overflow: hidden`

## Estado expandido persistente con re-renders frecuentes
- Patron: `expandedAgents: Set<string>` + `chartsCache: Map<string, T[]>` en el closure
- `restoreExpandedCharts()`: funcion que itera el Set y restaura display+innerHTML desde cache — llamar despues de cada `innerHTML =` en el contenedor padre
- Event delegation en el contenedor padre (no en cada card) — sobrevive re-renders del innerHTML

## Patrones de tests con bun:test
- `mock.module('../../src/db/database', ...)` ANTES de cualquier import que use `getDatabase()` -- orden critico
- Helper de DB en memoria: singleton modular con `setup/get/teardown` -- patron identico para DB principal y DB del monitor
- `FeatureState` y `BugState` en tests: usar valores del enum TS (`'EN_PLANIFICACION'`) NO strings del status.md (`'EN PLANIFICACION'`)
- Fire-and-forget timing test: `performance.now()` disponible en Bun globalmente; threshold 50ms, stub delay 80ms
- `setTimeout(cb, delay)` como stub de macrotask para verificar que el handler retorna antes del callback
- Tests del monitor importan funciones puras desde `src/monitor/core/` directamente -- no necesitan mock de Electrobun

## Declaracion duplicada en mismo scope de modulo (TS2451)
- Causa tipica: merge/rebase incompleto deja dos `const X = ...` en el mismo scope de modulo
- Electrobun bundler (Bun TS) aborta el bundle completo con TS2451 — bloquea el arranque de la app
- Fix: identificar cual declaracion tiene el `type alias` asociado (la correcta) y eliminar la segunda suelta
- Verificar con `bun run tsc --noEmit 2>&1 | grep TS2451` que desaparece

## Import path relativo desde subdirectorios del renderer
- `src/renderer/components/*.ts` necesita `'../../types/ipc'` para llegar a `src/types/ipc.ts`
- `src/renderer/views/*.ts` necesita `'../../types/ipc'` — mismo nivel que components/
- Error tipico: `'../types/ipc'` solo sube un nivel y resuelve a `src/renderer/types/ipc` (no existe)
- Verificar con `bun run tsc --noEmit 2>&1 | grep TS2307` que el modulo se encuentra

## Formato de lineas Estado: en status.md (dos variantes confirmadas)
- Formato plano (mayoria): `Estado: ...` / `Estado final: ...` — regex `/^Estado:\s/` y `/^Estado final:\s/`
- Formato bold (archivos mas antiguos, ej. delete-agent, prompt-enhancement, persistence, bug/001): `**Estado:** ...` — regex `/^\*\*Estado:\*\*\s/`
- Al escribir scripts que modifican status.md, siempre cubrir AMBOS formatos con regex separados
- No hay `**Estado final:**` en ningun archivo existente (solo `Estado final:` plano)

## Scripts CLI standalone (no IPC)
- `spawnSync` de node:child_process es correcto en scripts CLI — no reemplazar por Bun.spawn async
- Solo imports de `node:child_process`, `node:fs`, `node:path` — sin dependencias externas
- Chars no-ASCII en comentarios JSDoc estan bien (no viajan por ningun canal); en strings de runtime (console.log/warn) usar ASCII puro por compatibilidad con terminales Windows
- `process.cwd()` como repo root: el script debe ejecutarse desde la raiz via `bun run <script>`

## Tests con campos nuevos en tipos existentes
- Cuando se añade un campo requerido a un tipo usado en tests, buscar TODAS las construcciones del tipo en tests/ con grep antes de compilar
- Patron tipico: `makeSnapshot` helper en tests construye objetos parciales con `Partial<T>` -- pero el spread final genera error si el campo es requerido en el tipo base
- Fix: añadir el campo con valor default en el objeto base del helper (no en el Partial)

## Estado actual de la implementacion
- electrobun-migration: COMPLETO (11 archivos creados, 2 modificados)
- prompt-enhancement: COMPLETO (4 archivos creados, 7 modificados) — pendiente verificacion Max
- multi-provider-support: COMPLETO (9 archivos creados, 9 modificados) — listo para QA Max
- settings-panel: COMPLETO (2 archivos creados, 6 modificados) — listo para QA Max
- monitor-pipeline-agentes: COMPLETO (8 archivos creados, 7 modificados) — listo para QA Max
- monitor-historial-metricas: COMPLETO (3 archivos creados, 9 modificados) — listo para QA Max
- bug/009-duplicados-db-restart: COMPLETO (0 archivos creados, 2 modificados) — pendiente verificacion Max
- graficas-evolucion-metricas-agentes: COMPLETO (1 archivos creados, 6 modificados) — listo para QA Max
- bug/013-boton-actualizar-no-funciona: COMPLETO (0 archivos creados, 5 modificados) — listo para QA Max
- bug/014-bundle-failed-desktop-app: COMPLETO (0 archivos creados, 2 modificados) — listo para QA Max
- sync-docs-git-state: COMPLETO (1 archivos creados, 3 modificados) — listo para QA Max
- metricas-comportamiento-agentes-tab: COMPLETO (2 archivos creados, 14 modificados) — listo para QA Max
