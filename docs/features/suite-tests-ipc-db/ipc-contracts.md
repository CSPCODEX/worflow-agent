# Contratos IPC — Suite de tests

Esta feature no introduce ni modifica contratos IPC. El refactor de `handlers.ts` → `handlerLogic.ts` es interno al main process y transparente al renderer.

---

## Firma de handlerLogic.ts (contrato del modulo extraido)

Estas son las interfaces del modulo `src/ipc/handlerLogic.ts` que Cloe debe implementar. Los tipos de parametros y retorno son los mismos que ya existen en `src/types/ipc.ts` — no se crean tipos nuevos.

```typescript
import type {
  AgentConfig,
  GenerateAgentResult,
  ListAgentsResult,
  CreateSessionParams,
  CreateSessionResult,
  SaveMessageParams,
  SaveMessageResult,
  DeleteAgentParams,
  DeleteAgentResult,
} from '../types/ipc';

// --- Tipos de dependencias inyectadas ---

export interface GenerateAgentDeps {
  agentRepository: Pick<typeof import('../db/agentRepository').agentRepository,
    'findByName' | 'insert'>;
  scaffoldAgent: typeof import('../generators/agentGenerator').scaffoldAgent;
  installAgentDeps: typeof import('../generators/agentGenerator').installAgentDeps;
  enhanceAndPersist: (
    agentId: string,
    agentDir: string,
    agentName: string,
    originalPrompt: string,
    rpcSend: (payload: import('../types/ipc').AgentEnhanceDone) => void
  ) => Promise<void>;
  onInstallDone: (payload: import('../types/ipc').AgentInstallDone) => void;
  onEnhanceDone: (payload: import('../types/ipc').AgentEnhanceDone) => void;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
}

export interface CreateSessionDeps {
  agentRepository: Pick<typeof import('../db/agentRepository').agentRepository,
    'findByName'>;
  acpManager: Pick<import('./acpManager').AcpManager,
    'createSession'>;
}

export interface DeleteAgentDeps {
  agentRepository: Pick<typeof import('../db/agentRepository').agentRepository,
    'findById' | 'delete'>;
  acpManager: Pick<import('./acpManager').AcpManager,
    'closeSessionByAgentName'>;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
}

// --- Funciones exportadas ---

export async function handleGenerateAgent(
  config: AgentConfig,
  agentsDir: string,
  deps: GenerateAgentDeps
): Promise<GenerateAgentResult>;

export async function handleListAgents(): Promise<ListAgentsResult>;

export async function handleCreateSession(
  params: CreateSessionParams,
  deps: CreateSessionDeps
): Promise<CreateSessionResult>;

export async function handleSaveMessage(
  params: SaveMessageParams
): Promise<SaveMessageResult>;

export async function handleDeleteAgent(
  params: DeleteAgentParams,
  deps: DeleteAgentDeps
): Promise<DeleteAgentResult>;
```

### Nota sobre el refactor

`handlers.ts` no cambia su contrato externo con el renderer. Solo delega hacia `handlerLogic.ts`:

```typescript
// handlers.ts (despues del refactor)
generateAgent: async (config) => {
  return handleGenerateAgent(config, AGENTS_DIR, {
    agentRepository,
    scaffoldAgent,
    installAgentDeps,
    enhanceAndPersist,
    onInstallDone: (p) => (rpc as any).send.agentInstallDone(p),
    onEnhanceDone: (p) => (rpc as any).send.agentEnhanceDone(p),
    rmSync,
  });
},
```

El renderer no sabe ni le importa este cambio interno.
