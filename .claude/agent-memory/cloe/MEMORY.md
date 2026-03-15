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

## Estado actual de la implementacion
- electrobun-migration: COMPLETO (11 archivos creados, 2 modificados)
- prompt-enhancement: COMPLETO (4 archivos creados, 7 modificados) — pendiente verificacion Max
- multi-provider-support: COMPLETO (9 archivos creados, 9 modificados) — listo para QA Max
- settings-panel: COMPLETO (2 archivos creados, 6 modificados) — listo para QA Max
- monitor-pipeline-agentes: COMPLETO (8 archivos creados, 7 modificados) — listo para QA Max
