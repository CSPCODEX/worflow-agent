import { mkdirSync } from 'fs';
import { validateAgentName } from '../cli/validations';
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
  AgentInfo,
  AgentEnhanceDone,
  AgentInstallDone,
  ProviderId,
  LoadSettingsResult,
  SaveSettingsParams,
  SaveSettingsResult,
} from '../types/ipc';
import { settingsRepository } from '../db/settingsRepository';
import { USER_DATA_DIR } from '../db/userDataDir';
import type { agentRepository as AgentRepo } from '../db/agentRepository';
import type { acpManager as AcpMgr } from './acpManager';
import type { scaffoldAgent as ScaffoldFn, installAgentDeps as InstallFn } from '../generators/agentGenerator';
import { agentRepository } from '../db/agentRepository';
import { messageRepository } from '../db/conversationRepository';

const VALID_PROVIDERS: ProviderId[] = ['lmstudio', 'ollama', 'openai', 'anthropic', 'gemini'];
const VALID_ROLES = ['user', 'assistant', 'system'] as const;

// --- Dependency injection interfaces ---

export interface GenerateAgentDeps {
  agentRepository: Pick<typeof AgentRepo, 'findByName' | 'insert'>;
  scaffoldAgent: typeof ScaffoldFn;
  installAgentDeps: typeof InstallFn;
  enhanceAndPersist: (
    agentId: string,
    agentDir: string,
    agentName: string,
    originalPrompt: string,
    rpcSend: (payload: AgentEnhanceDone) => void
  ) => Promise<void>;
  onInstallDone: (payload: AgentInstallDone) => void;
  onEnhanceDone: (payload: AgentEnhanceDone) => void;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
}

export interface CreateSessionDeps {
  agentRepository: Pick<typeof AgentRepo, 'findByName'>;
  acpManager: Pick<typeof AcpMgr, 'createSession'>;
}

export interface DeleteAgentDeps {
  agentRepository: Pick<typeof AgentRepo, 'findById' | 'delete'>;
  acpManager: Pick<typeof AcpMgr, 'closeSessionByAgentName'>;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
}

// --- Handler logic functions ---

export async function handleGenerateAgent(
  config: AgentConfig,
  agentsDir: string,
  deps: GenerateAgentDeps
): Promise<GenerateAgentResult> {
  if (!config?.name) return { success: false, error: 'Agent name required' };
  const nameError = validateAgentName(config.name);
  if (nameError) return { success: false, error: nameError };

  if (config.provider && !VALID_PROVIDERS.includes(config.provider as ProviderId)) {
    return { success: false, error: `Proveedor invalido: "${config.provider}".` };
  }

  const existing = deps.agentRepository.findByName(config.name);
  if (existing) return { success: false, error: `El agente "${config.name}" ya existe.` };

  mkdirSync(agentsDir, { recursive: true });

  try {
    const agentDir = await deps.scaffoldAgent(config, agentsDir);

    let insertedAgent;
    try {
      insertedAgent = deps.agentRepository.insert({
        name: config.name,
        description: config.description,
        systemPrompt: config.role,
        model: '',
        hasWorkspace: config.needsWorkspace ?? false,
        path: agentDir,
        provider: config.provider ?? 'lmstudio',
      });
    } catch (dbErr: any) {
      try { deps.rmSync(agentDir, { recursive: true, force: true }); } catch {}
      throw dbErr;
    }

    deps.installAgentDeps(agentDir, (installError) => {
      deps.onInstallDone({
        agentName: config.name,
        ...(installError ? { error: installError } : {}),
      });
    });

    deps.enhanceAndPersist(
      insertedAgent.id,
      agentDir,
      config.name,
      config.role,
      deps.onEnhanceDone
    ).catch((e) => console.error('[enhancer] Error inesperado en enhance:', e));

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function handleListAgents(): Promise<ListAgentsResult> {
  const records = agentRepository.findAll();
  const agents: AgentInfo[] = records.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    hasWorkspace: r.hasWorkspace,
    status: r.status,
    createdAt: r.createdAt,
    provider: (r.provider ?? 'lmstudio') as ProviderId,
  }));
  return { agents };
}

export async function handleCreateSession(
  params: CreateSessionParams,
  deps: CreateSessionDeps
): Promise<CreateSessionResult> {
  if (!params?.agentName?.trim()) return { success: false, error: 'agentName is required' };
  const nameError = validateAgentName(params.agentName.trim());
  if (nameError) return { success: false, error: nameError };

  const agent = deps.agentRepository.findByName(params.agentName.trim());
  if (!agent) return { success: false, error: `Agente "${params.agentName}" no encontrado en la base de datos.` };
  if (agent.status === 'broken') return { success: false, error: `El agente "${params.agentName}" no se encuentra en disco. Esta marcado como roto.` };

  return deps.acpManager.createSession(params.agentName.trim(), agent.path);
}

export async function handleSaveMessage(
  params: SaveMessageParams
): Promise<SaveMessageResult> {
  if (!VALID_ROLES.includes(params.role as any)) {
    return { success: false, error: `role invalido: "${params.role}". Debe ser uno de: user, assistant, system.` };
  }
  try {
    const record = messageRepository.save({
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
    });
    return {
      success: true,
      message: {
        id: record.id,
        conversationId: record.conversationId,
        role: record.role,
        content: record.content,
        createdAt: record.createdAt,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function handleDeleteAgent(
  params: DeleteAgentParams,
  deps: DeleteAgentDeps
): Promise<DeleteAgentResult> {
  if (!params?.agentId?.trim()) return { success: false, error: 'agentId es requerido' };
  if (!params?.agentName?.trim()) return { success: false, error: 'agentName es requerido' };

  try {
    const agent = deps.agentRepository.findById(params.agentId.trim());
    if (!agent) return { success: false, error: `Agente con id "${params.agentId}" no encontrado.` };

    deps.acpManager.closeSessionByAgentName(params.agentName.trim());

    try {
      deps.rmSync(agent.path, { recursive: true, force: true });
    } catch (e: any) {
      console.error(`[deleteAgent] No se pudo borrar ${agent.path}:`, e.message);
    }

    deps.agentRepository.delete(params.agentId.trim());

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function handleLoadSettings(): Promise<LoadSettingsResult> {
  try {
    const all = settingsRepository.getAll();
    return {
      settings: { ...all, dataDir: USER_DATA_DIR },
    };
  } catch {
    // DB no disponible -- retornar defaults
    return {
      settings: {
        lmstudioHost: 'ws://127.0.0.1:1234',
        enhancerModel: '',
        dataDir: USER_DATA_DIR,
      },
    };
  }
}

export async function handleSaveSettings(
  params: SaveSettingsParams
): Promise<SaveSettingsResult> {
  if (!params?.lmstudioHost?.trim()) {
    return { success: false, error: 'lmstudioHost no puede estar vacio' };
  }
  if (params.lmstudioHost.length > 256) {
    return { success: false, error: 'lmstudioHost demasiado largo (max 256)' };
  }
  if ((params.enhancerModel ?? '').length > 128) {
    return { success: false, error: 'enhancerModel demasiado largo (max 128)' };
  }

  try {
    settingsRepository.set('lmstudio_host', params.lmstudioHost.trim());
    settingsRepository.set('enhancer_model', (params.enhancerModel ?? '').trim());
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
