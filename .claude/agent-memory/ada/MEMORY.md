# Memoria de Ada — Optimizadora

## Metricas del proyecto (electrobun-migration v1.0)
- Main process bundle: 9.66 MB (límite: 10 MB) — OK
- Renderer bundle: 21.94 KB / 7 módulos (límite: 2 MB) — excelente
- Bun output naming: entrypoint `app.ts` → output `app.js` (nombre = filename sin ext)

## Patrones de optimización que funcionaron

### Dependencias muertas
- Siempre verificar `@google/generative-ai` y otras deps heredadas del scaffolding inicial
- Comando: `grep -rn "import.*nombre-dep" src/` antes de asumir que se usa

### Tree-shaking ACP SDK
- `import * as acp from '@agentclientprotocol/sdk'` bloquea tree-shaking
- Sustituir con named imports: `{ ndJsonStream, ClientSideConnection, PROTOCOL_VERSION, type Client, ... }`

### Cleanup de vistas SPA
- MutationObserver con `subtree: true` dispara en cada chunk de streaming → O(n) por mensaje
- Patrón correcto: función retorna `{ cleanup() }` → caller la invoca antes de cambiar vista
- Aplicado en: `renderChat` → `ChatHandle`, `app.ts` → `teardownCurrentView()`

### fs async en handlers IPC
- `readdirSync`, `readFileSync`, `existsSync` en handler async bloquean event loop
- Usar `fs.promises.readdir`, `fs.promises.readFile`, mantener `existsSync` solo para checks rápidos
- `Promise.all(entries.map(async...))` para paralelizar lecturas de agentes

### Imports duplicados en test files
- Cloe tiende a usar dos sentencias `import { ... } from 'bun:test'` separadas (una para primitives, otra para `mock`)
- Consolidar en un solo named import — `import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'`
- El orden de los imports en la misma sentencia no afecta la resolucion de modulos

### mock.module en tests — no extraible
- El boilerplate `mock.module('../../../src/db/database', ...)` se repite en 7 archivos
- NO se puede extraer a helper: `mock.module` debe ejecutarse al nivel del modulo antes de los imports dependientes
- Si se encapsula en una funcion, pierde el efecto de hoisting requerido por Bun

## Deuda técnica identificada
- `listAgents` sin caché — diferir a v1.1 con métricas reales
- `child_process` todavía importado en `acpManager.ts` y `client.ts` — fuera de scope de Ada

## Patron: eliminar spawnSync en CLI async
- `generateAgent` (CLI con spinners) era `async` pero usaba `spawnSync` — bloquea ~30s
- Fix: `Bun.spawn(['bun','install'], { stdio: ['ignore','pipe','pipe'] })` + `await proc.exited`
- No requiere cambiar la firma de la funcion (ya era async)
