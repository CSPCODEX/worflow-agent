# Plan: Delete Agent

## Objetivo

Permitir al usuario eliminar un agente desde el sidebar de la app desktop, con confirmacion previa,
limpieza de sesion ACP activa, borrado del registro en SQLite y borrado de la carpeta en disco.

---

## Contexto del codebase

### Lo que ya existe (no se toca sin justificacion)

- `agentRepository.delete(id)` — ya existe en `src/db/agentRepository.ts` (linea 129-132). Hace
  `DELETE FROM agents WHERE id = ?` y por CASCADE elimina conversaciones y mensajes asociados.
- `acpManager.closeSession(sessionId)` — ya existe en `src/ipc/acpManager.ts`. Mata el proceso y
  elimina la entrada del Map.
- `acpManager.closeAll()` — ya existe. Cierra todas las sesiones.

### Lo que NO existe y hay que crear

1. Metodo `acpManager.closeSessionByAgentName(agentName)` — para cerrar la sesion de un agente
   especifico sin conocer el sessionId desde el renderer.
2. Canal IPC `deleteAgent` — nuevo request en `AppRPC`.
3. Handler `deleteAgent` en `src/ipc/handlers.ts`.
4. Dialog de confirmacion en el renderer (componente modal, sin `window.confirm`).
5. Boton de eliminar por cada item del agent-list.
6. Logica en `app.ts` para limpiar la vista de chat si el agente eliminado estaba activo.

---

## Restriccion critica: no usar `window.confirm`

`window.confirm` bloquea el event loop del webview y congela el canal IPC de Electrobun.
La confirmacion debe ser un dialog HTML renderizado en el propio webview.

---

## Estructura de archivos

### Archivos a crear

```
src/renderer/components/confirm-dialog.ts   # Componente de modal de confirmacion reutilizable
```

### Archivos a modificar

```
src/types/ipc.ts                            # Agregar DeleteAgentParams, DeleteAgentResult, canal en AppRPC
src/ipc/handlers.ts                         # Agregar handler deleteAgent
src/ipc/acpManager.ts                       # Agregar closeSessionByAgentName()
src/renderer/components/agent-list.ts       # Agregar boton eliminar + invocar confirm-dialog + IPC call
src/renderer/app.ts                         # Escuchar evento 'agent:deleted', limpiar vista si corresponde
```

### Sin cambios necesarios

```
src/db/agentRepository.ts    # delete(id) ya existe
src/db/migrations.ts         # No se necesita nueva columna
src/db/database.ts           # Sin cambios
src/desktop/index.ts         # Sin cambios
```

---

## Flujo completo

### 1. Usuario hace click en "Eliminar" en el sidebar

El boton esta dentro del `.agent-item`. Al hacer click se abre el modal de confirmacion.
El modal muestra: "Eliminar [nombre]? Esta accion no se puede deshacer."
Botones: "Cancelar" (cierra modal) y "Eliminar" (procede).

### 2. Usuario confirma

El renderer invoca `rpc.request.deleteAgent({ agentId, agentName })`.

### 3. Main process — handler deleteAgent

Orden de operaciones:
1. Validar que `agentId` es un string no vacio.
2. Buscar el agente en DB por id (`agentRepository.findById(agentId)`). Si no existe, retornar
   `{ success: false, error: '...' }`.
3. Cerrar sesion ACP activa si existe: `acpManager.closeSessionByAgentName(agentName)`.
4. Borrar directorio del filesystem: `rmSync(agent.path, { recursive: true, force: true })`.
   - Si falla (path no existe o permisos), continuar de todas formas (best-effort).
   - Loguear el error pero no abortar.
5. Borrar registro de DB: `agentRepository.delete(agentId)` (CASCADE a conversations+messages).
6. Retornar `{ success: true }`.

