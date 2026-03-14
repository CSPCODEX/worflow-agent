# Status: Delete Agent

**Feature:** delete-agent
**Estado:** Listo para implementacion
**Responsable:** Cloe
**Fecha de diseno:** 2026-03-13

---

## Que implementar

Permitir al usuario eliminar un agente desde el sidebar de la app desktop:
- Confirmacion con modal HTML (NO `window.confirm` — bloquea IPC de Electrobun)
- Cierre de sesion ACP activa si existe
- Borrado de la carpeta del agente en filesystem
- Borrado del registro en SQLite (CASCADE a conversaciones y mensajes)
- Refresco del sidebar y limpieza de la vista de chat si corresponde

---

## Decisiones a respetar

1. **Orden de borrado:** filesystem primero, DB despues. Si fs falla, loguear y continuar. El agente
   quedaria como 'broken' en DB — aceptable y recuperable.

2. **Confirmacion:** modal HTML inyectado en `document.body`. No puede usar `window.confirm`.

3. **`acpManager.closeSessionByAgentName`:** el Map de sesiones activas usa sessionId como key,
   no agentName. Hay que agregar el campo `agentName` a la interfaz `Session` y persistirlo en
   `createSession` para poder hacer la busqueda inversa.

4. **`agentRepository.delete(id)` ya existe** — no crear uno nuevo. Hace CASCADE en DB via FK.

5. **`rmSync` ya esta importado** en `handlers.ts` de `'fs'` — reutilizar.

6. **Evento DOM `agent:deleted`** sigue el mismo patron que `agent:created`: CustomEvent en
   `document`, escuchado por `app.ts`.

7. **`activeAgentName`**: guardar en variable local en `app.ts` — no modificar la API de
   `renderChat` / `ChatHandle`.

---

## Archivos a crear

```
src/renderer/components/confirm-dialog.ts
```

---

## Archivos a modificar (en este orden)

### 1. `src/types/ipc.ts`

Agregar al final de las interfaces (antes de `AppRPC`):

```typescript
export interface DeleteAgentParams {
  agentId: string;
  agentName: string;
}

export interface DeleteAgentResult {
  success: boolean;
  error?: string;
}
```

Agregar en `AppRPC.bun.requests`:

```typescript
deleteAgent: { params: DeleteAgentParams; response: DeleteAgentResult };
```

---

### 2. `src/ipc/acpManager.ts`

Modificar la interfaz `Session` (linea ~22):

```typescript
interface Session {
  process: ChildProcess;
  connection: ClientSideConnection;
  acpSessionId: string;
  agentName: string;   // AGREGAR
}
```

En `createSession`, en el `this.sessions.set(sessionId, ...)` (~linea 84), agregar `agentName`:

```typescript
this.sessions.set(sessionId, { process: agentProcess, connection, acpSessionId, agentName });
```

Agregar metodo publico en la clase `AcpManager` (despues de `closeSession`):

```typescript
closeSessionByAgentName(agentName: string): void {
  for (const [sessionId, session] of this.sessions) {
    if (session.agentName === agentName) {
      this.closeSession(sessionId);
      break;
    }
  }
}
```

---

### 3. `src/ipc/handlers.ts`

Agregar en `handlers.requests` (dentro del objeto pasado a `defineElectrobunRPC`):

```typescript
deleteAgent: async ({ agentId, agentName }) => {
  if (!agentId?.trim()) return { success: false, error: 'agentId es requerido' };
  if (!agentName?.trim()) return { success: false, error: 'agentName es requerido' };

  const agent = agentRepository.findById(agentId.trim());
  if (!agent) return { success: false, error: `Agente con id "${agentId}" no encontrado.` };

  acpManager.closeSessionByAgentName(agentName.trim());

  try {
    rmSync(agent.path, { recursive: true, force: true });
  } catch (e: any) {
    console.error(`[deleteAgent] No se pudo borrar ${agent.path}:`, e.message);
  }

  agentRepository.delete(agentId.trim());

  return { success: true };
},
```

---

### 4. `src/renderer/components/confirm-dialog.ts` (CREAR)

