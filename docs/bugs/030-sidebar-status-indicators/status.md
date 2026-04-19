# Bug #030 — Agentes en el sidebar no muestran indicador de conexion (online/offline)

Estado: RESUELTO
Rama: bug/030-sidebar-status-indicators
Fecha apertura: 2026-04-19

---

## Info del bug

**Descripcion:** Los agentes en el sidebar del renderer NO muestran indicador de conexion (punto verde/rojo online/offline). Solo se muestra "Sin conexion" (badge rojo) cuando el agente esta en estado `broken`. Todos los agentes visibles aunque esten funcionando correctamente no tienen ningun indicador de su estado de conexion.

**Como reproducir:**
1. Abrir la desktop app
2. Ver el sidebar de agentes
3. Observar que los agentes activos NO tienen punto verde/rojo de estado
4. Solo cuando un agente esta `broken` se muestra el badge "Sin conexion"

**Comportamiento esperado:**
- Los agentes en estado `active` deberian tener un `.status-dot status-available` (circulo verde)
- Los agentes en estado `broken` deberian tener un `.status-dot status-unavailable` (circulo rojo)
- El badge "Sin conexion" es redundante con el indicador visual

**Comportamiento actual:**
- Solo se muestra el badge "Sin conexion" en agentes broken
- No hay punto de estado en agentes activos
- CSS ya tiene `.status-dot`, `.status-available`, `.status-unavailable` definidos (style.css:2195-2211) pero NO se usan en agent-list.ts

**Severidad:** MEDIA
**Tiene implicaciones de seguridad:** NO

---

## Handoff Max → Cloe

> Max: completa esta seccion despues de diagnosticar. Cloe lee esto para implementar el fix.

**Causa raiz identificada:**

El archivo `src/renderer/components/agent-list.ts` (lineas 33-44) renderiza los agentes pero NO incluye ningun elemento de status visual. Solo diferencia visualmente a los agentes `broken` con una clase CSS y un badge de texto.

La logica actual en el for loop (linea 33-78):
```typescript
const isBroken = agent.status === 'broken';
item.className = isBroken ? 'agent-item broken' : 'agent-item';
// ... renderiza nombre, descripcion, badge, boton delete
// PERO no hay nada que represente el estado de conexion
```

