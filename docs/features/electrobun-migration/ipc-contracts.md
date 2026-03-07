# IPC Contracts — Electrobun Migration

Contratos tipados entre el main process (Bun) y el renderer (webview).
Archivo de implementación: `src/types/ipc.ts`

## Tipos base

```typescript
// Reutilizado de src/cli/prompts.ts — no duplicar
export type { AgentConfig } from '../cli/prompts';
// AgentConfig = { name, description, role, needsWorkspace }
```

## Canales RPC (renderer → main)

### `generateAgent`
```typescript
params:  AgentConfig
returns: GenerateAgentResult

interface GenerateAgentResult {
  success: boolean;
  agentDir?: string;
  error?: string;
}
```

### `listAgents`
```typescript
params:  void
returns: ListAgentsResult

interface AgentInfo {
  name: string;
  description: string;   // leído de package.json del agente
  hasWorkspace: boolean;
  path: string;
}
interface ListAgentsResult {
  agents: AgentInfo[];
}
```

### `createSession`
```typescript
params:  CreateSessionParams
returns: CreateSessionResult

interface CreateSessionParams {
  agentName: string;
}
interface CreateSessionResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}
```

### `sendMessage`
```typescript
params:  SendMessageParams
returns: SendMessageResult

interface SendMessageParams {
  sessionId: string;
  message: string;
}
interface SendMessageResult {
  success: boolean;
  error?: string;
}
```

### `closeSession`
```typescript
params:  { sessionId: string }
returns: void
```

## Eventos (main → renderer, streaming)

### `agentMessageChunk`
```typescript
interface AgentMessageChunk {
  sessionId: string;
  text: string;         // fragmento de texto, append al chat
}
```

### `agentMessageEnd`
```typescript
interface AgentMessageEnd {
  sessionId: string;    // respuesta completa, ocultar spinner
}
```

### `agentError`
```typescript
interface AgentError {
  sessionId: string;
  error: string;
}
```

## Reglas de los contratos

- Todos los tipos son serializables a JSON (sin funciones, clases, Promises)
- Los handlers nunca lanzan excepciones al renderer — capturan y retornan `{ success: false, error }`
- Los params se validan en el handler antes de cualquier operación de file system o spawn
- Los nombres de canales son camelCase: `generateAgent`, no `generate_agent` ni `generate-agent`
