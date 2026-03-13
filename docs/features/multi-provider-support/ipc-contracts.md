# IPC Contracts — Multi-Provider LLM Support

## Cambios en src/types/ipc.ts

### 1. Tipo `ProviderInfo` — nuevo

```typescript
export type ProviderId = 'lmstudio' | 'ollama' | 'openai' | 'anthropic' | 'gemini';

export interface ProviderInfo {
  id: ProviderId;
  label: string;         // Nombre de display: "LM Studio", "Ollama", etc.
  requiresApiKey: boolean;
  apiKeyEnvVar: string | null;  // e.g. "OPENAI_API_KEY" | null para locales
  defaultModel: string;         // Modelo sugerido por defecto
  isLocal: boolean;             // true para lmstudio y ollama
}
```

### 2. Tipo `ListProvidersResult` — nuevo

```typescript
export interface ListProvidersResult {
  providers: ProviderInfo[];
}
```

### 3. Tipo `AgentConfig` — campo `provider` añadido

`AgentConfig` vive en `src/cli/prompts.ts` y es re-exportado en `src/types/ipc.ts`. Se añade el campo `provider`:

```typescript
// src/cli/prompts.ts
export interface AgentConfig {
  name: string;
  description: string;
  role: string;
  needsWorkspace: boolean;
  provider: ProviderId;   // NUEVO — requerido
}
```

`ProviderId` debe importarse desde `src/types/ipc.ts` en `prompts.ts`, o bien definirse en `prompts.ts` y re-exportarse desde `ipc.ts`. La opción limpia: definir `ProviderId` en `src/types/ipc.ts` y que `prompts.ts` lo importe de ahí.

### 4. Tipo `AgentInfo` — campo `provider` añadido

```typescript
export interface AgentInfo {
  name: string;
  description: string;
  hasWorkspace: boolean;
  status: AgentStatus;
  id: string;
  createdAt: string;
  provider: ProviderId;  // NUEVO
}
```

### 5. `AppRPC` — canal `listProviders` añadido

```typescript
export type AppRPC = {
  bun: RPCSchema<{
    requests: {
      generateAgent:       { params: AgentConfig; response: GenerateAgentResult };
      listAgents:          { params: undefined; response: ListAgentsResult };
      listProviders:       { params: undefined; response: ListProvidersResult };  // NUEVO
      createSession:       { params: CreateSessionParams; response: CreateSessionResult };
      sendMessage:         { params: SendMessageParams; response: SendMessageResult };
      closeSession:        { params: { sessionId: string }; response: void };
      createConversation:  { params: CreateConversationParams; response: CreateConversationResult };
      listConversations:   { params: ListConversationsParams; response: ListConversationsResult };
      getMessages:         { params: GetMessagesParams; response: GetMessagesResult };
      saveMessage:         { params: SaveMessageParams; response: SaveMessageResult };
      deleteConversation:  { params: DeleteConversationParams; response: DeleteConversationResult };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      agentMessageChunk: AgentMessageChunk;
      agentMessageEnd:   AgentMessageEnd;
      agentError:        AgentError;
      agentInstallDone:  AgentInstallDone;
      agentEnhanceDone:  AgentEnhanceDone;
    };
  }>;
};
```

---

## Implementación del handler `listProviders`

El handler es estático — devuelve la lista hardcodeada de proveedores. No toca la DB ni el filesystem.

```typescript
// src/ipc/handlers.ts — dentro de createRpc()
listProviders: async () => {
  return {
    providers: [
      {
        id: 'lmstudio',
        label: 'LM Studio',
        requiresApiKey: false,
        apiKeyEnvVar: null,
        defaultModel: '',
        isLocal: true,
      },
      {
        id: 'ollama',
        label: 'Ollama',
        requiresApiKey: false,
        apiKeyEnvVar: null,
        defaultModel: 'llama3.2',
        isLocal: true,
      },
      {
        id: 'openai',
        label: 'OpenAI',
        requiresApiKey: true,
        apiKeyEnvVar: 'OPENAI_API_KEY',
        defaultModel: 'gpt-4o-mini',
        isLocal: false,
      },
      {
        id: 'anthropic',
        label: 'Anthropic',
        requiresApiKey: true,
        apiKeyEnvVar: 'ANTHROPIC_API_KEY',
        defaultModel: 'claude-3-5-haiku-20241022',
        isLocal: false,
      },
      {
        id: 'gemini',
        label: 'Gemini',
        requiresApiKey: true,
        apiKeyEnvVar: 'GEMINI_API_KEY',
        defaultModel: 'gemini-2.0-flash',
        isLocal: false,
      },
    ],
  };
},
```