El CSS en `src/renderer/style.css` (lineas 2195-2211) ya tiene los estilos necesarios:
- `.status-dot` (8x8px, border-radius 50%)
- `.status-available` (background verde #22c55e)
- `.status-unavailable` (background rojo #d46a6a)
- `.status-checking` (background gris #888)

Sin embargo, el template HTML generado en `agent-list.ts` no incluye ningun elemento con clase `status-dot`.

**El fix es simple:** agregar el indicador visual `.status-dot` con la clase condicional segun `agent.status`.

**Archivos involucrados:**
- `src/renderer/components/agent-list.ts` — lineas 33-44 (render del item) y 38-44 (innerHTML del item)
- `src/renderer/style.css` — lineas 2195-2211 (ya tiene los estilos, no modificar)

**Fix propuesto:**

En `agent-list.ts`, dentro del for loop, modificar el innerHTML del item para incluir el indicador de status.

Cambiar esta seccion (lineas 38-44):
```typescript
item.innerHTML = `
  <div class="agent-item-name">${escapeHtml(agent.name)}</div>
  <div class="agent-item-desc">${escapeHtml(agent.description || '')}</div>
  ${agent.isDefault ? '<span class="agent-default-badge">Por defecto</span>' : ''}
  ${isBroken ? '<div class="agent-item-broken-badge">Sin conexion</div>' : ''}
  ${!agent.isDefault && !isBroken ? `<button class="agent-item-delete" ...>` : ''}
`;
```

Por algo como:
```typescript
item.innerHTML = `
  <span class="status-dot ${agent.status === 'active' ? 'status-available' : 'status-unavailable'}"></span>
  <div class="agent-item-name">${escapeHtml(agent.name)}</div>
  <div class="agent-item-desc">${escapeHtml(agent.description || '')}</div>
  ${agent.isDefault ? '<span class="agent-default-badge">Por defecto</span>' : ''}
  ${isBroken ? '<div class="agent-item-broken-badge">Sin conexion</div>' : ''}
  ${!agent.isDefault && !isBroken ? `<button class="agent-item-delete" ...>` : ''}
`;
```

**Reglas que Cloe debe respetar:**
- No romper el flujo CLI existente (bun run dev, bun run chat)
- Mantener type safety en IPC si el fix toca comunicacion main-renderer
- El fix es puramente de renderizado en el renderer — no requiere cambios en main process ni en tipos IPC
- El `.status-dot` debe ir antes del nombre del agente para ser visible en el sidebar

**Criterios de verificacion para Max:**
- El agente con status `active` muestra un punto verde (.status-dot.status-available)
- El agente con status `broken` muestra un punto rojo (.status-dot.status-unavailable)
- El badge "Sin conexion" sigue apareciendo en agentes broken (por ahora, mantener compatibilidad)
- El layout del agent-item no se rompe con la inclusion del nuevo span

→ Siguiente: @cloe Implementa el fix del bug #030. Las instrucciones estan en docs/bugs/030-sidebar-status-indicators/status.md seccion "Handoff Max → Cloe".

## Metricas de Max (diagnostico)
- archivos_leidos: 5
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 1
- items_checklist_verificados: 0/8 (bug — no aplica checklist de features)
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Handoff Cloe → Max (verificacion)

> Cloe: completa esta seccion al terminar el fix. Cloe lee esto para verificar.

**Archivos modificados:**
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| src/renderer/components/agent-list.ts | modificado | 38-45 |

**Descripcion del fix aplicado:**
Se agrego `<span class="status-dot ${isBroken ? 'status-unavailable' : 'status-available'}"></span>` antes del `<div class="agent-item-name">` en el innerHTML del item del agente. Esto muestra un punto verde para agentes `active` y rojo para agentes `broken`. El badge "Sin conexion" se mantiene para agentes broken por compatibilidad.

**Casos borde considerados:**
- Agente `active` → status-available (verde)
- Agente `broken` → status-unavailable (rojo) + badge "Sin conexion" se mantiene
- Agente sin estado definido (undefined) → cae en `status-unavailable` por `isBroken = false`? No aplica: `agent.status` es `string` en el tipo `AgentInfo`, y el template usa `isBroken ? 'status-unavailable' : 'status-available'` donde `isBroken = agent.status === 'broken'`

**Advertencias para Max:**
- El CSS en style.css:2195-2211 define las clases .status-dot, .status-available, .status-unavailable — no fue modificado
- tsc --noEmit: 0 errores nuevos en agent-list.ts (errores preexistentes en scripts/metrics.ts)
- No se tocaron contratos IPC ni tipos

→ Siguiente: @max Verifica el fix del bug #030. El handoff de Cloe esta en docs/bugs/030-sidebar-status-indicators/status.md seccion "Handoff Cloe → Max".

## Metricas de Cloe
- archivos_leidos: 2 (status.md, agent-list.ts)
- archivos_creados: 0
- archivos_modificados: 1 (src/renderer/components/agent-list.ts)
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Resultado de verificacion (Max)

**El bug esta resuelto:** SI

**Casos probados:**

1. **status-dot para agentes `active`** — lineas verificadas:
   - `src/renderer/components/agent-list.ts:39` — `<span class="status-dot ${isBroken ? 'status-unavailable' : 'status-available'}"></span>`
   - Cuando `agent.status !== 'broken'`, `isBroken = false` → clase `status-available` (verde)
   - Evidencia: `src/renderer/components/agent-list.ts:35-39`

2. **status-dot para agentes `broken`** — lineas verificadas:
   - `agent.status === 'broken'` → `isBroken = true` → clase `status-unavailable` (rojo)
   - Badge "Sin conexion" se mantiene en paralelo (linea 43)
   - Evidencia: `src/renderer/components/agent-list.ts:35-43`

3. **CSS style.css lineas 2195-2211** — SIN CAMBIOS:
   - `.status-dot` (8x8px, border-radius 50%) — presente
   - `.status-available` (background #22c55e verde) — presente
   - `.status-unavailable` (background #d46a6a rojo) — presente
   - `.status-checking` (background #888 gris) — presente
   - Evidencia: lectura directa style.css:2195-2211

4. **tsc --noEmit** — 0 errores nuevos en agent-list.ts:
   - Los errores presentes son preexistentes en `scripts/metrics.ts`, `src/db/`, `src/ipc/acpManager.ts`
   - Ningun error en `src/renderer/components/agent-list.ts`
   - Evidencia: output de `bun run tsc --noEmit` completo arriba

**Casos que aun fallan (si los hay):** Ninguno.

**Decision:** El fix es correcto y completo. El indicador `.status-dot` se renderiza para todos los agentes con la clase adecuada segun estado. El badge "Sin conexion" se mantiene por compatibilidad.

**Requiere auditoria de Cipher:** NO

## Metricas de Max (verificacion)
- archivos_leidos: 2 (agent-list.ts, style.css:2195-2220)
- bugs_criticos: 0
- bugs_altos: 0
- items_checklist_verificados: N/A (bug simple — verificacion funcional directa)
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 1 (testeo manual en `bun run desktop` no ejecutado en esta sesion — no hay entorno visual disponible en el contexto actual)

---

Estado final: RESUELTO

DONE. No invocar Ada ni Cipher salvo que "Requiere auditoria de Cipher" sea SI.