# Memoria de Cloe — Ingeniera de Software

## Electrobun API patterns (v1.15.1)

- `defineElectrobunRPC<Schema, 'bun'>('bun', { handlers: { requests, messages } })` — main process RPC
- `Electroview.defineRPC<Schema>({ handlers: { requests, messages } })` — webview RPC
- `new Electroview({ rpc } as any)` — constructor needs `as any` due to generic constraint
- `(rpc as any).send.xxx(payload)` — sending messages to webview (type inference limitation)
- `BrowserWindow({ url, rpc, frame: {x,y,width,height}, title })` — main window
- `PATHS.VIEWS_FOLDER` — abs path to views; on Windows use `file:///` + replace backslashes
- `electrobun.config.ts`: `{ app, build: { bun: { entrypoint }, views: { name: { entrypoint } }, copy } }`
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

## Estado actual de la implementacion
- electrobun-migration: COMPLETO (11 archivos creados, 2 modificados)
- prompt-enhancement: COMPLETO (4 archivos creados, 7 modificados) — pendiente verificacion Max
- multi-provider-support: COMPLETO (9 archivos creados, 9 modificados) — listo para QA Max
