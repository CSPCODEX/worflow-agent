# Memoria de Ada — Optimizadora

## Metricas del proyecto
- Main process bundle: 11 MB (límite: 10 MB — ADVERTENCIA tras monitor feature, revisar en proxima iteracion)
- Renderer bundle: 58 KB (límite: 2 MB) — OK (creció con monitor feature CSS+JS)
- Bun output naming: entrypoint `app.ts` → output `app.js` (nombre = filename sin ext)
- Medicion: bun-test-ipc-handlers (2026-03-15)

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

### getAll() en repositories — SQLite IN clause
- Cuando un repository necesita leer N claves conocidas de una tabla key/value, usar `SELECT key, value WHERE key IN (?, ?)` + `Map` en lugar de N llamadas a `get()` separadas
- Aplicado en: `settingsRepository.getAll()` — 2 round-trips → 1
- Patron: `const map = new Map(rows.map(r => [r.key, r.value])); return { fieldA: map.get('key_a') ?? DEFAULT_A, ... }`

## Patrón: poller.start() y registro de callbacks

- Si un poller hace scan inmediato en `start()`, registrar los callbacks ANTES de llamar `start()`.
- En Electrobun, los callbacks de IPC push se registran dentro de `createRpc()`. Si `start()` se llama en scope del módulo (antes de `createRpc()`), el primer push se pierde.
- Solución: mover `start()` al final de `createRpc()`, después de `onSnapshot()`. No requiere cambiar la firma ni el tipo del poller.
- Aplicado en: `src/ipc/handlers.ts` — monitor feature.

## Patrón: constantes de módulo vs inline en funciones

- Arrays/objetos constantes usados en 2+ funciones del mismo archivo → extraer a constante de módulo.
- Ejemplo: `ALL_AGENTS: AgentId[]` declarado inline en `parseFeatureStatus` y `parseBugStatus` → constante de módulo.
- No extraer entre archivos del mismo módulo si la restricción de portabilidad lo justifica.

### N+1 queries en repositories — SQLite IN clause para multiples IDs
- Patron: funcion que hace una query SQLite por elemento dentro de `.map()` → N round-trips
- Fix: una sola query con `IN (${placeholders})` + spread + `Map` para agrupar en memoria
- Patron de codificacion:
  ```ts
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.query<Row, string[]>(`SELECT * FROM tabla WHERE id IN (${placeholders})`).all(...ids);
  const byId = new Map<string, Row[]>();
  for (const r of rows) { const b = byId.get(r.id); if (b) b.push(r); else byId.set(r.id, [r]); }
  ```
- Nota: `db.query()` re-compila el SQL cada vez. Si el numero de IDs es fijo usar `db.prepare()`.
- Aplicado en: `historyRepository.queryAgentTrends` — 5 queries → 1

### Imports muertos en handlers.ts — verificar antes de asumir
- Los imports del modulo monitor en handlers.ts pueden crecer con cada feature — siempre grep para detectar los que no se usan en ese archivo
- `closeHistoryDb` estaba importado en handlers.ts pero solo se usa en desktop/index.ts

## Patron: restoreExpandedCharts y re-render mid-IPC

- Cuando un re-render destruye elementos DOM mientras una Promise IPC esta en vuelo, la Promise escribe en el elemento stale (fuera del DOM) y el resultado se pierde.
- Fix: en la funcion de restauracion de estado, llamar a la funcion de carga completa (que hace display+cache check+IPC) en lugar de solo `display:block`. La funcion ya tiene el guard de cache, por lo que si la Promise completo antes del re-render, sirve el cache sin un round-trip extra.
- Aplicado en: `restoreExpandedCharts` — `monitor-view.ts` — graficas-evolucion-metricas-agentes.

## Patron: constante de modulo `as const` para whitelists IPC

- Si un handler IPC usa una whitelist de strings y otro handler usa la misma lista, extraer a `const` de modulo con `as const`.
- El tipo derivado `type X = typeof CONST[number]` evita duplicar el union type manualmente.
- Para usar en `.includes()` de un `string` comun: `(CONST as readonly string[]).includes(value)`.
- Aplicado en: `VALID_AGENTS` en `handlers.ts` — unificando `getHistory` y `getAgentTimeline`.

## Patron: CSS selectors duplicados — colapsar antes de entregar a Cipher

- Dos selectores con exactamente los mismos estilos (como `.loading` y `.empty` de estado) deben colapsarse en selector combinado `A, B { ... }`.
- Verificar antes de aplicar que no hay estilos distintos en ninguna propiedad — si difieren en una sola propiedad, mejor mantenerlos separados.

## Deuda técnica identificada
- `listAgents` sin caché — diferir a v1.1 con métricas reales
- `child_process` todavía importado en `acpManager.ts` y `client.ts` — fuera de scope de Ada
- `lmStudioEnhancer.ts` lineas 24/51: strings con tildes — riesgo IPC/WebView2 si alguna vez viajan por canal RPC

## Patron: eliminar spawnSync en CLI async
- `generateAgent` (CLI con spinners) era `async` pero usaba `spawnSync` — bloquea ~30s
- Fix: `Bun.spawn(['bun','install'], { stdio: ['ignore','pipe','pipe'] })` + `await proc.exited`
- No requiere cambiar la firma de la funcion (ya era async)