```typescript
export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

export function showConfirmDialog(options: ConfirmDialogOptions): void {
  const { title, message, confirmLabel = 'Eliminar', cancelLabel = 'Cancelar', onConfirm, onCancel } = options;

  const overlay = document.createElement('div');
  overlay.className = 'confirm-dialog-overlay';

  overlay.innerHTML = `
    <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cd-title">
      <h3 id="cd-title" class="confirm-dialog-title"></h3>
      <p class="confirm-dialog-message"></p>
      <div class="confirm-dialog-actions">
        <button id="cd-cancel" class="btn-secondary"></button>
        <button id="cd-confirm" class="btn-danger"></button>
      </div>
    </div>
  `;

  // Usar textContent para evitar XSS
  overlay.querySelector<HTMLElement>('.confirm-dialog-title')!.textContent = title;
  overlay.querySelector<HTMLElement>('.confirm-dialog-message')!.textContent = message;
  overlay.querySelector<HTMLButtonElement>('#cd-cancel')!.textContent = cancelLabel;
  overlay.querySelector<HTMLButtonElement>('#cd-confirm')!.textContent = confirmLabel;

  function close() {
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
  }

  function handleConfirm() { close(); onConfirm(); }
  function handleCancel() { close(); onCancel?.(); }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') handleCancel();
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) handleCancel();
  });

  overlay.querySelector('#cd-cancel')!.addEventListener('click', handleCancel);
  overlay.querySelector('#cd-confirm')!.addEventListener('click', handleConfirm);
  document.addEventListener('keydown', onKeydown);

  document.body.appendChild(overlay);
  overlay.querySelector<HTMLButtonElement>('#cd-confirm')!.focus();
}
```

---

### 5. `src/renderer/components/agent-list.ts`

Agregar import al inicio:

```typescript
import { showConfirmDialog } from './confirm-dialog';
```

Dentro del loop de render de items, antes del `container.appendChild(item)`, agregar el boton
de eliminar al `item.innerHTML` y el handler de click:

En el innerHTML del item, agregar:

```html
<button class="agent-item-delete" title="Eliminar agente" data-agent-id="${agent.id}" data-agent-name="${escapeHtml(agent.name)}">
  Eliminar
</button>
```

Agregar listener (despues del listener de seleccion existente):

```typescript
const deleteBtn = item.querySelector<HTMLButtonElement>('.agent-item-delete')!;
deleteBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  showConfirmDialog({
    title: 'Eliminar agente',
    message: `Eliminar "${agent.name}"? Esta accion no se puede deshacer. Se borraran todos los archivos y conversaciones.`,
    onConfirm: async () => {
      deleteBtn.disabled = true;
      try {
        const result = await rpc.request.deleteAgent({ agentId: agent.id, agentName: agent.name });
        if (result.success) {
          document.dispatchEvent(new CustomEvent('agent:deleted', { detail: { agentId: agent.id, agentName: agent.name } }));
        } else {
          deleteBtn.disabled = false;
          // Mostrar error inline -- opcional: agregar un span de error temporal al item
          console.error('[deleteAgent]', result.error);
        }
      } catch (e: any) {
        deleteBtn.disabled = false;
        console.error('[deleteAgent] IPC error:', e.message);
      }
    },
  });
});
```

---

### 6. `src/renderer/app.ts`

Agregar variable local para rastrear el agente activo en chat (dentro de `DOMContentLoaded`,
a nivel del bloque donde estan `activeChatHandle`):

```typescript
let activeAgentName: string | null = null;
```

Modificar `teardownCurrentView`:

```typescript
function teardownCurrentView() {
  activeChatHandle?.cleanup();
  activeChatHandle = null;
  activeAgentName = null;   // AGREGAR
}
```

Modificar `showChat`:

```typescript
function showChat(agent: AgentInfo) {
  teardownCurrentView();
  activeAgentName = agent.name;   // AGREGAR
  activeChatHandle = renderChat(mainContentEl, agent.name);
}
```

Agregar listener `agent:deleted` junto al listener `agent:created` existente:

```typescript
document.addEventListener('agent:deleted', (e) => {
  const { agentName } = (e as CustomEvent).detail as { agentId: string; agentName: string };
  const refresh = (agentListEl as any).__refresh;
  if (typeof refresh === 'function') refresh();
  if (agentName === activeAgentName) {
    teardownCurrentView();
    mainContentEl.innerHTML = '<div class="empty-state"><p>El agente ha sido eliminado.</p></div>';
  }
});
```

---

## Metricas de Leo

- Archivos nuevos: 1 (`confirm-dialog.ts`)
- Archivos modificados: 5 (`ipc.ts`, `acpManager.ts`, `handlers.ts`, `agent-list.ts`, `app.ts`)
- Nuevos canales IPC: 1 (`deleteAgent`)
- Nuevos tipos IPC: 2 (`DeleteAgentParams`, `DeleteAgentResult`)
- Nuevas dependencias externas: 0
- Migraciones de DB: 0 (no se necesita nueva columna)
- Criterios de aceptacion: 35

