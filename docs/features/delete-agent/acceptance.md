# Criterios de Aceptacion: Delete Agent

## Componente 1: Tipos IPC (`src/types/ipc.ts`)

- [ ] `DeleteAgentParams` exportada con campos `agentId: string` y `agentName: string`
- [ ] `DeleteAgentResult` exportada con `success: boolean` y `error?: string`
- [ ] Canal `deleteAgent` presente en `AppRPC.bun.requests` con los tipos correctos
- [ ] No se rompen los tipos existentes (TypeScript compila sin errores)

---

## Componente 2: ACP Manager (`src/ipc/acpManager.ts`)

- [ ] La interfaz `Session` incluye el campo `agentName: string`
- [ ] `createSession` persiste el `agentName` en el objeto Session al hacer `sessions.set`
- [ ] El metodo `closeSessionByAgentName(agentName: string): void` existe y es publico
- [ ] `closeSessionByAgentName` itera el Map buscando por `agentName`, llama a `closeSession` y hace break
- [ ] Si no hay sesion activa con ese nombre, el metodo retorna sin error (no lanza)
- [ ] Los metodos existentes (`closeSession`, `closeAll`, `createSession`, `sendMessage`) no cambian su comportamiento

---

## Componente 3: Handler IPC (`src/ipc/handlers.ts`)

- [ ] El handler `deleteAgent` esta registrado en `handlers.requests`
- [ ] Valida que `agentId` no sea vacio; retorna `{ success: false, error: '...' }` si lo es
- [ ] Valida que `agentName` no sea vacio; retorna `{ success: false, error: '...' }` si lo es
- [ ] Busca el agente con `agentRepository.findById(agentId)`; retorna error si no existe
- [ ] Llama a `acpManager.closeSessionByAgentName(agentName)` antes de borrar
- [ ] Llama a `rmSync(agent.path, { recursive: true, force: true })` dentro de un try/catch
- [ ] Si `rmSync` falla, loguea el error con `console.error` pero continua la ejecucion
- [ ] Llama a `agentRepository.delete(agentId)` despues del intento de borrado de filesystem
- [ ] Retorna `{ success: true }` al completar
- [ ] El handler es `async` y captura errores inesperados retornando `{ success: false, error: e.message }`

---

## Componente 4: Confirm Dialog (`src/renderer/components/confirm-dialog.ts`)

- [ ] Exporta la funcion `showConfirmDialog(options)` con la firma especificada en plan.md
- [ ] El dialog se inserta en `document.body` (no en un contenedor de la vista)
- [ ] Incluye un overlay semitransparente que cubre toda la pantalla
- [ ] Muestra el `title` y el `message` pasados por parametro
- [ ] El boton de confirmacion usa el label de `confirmLabel` (default: 'Eliminar')
- [ ] El boton de cancelacion usa el label de `cancelLabel` (default: 'Cancelar')
- [ ] Click en "Eliminar": ejecuta `onConfirm()` y remueve el dialog del DOM
- [ ] Click en "Cancelar": ejecuta `onCancel?.()` y remueve el dialog del DOM
- [ ] Click en el overlay (fuera del cuadro de dialogo): equivale a cancelar
- [ ] Tecla Escape: equivale a cancelar (listener en `document`, se elimina al cerrar)
- [ ] NO usa `window.confirm`, `window.alert` ni `window.prompt`
- [ ] El dialog es accesible: el boton de confirmacion tiene foco al abrirse

---

## Componente 5: Agent List (`src/renderer/components/agent-list.ts`)

- [ ] Cada `.agent-item` incluye un boton de eliminar (icono o texto "Eliminar")
- [ ] El boton de eliminar es visible (sin hover necesario para verlo, o con indicacion clara)
- [ ] El boton de eliminar tiene `e.stopPropagation()` para no activar el click de seleccion del item
- [ ] Click en "Eliminar" llama a `showConfirmDialog` con el nombre del agente en el mensaje
- [ ] La confirmacion invoca `rpc.request.deleteAgent({ agentId: agent.id, agentName: agent.name })`
- [ ] Si la respuesta es `success: true`: despacha `CustomEvent('agent:deleted', { detail: { agentId, agentName } })`
- [ ] Si la respuesta es `success: false`: muestra el mensaje de error de forma visible (inline en el item o en un area de feedback del sidebar)
- [ ] El boton de eliminar para agentes `broken` tambien funciona (permite borrar agentes rotos)
- [ ] El boton de eliminar no se muestra/desactiva mientras hay una eliminacion en curso (previene doble-click)
- [ ] No hay memory leaks: los event listeners del dialog se limpian al cerrarlo

---

## Componente 6: App (`src/renderer/app.ts`)

- [ ] Existe la variable `activeAgentName: string | null` inicializada en `null`
- [ ] `showChat(agent)` setea `activeAgentName = agent.name`
- [ ] `teardownCurrentView()` setea `activeAgentName = null`
- [ ] Hay un listener `document.addEventListener('agent:deleted', handler)` registrado en `DOMContentLoaded`
- [ ] El handler de `agent:deleted` llama a `agentListEl.__refresh()`
- [ ] El handler de `agent:deleted` compara `detail.agentName === activeAgentName`
- [ ] Si el agente eliminado era el activo: llama a `teardownCurrentView()` y muestra el empty-state en `mainContentEl`
- [ ] Si el agente eliminado NO era el activo: solo refresca el sidebar, no toca la vista principal
- [ ] El `showCreate` existente no se rompe

---

## Criterios de integracion end-to-end

- [ ] Eliminar un agente activo en chat: la vista de chat desaparece y se muestra el empty-state
- [ ] Eliminar un agente inactivo (no en chat): la vista activa no se toca
- [ ] Eliminar un agente `broken` (sin archivos en disco): el registro se borra de DB correctamente
- [ ] Tras eliminar, `listAgents` no devuelve el agente eliminado
- [ ] La carpeta del agente en `<userData>/agents/<nombre>/` ya no existe tras la eliminacion
- [ ] Las conversaciones y mensajes del agente desaparecen de DB (verificable via `listConversations`)
- [ ] Si el agente tenia sesion ACP activa, la sesion se cierra (el proceso hijo termina)
- [ ] Cancelar el dialog no produce ningun cambio de estado
- [ ] Los agentes restantes siguen funcionando correctamente tras eliminar otro agente
