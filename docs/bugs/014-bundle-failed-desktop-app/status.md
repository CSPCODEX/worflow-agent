# Bug #014 — Bundle failed al ejecutar bun run desktop

Estado: RESUELTO
Rama: bug/014-bundle-failed-desktop-app
Fecha apertura: 2026-03-15

---

## Info del bug

**Descripcion:** Al ejecutar `bun run desktop` (que corre `electrobun dev`), el proceso falla con el error "Bundle failed" y sale con code 1. La aplicacion no arranca. El bundler de Electrobun usa Bun como compilador TypeScript y aborta al encontrar errores de tipo o de declaracion duplicada.

**Como reproducir:**
1. `bun run desktop` desde la raiz del repo
2. Observar: `Bundle failed / error: script "desktop" exited with code 1`

**Comportamiento esperado:** La app de escritorio arranca en modo dev y muestra la ventana principal del Worflow Agent.

**Comportamiento actual:** Electrobun falla al hacer bundle del entrypoint `src/desktop/index.ts` y no abre ninguna ventana. El error exacto de Bun TypeScript es:

```
src/ipc/handlers.ts(24,7): error TS2451: Cannot redeclare block-scoped variable 'VALID_AGENTS'.
src/ipc/handlers.ts(55,7): error TS2451: Cannot redeclare block-scoped variable 'VALID_AGENTS'.
src/renderer/components/agent-list.ts(1,32): error TS2307: Cannot find module '../types/ipc' or its corresponding type declarations.
```

**Severidad:** CRITICA — la app de escritorio no arranca en absoluto.

**Tiene implicaciones de seguridad:** NO

---

## Handoff Max → Cloe

> Max: diagnostico completo. Cloe implementa el fix.

**Causa raiz identificada:** Dos errores de compilacion bloquean el bundle de Electrobun:

### Error 1 — CRITICO (bloquea el bundle): declaracion duplicada de `VALID_AGENTS` en handlers.ts

- Archivo: `src/ipc/handlers.ts`
- Linea 24: `const VALID_AGENTS = ['leo', 'cloe', 'max', 'ada', 'cipher'] as const;` — declaracion con su `type ValidAgentId`
- Linea 55: `const VALID_AGENTS = ['leo', 'cloe', 'max', 'ada', 'cipher'] as const;` — declaracion duplicada, sin el type, sin bloque de closure propio
- TypeScript: `TS2451: Cannot redeclare block-scoped variable 'VALID_AGENTS'`
- Causa probable: merge o refactor incompleto que dejo una segunda declaracion suelta en el mismo scope del modulo, entre `sanitizeForIpc` y `snapshotToIPC`.

### Error 2 — ALTO: import roto en agent-list.ts

- Archivo: `src/renderer/components/agent-list.ts`, linea 1
- Import: `import type { AgentInfo } from '../types/ipc'`
- El archivo esta en `src/renderer/components/` → `'../types/ipc'` resuelve a `src/renderer/types/ipc` — ruta que no existe
- El tipo `AgentInfo` existe en `src/types/ipc.ts` (dos niveles arriba del componente)
- Import correcto: `'../../types/ipc'`
- TypeScript: `TS2307: Cannot find module '../types/ipc'`

**Archivos involucrados:**
- `src/ipc/handlers.ts` — lineas 24 y 55 (duplicado de `VALID_AGENTS`)
- `src/renderer/components/agent-list.ts` — linea 1 (import path incorrecto)

**Fix propuesto:**

1. En `src/ipc/handlers.ts`: eliminar la declaracion duplicada de la linea 55 (la segunda, la que NO tiene el `type ValidAgentId` asociado). La declaracion correcta esta en la linea 24 junto con el type alias.

2. En `src/renderer/components/agent-list.ts`: corregir el import de `'../types/ipc'` a `'../../types/ipc'`.

**Reglas que Cloe debe respetar:**
- No romper el flujo CLI existente (`bun run dev`, `bun run chat`)
- Mantener type safety en IPC si el fix toca comunicacion main-renderer
- No introducir cambios de logica — estos son fixes quirurgicos de declaracion e import
- Despues del fix, ejecutar `bun run tsc --noEmit` y confirmar que los errores TS2451 y TS2307 desaparecen
- Los errores de `scripts/metrics.ts`, `node_modules/`, `src/client.ts` y `src/db/` son preexistentes — NO los toques en este bug