**Justificacion del orden filesystem-antes-que-DB:** Si la DB falla tras borrar el filesystem,
el agente quedaria en DB con status 'broken' (el findAll() detectaria path inexistente). Eso es
recuperable. Si el filesystem falla pero la DB no se borra, el agente sigue apareciendo como
funcional. El orden filesystem-primero es el menos danino: en el peor caso, un agente broken que
el usuario puede intentar borrar de nuevo.

### 4. Renderer recibe respuesta

- Si `success: true`: despacha `CustomEvent('agent:deleted', { detail: { agentId, agentName } })`.
- Si `success: false`: muestra mensaje de error al lado del boton (no modal).

### 5. app.ts reacciona al evento agent:deleted

- Llama a `agentListEl.__refresh()` para refrescar el sidebar.
- Si `activeChatHandle` corresponde al agente eliminado (se compara `agentName`), llama a
  `teardownCurrentView()` y muestra el empty-state en `mainContentEl`.

---

## Componente confirm-dialog

El modal se inyecta directamente en `document.body` (no en el container del agent-list)
para evitar problemas de z-index y overflow.

API publica:

```typescript
export function showConfirmDialog(options: {
  title: string;
  message: string;
  confirmLabel?: string;   // default: 'Eliminar'
  cancelLabel?: string;    // default: 'Cancelar'
  onConfirm: () => void;
  onCancel?: () => void;
}): void
```

- Crea el overlay + dialog, lo inserta en body.
- Al confirmar: ejecuta `onConfirm()`, remueve el dialog del DOM.
- Al cancelar: ejecuta `onCancel?.()`, remueve el dialog del DOM.
- Click en el overlay (fuera del dialog) equivale a cancelar.
- Tecla Escape equivale a cancelar (listener `keydown` en document, se elimina al cerrar).

---

## Detalle de closeSessionByAgentName

El `acpManager` tiene un `Map<string, Session>` donde la key es el sessionId (UUID). No hay
indice inverso por agentName. Se necesita agregar tracking del agentName en Session.

```typescript
interface Session {
  process: ChildProcess;
  connection: ClientSideConnection;
  acpSessionId: string;
  agentName: string;   // nuevo campo
}
```

`createSession` ya recibe `agentName` como primer parametro — solo hay que persistirlo en la
Session al hacer `this.sessions.set(...)`.

`closeSessionByAgentName(agentName: string)`:

```typescript
closeSessionByAgentName(agentName: string): void {
  for (const [sessionId, session] of this.sessions) {
    if (session.agentName === agentName) {
      this.closeSession(sessionId);
      break; // un agente tiene como maximo una sesion activa
    }
  }
}
```

---

## Estado de la vista activa en app.ts

El `activeChatHandle` actual no almacena el nombre del agente — solo expone `cleanup()`.
Hay que extender `ChatHandle` para incluir el agentName, o bien almacenar el agente activo
por separado en `app.ts`.

La opcion mas simple (sin modificar la API de `renderChat`) es guardar una variable local
en `app.ts`:

```typescript
let activeAgentName: string | null = null;
```

Que se setea en `showChat(agent)` y se limpia en `teardownCurrentView()`.

El listener de `agent:deleted` compara `detail.agentName === activeAgentName` antes de limpiar.

---

## Lista de tareas priorizadas para Cloe

1. `src/types/ipc.ts` — Agregar `DeleteAgentParams`, `DeleteAgentResult`, canal `deleteAgent` en `AppRPC.bun.requests`
2. `src/ipc/acpManager.ts` — Agregar campo `agentName` a `Session`, persistirlo en `createSession`, implementar `closeSessionByAgentName`
3. `src/ipc/handlers.ts` — Implementar handler `deleteAgent`
4. `src/renderer/components/confirm-dialog.ts` — Crear componente modal
5. `src/renderer/components/agent-list.ts` — Agregar boton eliminar, invocar dialog, dispatch evento `agent:deleted`
6. `src/renderer/app.ts` — Agregar variable `activeAgentName`, listener `agent:deleted`, logica de limpieza de vista