---

## Cambios en AgentRecord (DB → IPC)

`AgentRecord` en `src/db/agentRepository.ts` añade el campo `provider`:

```typescript
export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  hasWorkspace: boolean;
  path: string;
  status: 'active' | 'broken';
  createdAt: string;
  provider: string;  // NUEVO — valor raw de la DB
}
```

El `rowToRecord` mapea `row.provider` a `record.provider`.

El método `insert` acepta `provider` como parámetro obligatorio:

```typescript
insert(params: {
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  hasWorkspace: boolean;
  path: string;
  provider: string;   // NUEVO
}): AgentRecord
```

---

## Cambio en generateAgent handler — IPC

En `src/ipc/handlers.ts`, el handler `generateAgent` pasa `provider` al `agentRepository.insert()`:

```typescript
insertedAgent = agentRepository.insert({
  name: config.name,
  description: config.description,
  systemPrompt: config.role,
  model: '',
  hasWorkspace: config.needsWorkspace ?? false,
  path: agentDir,
  provider: config.provider ?? 'lmstudio',  // NUEVO — fallback seguro
});
```

Y `scaffoldAgent` recibe `config.provider` para generar el `.env` y el `package.json` correctos:

```typescript
// agentGenerator.ts — scaffoldAgent usa config.provider
const agentDir = await scaffoldAgent(config, AGENTS_DIR);
// scaffoldAgent internamente usa config.provider para:
// 1. Escribir PROVIDER=<id> en .env junto con las vars del proveedor
// 2. Inyectar la dependencia correcta en package.json
```

---

## Contrato de `scaffoldAgent` — firma actualizada

`scaffoldAgent` no cambia su firma pública porque recibe `AgentConfig` completo:

```typescript
export const scaffoldAgent = async (config: AgentConfig, baseDir: string): Promise<string>
```

`AgentConfig` ahora incluye `provider`. Todo el código que llama a `scaffoldAgent` ya pasa `config` — automáticamente obtiene el provider sin cambios en los call-sites.

---

## Validación del campo `provider`

Añadir validación en el handler `generateAgent` antes de tocar el filesystem:

```typescript
const VALID_PROVIDERS: ProviderId[] = ['lmstudio', 'ollama', 'openai', 'anthropic', 'gemini'];
if (!VALID_PROVIDERS.includes(config.provider as any)) {
  return { success: false, error: `Proveedor inválido: "${config.provider}".` };
}
```

---

## Mensajes WebView — sin cambios

Los mensajes del webview (`agentMessageChunk`, `agentMessageEnd`, `agentError`, `agentInstallDone`, `agentEnhanceDone`) no cambian. El proveedor es un detalle del agente que solo importa en tiempo de creación y ejecución del subproceso.

---

## Resumen de cambios por archivo

| Archivo | Tipo de cambio | Descripción |
|---|---|---|
| `src/types/ipc.ts` | Modificar | Añadir `ProviderId`, `ProviderInfo`, `ListProvidersResult`; añadir `provider` a `AgentInfo`; añadir canal `listProviders` a `AppRPC` |
| `src/cli/prompts.ts` | Modificar | Añadir `provider: ProviderId` a `AgentConfig`; añadir pregunta de proveedor en `runInterview()` |
| `src/ipc/handlers.ts` | Modificar | Añadir handler `listProviders`; pasar `provider` a `agentRepository.insert()` |
| `src/db/agentRepository.ts` | Modificar | Añadir `provider` a `AgentRow`, `AgentRecord`, `insert()`, `rowToRecord()` |
| `src/db/migrations.ts` | Modificar | Añadir migration v3: `ALTER TABLE agents ADD COLUMN provider TEXT NOT NULL DEFAULT 'lmstudio'` |