**Criterios de verificacion para Max:**
1. `bun run tsc --noEmit` no emite TS2451 ni TS2307
2. `bun run desktop` completa el bundle sin "Bundle failed"
3. La app abre su ventana en dev mode (verificacion visual)
4. `src/ipc/handlers.ts` tiene exactamente una declaracion de `VALID_AGENTS` en el scope del modulo
5. `src/renderer/components/agent-list.ts` linea 1 importa desde `'../../types/ipc'`

→ Siguiente: @cloe Implementa el fix del bug #014. Las instrucciones estan en docs/bugs/014-bundle-failed-desktop-app/status.md seccion "Handoff Max → Cloe".

## Metricas de Max (diagnostico)
- archivos_leidos: 8
- bugs_criticos: 1
- bugs_altos: 1
- items_checklist_verificados: 3/3
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 1

### No verificado por Max
- Verificacion visual de que la app abre la ventana correctamente: requiere entorno con display activo y LM Studio corriendo.
Confianza en la verificacion: alta

---

## Handoff Cloe → Max (verificacion)

> Cloe: completa esta seccion al terminar el fix. Max la lee para verificar.

**Archivos modificados:**

| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| `src/ipc/handlers.ts` | modificado | linea 55 eliminada (declaracion duplicada de `VALID_AGENTS`) |
| `src/renderer/components/agent-list.ts` | modificado | linea 1 (path del import corregido) |

**Descripcion del fix aplicado:**

1. `src/ipc/handlers.ts` — eliminada la segunda declaracion `const VALID_AGENTS = ['leo', 'cloe', 'max', 'ada', 'cipher'] as const;` que estaba suelta entre `sanitizeForIpc` y `snapshotToIPC` (linea original 55). La declaracion correcta (linea 24, con su `type ValidAgentId` asociado) se mantiene intacta. El bloque eliminado era exactamente 2 lineas: la constante y la linea en blanco que la seguia.

2. `src/renderer/components/agent-list.ts` — cambiado el import de `'../types/ipc'` a `'../../types/ipc'`. El componente vive en `src/renderer/components/` y el tipo `AgentInfo` esta en `src/types/ipc.ts`, que requiere subir dos niveles desde el componente.

**Resultado de tsc --noEmit:**

- TS2451 (`Cannot redeclare block-scoped variable 'VALID_AGENTS'`): ELIMINADO
- TS2307 (`Cannot find module '../types/ipc'`): ELIMINADO
- Errores restantes: solo preexistentes en `scripts/metrics.ts`, `scripts/verify-monitor.ts`, `src/client.ts`, `src/db/`, `src/ipc/acpManager.ts` — fuera de scope del bug #014, no introducidos por este fix.

**Casos borde considerados:**

- `ValidAgentId` sigue resolviendo correctamente porque el `type` alias depende de la declaracion de linea 24, que se mantiene. Las referencias en `getHistory` (linea ~216) y `getAgentTimeline` (linea ~269) continuan compilando sin error.
- El uso de `VALID_AGENTS` en `getAgentTimeline` (`.includes(params?.agentId as any)`) referencia la declaracion correcta de linea 24 — no se rompe nada.
- El import corregido en `agent-list.ts` resuelve exactamente a `src/types/ipc.ts` donde `AgentInfo` esta definida — verificado que el archivo existe.

**Advertencias para Max:**

- Verificacion visual de que la ventana abre requiere entorno con display activo (mismo gap que Max declaro en su diagnostico).
- Los errores en `src/db/` y `src/client.ts` son preexistentes — no los toques en este bug.

### Checklist Cloe
- [x] Manifiesto completo: cada archivo modificado con ruta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Leo (fix quirurgico, sin logica nueva)
- [x] bun run tsc --noEmit ejecutado — 0 errores nuevos, TS2451 y TS2307 eliminados
- [x] Strings que viajan por IPC son ASCII puro (sin cambios en IPC strings)
- [x] Fire-and-forget en todos los handlers IPC que lanzan subprocesos (sin cambios en handlers)
- [x] Input validation en todos los IPC handlers que tocan filesystem o spawn (sin cambios)
- [x] DB: sin cambios en DB
- [x] initDatabase() en try/catch con process.exit(1) si lanza (sin cambios)
- [x] Sin `any` sin justificacion (sin `any` nuevo introducido)
- [x] Labels HTML: sin cambios en HTML
- [x] Vistas nuevas: no aplica (no se crearon vistas nuevas)

