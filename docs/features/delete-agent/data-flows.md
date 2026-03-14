# Data Flows: Delete Agent

## Flujo end-to-end completo

```
RENDERER (webview)                        MAIN PROCESS (Bun)               SISTEMA
===================                       ===================               =======

[agent-list.ts]
Usuario hace click en
boton "Eliminar" del
agent-item
        |
        v
showConfirmDialog({
  title: "Eliminar agente",
  message: "Eliminar [nombre]? ...",
  onConfirm: () => invocarIPC()
})
        |
        | (usuario ve el modal)
        |
        v
[Usuario hace click "Eliminar"]
        |
        v
rpc.request.deleteAgent({
  agentId: agent.id,       ----IPC request (RPC named pipe)---->
  agentName: agent.name
})
                                          [handlers.ts]
                                          deleteAgent handler
                                                |
                                                v
                                          1. Validar agentId y
                                             agentName (no vacios)
                                                |
                                                v
                                          2. agentRepository
                                             .findById(agentId)
                                                |
                                             [no encontrado]
                                                |
                                                +---> return { success: false,
                                                |              error: "..." }
                                                |
                                             [encontrado]
                                                |
                                                v
                                          3. acpManager
                                             .closeSessionByAgentName(
                                               agentName
                                             )
                                                |
                                          [si habia sesion activa]
                                                |
                                                v
                                          session.process.kill()
                                          sessions.delete(sessionId)   ---> Proceso ACP
                                                |                           del agente
                                                |                           terminado
                                             [continua]
                                                |
                                                v
                                          4. rmSync(agent.path,
                                             { recursive: true,
                                               force: true })          ---> Filesystem
                                                |                           <userData>/agents/
                                          [si falla: log + continua]        <nombre>/ BORRADO
                                                |
                                                v
                                          5. agentRepository
                                             .delete(agentId)          ---> SQLite
                                                |                           DELETE agents
                                                |                           CASCADE:
                                                |                           conversations
                                                |                           messages
                                                v
                                          return { success: true }
                                          <----IPC response------------

[agent-list.ts]
recibe { success: true }
        |
        v
document.dispatchEvent(
  CustomEvent('agent:deleted', {
    detail: { agentId, agentName }
  })
)
        |
        +---------> [app.ts]
        |           escucha 'agent:deleted'
        |                   |
        |                   v
        |           activeAgentName ===
        |           detail.agentName ?
        |                   |
        |             [si] [no]
        |              |
        |              v
        |           teardownCurrentView()
        |           mainContentEl.innerHTML =
        |             '<empty-state>'
        |           activeAgentName = null
        |
        v
agentListEl.__refresh()
-> rpc.request.listAgents()
-> re-render del sidebar
   (agente eliminado ya no aparece)
```

---

## Flujo de cancelacion (usuario hace click en "Cancelar" o Escape)

```
RENDERER
========

[agent-list.ts]
Usuario hace click "Eliminar"
        |
        v
showConfirmDialog({ onConfirm, onCancel })
        |
        | (usuario ve el modal)
        |
        v
[Usuario hace click "Cancelar" o Escape o click en overlay]
        |
        v
onCancel?.() -- no hay callback definido en este caso
El dialog se remueve del DOM
No se hace ningun IPC call
Estado del sidebar: sin cambios
```

---

## Flujo de error del IPC

```
RENDERER                                  MAIN PROCESS
========                                  ============

rpc.request.deleteAgent({...})  --------->

                                          [error en DB o validacion]
                                          return { success: false,
                                                   error: "mensaje" }

                            <-----------

[agent-list.ts]
muestra mensaje de error
inline en el item del agente
(no modal -- feedback sutil)

El agente sigue en la lista.
El usuario puede intentar de nuevo.
```

---

## Diagrama de estado del agente en el renderer

```
[LISTED en sidebar]
      |
      | click "Eliminar"
      v
[CONFIRMACION PENDIENTE]
      |
      +--[Cancelar]--> [LISTED en sidebar] (sin cambio)
      |
      +--[Confirmar]-->
            |
            v
      [BORRANDO... (boton spinner opcional)]
            |
            +--[success: false]--> [LISTED en sidebar]
            |                      (muestra error inline)
            |
            +--[success: true]---> [ELIMINADO]
                                    - Removido del sidebar
                                    - Chat view limpiada si era activo
```

---

## Cascada en SQLite

La FK con `ON DELETE CASCADE` ya esta en el schema (migration v1):

```
agents (id)
  |-- conversations (agent_id FK -> agents.id ON DELETE CASCADE)
        |-- messages (conversation_id FK -> conversations.id ON DELETE CASCADE)
```

Un solo `DELETE FROM agents WHERE id = ?` en `agentRepository.delete(id)` elimina
en cascada todas las conversaciones y mensajes del agente. No se necesita logica adicional.
PRAGMA `foreign_keys = ON` ya esta activado en `database.ts`.

---

## Relacion con el filesystem

```
<userData>/
  worflow-agent.db   <-- registro en tabla agents borrado (CASCADE)
  agents/
    <agent-name>/    <-- directorio completo borrado con rmSync recursive
      index.ts
      package.json
      .env
      node_modules/
      workspace/     (si habia workspace)
      providers/
```

Despues del borrado, si `listAgents` se llama antes de que el handler retorne (imposible
dado que IPC es serial por request), no habria el agente. En la practica el flujo es
secuencial: IPC response -> refresh.
