# IPC Contracts: Delete Agent

## Canal nuevo: deleteAgent

### Tipos a agregar en `src/types/ipc.ts`

```typescript
// Parametros del request
export interface DeleteAgentParams {
  agentId: string;    // UUID del agente (campo 'id' de AgentInfo)
  agentName: string;  // Nombre del agente (para cerrar sesion ACP y mensaje de error)
}

// Respuesta del request
export interface DeleteAgentResult {
  success: boolean;
  error?: string;
}
```

### Entrada en `AppRPC`

Agregar dentro de `AppRPC.bun.requests`:

```typescript
deleteAgent: { params: DeleteAgentParams; response: DeleteAgentResult };
```

### AppRPC completo tras el cambio (solo la seccion requests)

```typescript
export type AppRPC = {
  bun: RPCSchema<{
    requests: {
      generateAgent:       { params: AgentConfig;                 response: GenerateAgentResult };
      listAgents:          { params: undefined;                   response: ListAgentsResult };
      listProviders:       { params: undefined;                   response: ListProvidersResult };
      createSession:       { params: CreateSessionParams;         response: CreateSessionResult };
      sendMessage:         { params: SendMessageParams;           response: SendMessageResult };
      closeSession:        { params: { sessionId: string };       response: void };
      createConversation:  { params: CreateConversationParams;    response: CreateConversationResult };
      listConversations:   { params: ListConversationsParams;     response: ListConversationsResult };
      getMessages:         { params: GetMessagesParams;           response: GetMessagesResult };
      saveMessage:         { params: SaveMessageParams;           response: SaveMessageResult };
      deleteConversation:  { params: DeleteConversationParams;    response: DeleteConversationResult };
      deleteAgent:         { params: DeleteAgentParams;           response: DeleteAgentResult };  // NUEVO
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      agentMessageChunk:  AgentMessageChunk;
      agentMessageEnd:    AgentMessageEnd;
      agentError:         AgentError;
      agentInstallDone:   AgentInstallDone;
      agentEnhanceDone:   AgentEnhanceDone;
    };
  }>;
};
```

---

## No se necesita nuevo mensaje push (webview message)

La eliminacion es una operacion sincrona desde el punto de vista del renderer:
el renderer hace el request, espera la respuesta y reacciona. No requiere notificacion
push desde el main process.

El renderer coordina internamente via `CustomEvent('agent:deleted')` en el `document`,
siguiendo el mismo patron que `agent:created`.

---

## Handler en `src/ipc/handlers.ts`

Firma del handler a implementar:

```typescript
deleteAgent: async ({ agentId, agentName }) => {
  // 1. Validar inputs
  if (!agentId?.trim()) return { success: false, error: 'agentId es requerido' };
  if (!agentName?.trim()) return { success: false, error: 'agentName es requerido' };

  // 2. Verificar existencia en DB
  const agent = agentRepository.findById(agentId.trim());
  if (!agent) return { success: false, error: `Agente con id "${agentId}" no encontrado.` };

  // 3. Cerrar sesion ACP si existe
  acpManager.closeSessionByAgentName(agentName.trim());

  // 4. Borrar filesystem (best-effort)
  try {
    rmSync(agent.path, { recursive: true, force: true });
  } catch (e: any) {
    console.error(`[deleteAgent] No se pudo borrar ${agent.path}:`, e.message);
  }

  // 5. Borrar de DB (CASCADE a conversations + messages)
  agentRepository.delete(agentId.trim());

  return { success: true };
}
```

Imports adicionales necesarios en `handlers.ts`: `rmSync` ya esta importado de `'fs'`.

---

## Cambios en `src/ipc/acpManager.ts`

### Interfaz Session — campo nuevo

```typescript
interface Session {
  process: ChildProcess;
  connection: ClientSideConnection;
  acpSessionId: string;
  agentName: string;  // NUEVO: para poder buscar por nombre en closeSessionByAgentName
}
```

### Persistir agentName en createSession

En el `this.sessions.set(sessionId, ...)`:

```typescript
this.sessions.set(sessionId, {
  process: agentProcess,
  connection,
  acpSessionId,
  agentName,  // NUEVO
});
```

### Metodo nuevo

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

El metodo es publico para que `handlers.ts` pueda invocarlo.

---

## Evento DOM del renderer

No es un canal IPC — es un CustomEvent interno al webview.

```typescript
// Despachado por agent-list.ts tras recibir success: true del IPC
document.dispatchEvent(
  new CustomEvent('agent:deleted', {
    detail: { agentId: string; agentName: string }
  })
);
```

Escuchado por `app.ts` para:
1. Refrescar el sidebar.
2. Limpiar la vista de chat si el agente borrado estaba activo.