---

## Handoff de Cloe -> Max

**Archivos tocados:**
- `src/types/ipc.ts` — agregados `DeleteAgentParams`, `DeleteAgentResult`, canal `deleteAgent` en `AppRPC`
- `src/ipc/acpManager.ts` — campo `agentName: string` en interfaz `Session`, persistido en `createSession`, metodo `closeSessionByAgentName` agregado
- `src/ipc/handlers.ts` — import de `DeleteAgentResult`, handler `deleteAgent` con orden: validacion -> cierre ACP -> rmSync -> delete DB
- `src/renderer/components/confirm-dialog.ts` — archivo nuevo, modal HTML sin `window.confirm`, callbacks en lugar de Promise para evitar problemas con Electrobun
- `src/renderer/components/agent-list.ts` — import de `showConfirmDialog`, boton `.agent-item-delete` en cada item, handler con `e.stopPropagation()` y disparo de `agent:deleted`
- `src/renderer/app.ts` — variable `activeAgentName`, setter en `showChat`, limpieza en `teardownCurrentView`, listener `agent:deleted`

**Decisiones tomadas:**
- `confirm-dialog.ts` usa callbacks (`onConfirm`/`onCancel`) en lugar de `Promise<boolean>` — el status.md especificaba callbacks directamente en el codigo de ejemplo. El modal se integra igual.
- El handler `deleteAgent` tipado con `Promise<DeleteAgentResult>` para explicitar el retorno.
- `e.stopPropagation()` en el boton eliminar evita activar `onSelect` del item al mismo tiempo.

**Lo que Max debe verificar:**
- Flujo completo: click Eliminar -> modal aparece -> Cancelar cierra sin borrar -> Confirmar borra filesystem + DB + refresca lista
- Escape y click en overlay cierran el modal sin borrar
- Si el agente esta en chat activo al eliminarlo, el chat se limpia y muestra mensaje "El agente ha sido eliminado."
- Si el agente NO es el activo, solo se refresca el sidebar
- Si hay sesion ACP activa (chat abierto), se cierra el proceso antes del borrado
- Agente con directorio ya inexistente: `rmSync` con `force: true` no lanza error, DB se borra igualmente
- `agentId` o `agentName` vacios devuelven `{ success: false, error: ... }` sin llegar a DB

## Metricas de Cloe

- Lineas agregadas: ~95
- Lineas modificadas: ~10
- Archivos nuevos: 1
- Archivos modificados: 5
- Tiempo estimado: dentro de lo planeado
- Desviaciones del plan: ninguna

---

## Handoff de Ada -> Cipher

**Archivos modificados:**
- `src/ipc/acpManager.ts` — `closeSessionByAgentName` ahora cierra TODAS las sesiones del agente, no solo la primera. El patron anterior mutaba el Map mientras iteraba (al llamar `closeSession` que hace `sessions.delete`); la nueva implementacion recolecta los IDs en un array primero y luego los cierra, evitando el bug de iteracion concurrente.
- `src/renderer/components/agent-list.ts` — `showItemError` ahora comprueba `errorSpan.isConnected` antes de remover en el callback del `setTimeout`. Evita operar sobre nodos huerfanos cuando el item de agente desaparece del DOM (eliminacion exitosa) antes de que transcurran los 3.5s.

**Descartado / no modificado:**
- `confirm-dialog.ts`: el listener `keydown` se remueve correctamente en todos los caminos de cierre — no habia leak. No se toco.
- `handlers.ts`: la estructura try/catch en `deleteAgent` tiene proposito (protege `agentRepository.delete` ante errores inesperados de DB). No habia redundancia real.
- `app.ts`: sin cambios — la logica de `agent:deleted` es correcta y minimal.

**Notas para Cipher:**
- `rmSync` se ejecuta con `force: true`; si `agent.path` contiene una ruta construida desde un valor de DB sin sanitizar, evaluar path traversal.
- El `agentName` que llega desde el renderer al handler `deleteAgent` se usa en `closeSessionByAgentName` con `.trim()` pero no hay validacion adicional de caracteres — verificar que el handler de confirmacion en frontend no permita agentNames manipulados.

## Metricas de Ada

- Archivos modificados: 2
- Lineas cambiadas: +8 / -4
- Bugs corregidos: 2 (iteracion concurrente sobre Map, nodo huerfano en timeout)
- Bundle: sin impacto medible (cambios de logica < 10 lineas)
- Nuevas dependencias: 0