### Gaps y dudas de Cloe
Sin gaps porque: cambio de 3 lineas (1 eliminacion de constante duplicada + 1 linea en blanco eliminada + 1 correccion de path de import), tsc limpio en los dos errores objetivo, sin nueva logica ni nuevos imports.
Confianza en la implementacion: alta

→ Siguiente: @max Verifica el fix del bug #014. El handoff de Cloe esta en docs/bugs/014-bundle-failed-desktop-app/status.md seccion "Handoff Cloe → Max".

## Metricas de Cloe
- archivos_leidos: 4
- archivos_creados: 0
- archivos_modificados: 2
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Resultado de verificacion (Max)

**El bug esta resuelto:** SI

**Casos probados:**

1. `src/ipc/handlers.ts` — una sola declaracion de `VALID_AGENTS` en el scope del modulo (linea 24). Verificado con grep: 1 coincidencia de `const VALID_AGENTS`, 2 usos (lineas 214 y 267) — ambos referencian la declaracion unica. Evidencia: `src/ipc/handlers.ts:24`

2. `src/renderer/components/agent-list.ts` linea 1 — import correcto `'../../types/ipc'`. Evidencia: `src/renderer/components/agent-list.ts:1`

3. `bun run tsc --noEmit` — ni TS2451 ni TS2307 aparecen en la salida. Errores restantes son todos preexistentes (scripts/metrics.ts, scripts/verify-monitor.ts, src/client.ts, src/db/, src/ipc/acpManager.ts, node_modules/electrobun). Evidencia: `grep -E "TS2451|TS2307"` retorna vacio.

4. `bun run desktop` — el bundle pasa sin "Bundle failed". El proceso llega a "Worflow Agent desktop started." (inicio exitoso del launcher + main process). Exit code 9 es SIGKILL del timeout de 10 s impuesto por el comando de verificacion, NO un fallo del bundle. Evidencia: output del comando incluye "Server started at http://localhost:50000" y "Worflow Agent desktop started." — ausencia total de "Bundle failed".

**Casos que aun fallan (si los hay):**

Ninguno dentro del scope del bug #014. Los errores preexistentes de tsc en scripts/ y src/db/ son ruido ya documentado — no bloquean el bundle de Electrobun.

**Decision:** Fix correcto y completo. Ambos errores que bloqueaban el bundle han sido eliminados de forma quirurgica sin introducir nueva logica ni romper contratos existentes.

**Requiere auditoria de Cipher:** NO

### Checklist Max — [bloques activos: ESTATICO | IPC | RENDERER]

## ESTATICO
- [x] Cada archivo del manifiesto verificado con file:line — evidencia: `src/ipc/handlers.ts:24` (unica declaracion VALID_AGENTS), `src/renderer/components/agent-list.ts:1` (import corregido)
- [x] bun run tsc --noEmit — 0 errores nuevos (TS2451 y TS2307 eliminados) — evidencia: grep de TS2451|TS2307 retorna vacio
- [x] Sin logica de negocio rota en los archivos modificados — evidencia: eliminacion de duplicado y correccion de path, sin cambio de logica

## IPC
- [x] Fire-and-forget en handlers que lanzan subprocesos — evidencia: sin cambios en handlers de subprocesos, patron existente intacto
- [x] Strings IPC son ASCII puro — evidencia: sin cambios en strings IPC
- [x] Inputs validados antes de filesystem ops o spawn — evidencia: sin cambios en validaciones

## RENDERER
- [x] Labels HTML: sin cambios en HTML — evidencia: Cloe no toco ningun archivo HTML
- [x] Archivos CSS referenciados en el manifiesto revisados — evidencia: sin cambios CSS
- [x] User input usa textContent o escapeHtml — evidencia: sin cambios en manejo de input
- [x] Estados de carga y error manejados en UI — evidencia: sin cambios en UI

### No verificado por Max
- Verificacion visual de que la ventana muestra la UI completa con datos: requiere entorno con display activo y LM Studio corriendo. El proceso arranca (confirmado por "Worflow Agent desktop started.") pero la renderizacion visual no es verificable en CLI headless.
Confianza en la verificacion: alta

## Metricas de Max (verificacion)
- archivos_leidos: 3
- bugs_criticos: 0
- bugs_altos: 0
- items_checklist_verificados: 10/10
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 1

---

Estado final: RESUELTO

DONE. No invocar Ada ni Cipher salvo que "Requiere auditoria de Cipher" sea SI.
