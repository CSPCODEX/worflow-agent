# IPC Contracts — Persistencia

Todos los tipos son serializables a JSON (sin Date, sin Map, sin clases).
Los campos `created_at` son strings ISO 8601.

---

## Tipos nuevos

```typescript
// src/types/ipc.ts — añadir

export interface AgentInfo {
  // MODIFICADO: añadir campo status
  name: string;
  description: string;
  hasWorkspace: boolean;
  path: string;
  status: 'active' | 'broken';   // <-- nuevo
  id: string;                     // <-- nuevo (UUID de DB)
  createdAt: string;              // <-- nuevo (ISO 8601)
}

export interface ConversationInfo {
  id: string;           // UUID
  agentId: string;
  title: string;
  createdAt: string;    // ISO 8601
}

export interface MessageInfo {
  id: string;           // UUID
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;    // ISO 8601
}

// Params y Results para los nuevos handlers

export interface CreateConversationParams {
  agentId: string;
  title?: string;       // default: 'Nueva conversacion'
}

export interface CreateConversationResult {
  success: boolean;
  conversation?: ConversationInfo;
  error?: string;
}

export interface ListConversationsParams {
  agentId: string;
}

export interface ListConversationsResult {
  conversations: ConversationInfo[];
}

export interface GetMessagesParams {
  conversationId: string;
}

export interface GetMessagesResult {
  messages: MessageInfo[];
}

export interface SaveMessageParams {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface SaveMessageResult {
  success: boolean;
  message?: MessageInfo;
  error?: string;
}

export interface DeleteConversationParams {
  conversationId: string;
}

export interface DeleteConversationResult {
  success: boolean;
  error?: string;
}
```

---

## AppRPC actualizado

```typescript
// src/types/ipc.ts — AppRPC completo tras la feature

export type AppRPC = {
  bun: RPCSchema<{
    requests: {
      // Existentes (sin cambio de firma)
      generateAgent:       { params: AgentConfig;                  response: GenerateAgentResult };
      listAgents:          { params: undefined;                     response: ListAgentsResult };
      createSession:       { params: CreateSessionParams;          response: CreateSessionResult };
      sendMessage:         { params: SendMessageParams;            response: SendMessageResult };
      closeSession:        { params: { sessionId: string };       response: void };

      // Nuevos — conversaciones e historial
      createConversation:  { params: CreateConversationParams;    response: CreateConversationResult };
      listConversations:   { params: ListConversationsParams;     response: ListConversationsResult };
      getMessages:         { params: GetMessagesParams;           response: GetMessagesResult };
      saveMessage:         { params: SaveMessageParams;           response: SaveMessageResult };
      deleteConversation:  { params: DeleteConversationParams;   response: DeleteConversationResult };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      // Sin cambios
      agentMessageChunk: AgentMessageChunk;
      agentMessageEnd:   AgentMessageEnd;
      agentError:        AgentError;
      agentInstallDone:  AgentInstallDone;
    };
  }>;
};
```

---

## Cambios en CreateSessionParams

```typescript
// ANTES
export interface CreateSessionParams {
  agentName: string;
}

// DESPUES
export interface CreateSessionParams {
  agentName: string;
  agentPath: string;   // <-- ruta absoluta desde DB; acpManager ya no compone path
}
```

El handler `createSession` en `handlers.ts` consulta la DB para obtener `agent.path` y lo pasa
a `acpManager.createSession(agentName, agentPath)`. El renderer no necesita conocer el path
(no cambia la firma de la llamada desde el renderer, que sólo pasa `agentName`).

Internamente, el handler hace el lookup en DB, extrae `path`, y llama a `acpManager` con
la firma extendida. Esto evita pasar rutas absolutas por IPC (información del sistema).

Firma interna de `acpManager.createSession`:

```typescript
// src/ipc/acpManager.ts
async createSession(
  agentName: string,
  agentPath: string   // absoluto, resuelto por el handler desde DB
): Promise<{ success: boolean; sessionId?: string; error?: string }>
```

---

## Notas de compatibilidad

- `ListAgentsResult.agents` sigue siendo `AgentInfo[]` — solo se amplía `AgentInfo` con campos nuevos
- El renderer existente puede ignorar los campos nuevos (`id`, `status`, `createdAt`) en una primera
  iteración y se comporta igual que antes
- `status: 'broken'` los handlers del renderer deben filtrarlos o mostrarlos degradados — no hay
  acción automática de borrado
