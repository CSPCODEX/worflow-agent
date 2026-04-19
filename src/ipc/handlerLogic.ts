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
import type {
  CreatePipelineParams,
  CreatePipelineResult,
  ListPipelinesResult,
  GetPipelineParams,
  GetPipelineResult,
  UpdatePipelineParams,
  UpdatePipelineResult,
  DeletePipelineParams,
  DeletePipelineResult,
  ExecutePipelineParams,
  ExecutePipelineResult,
  GetPipelineRunParams,
  GetPipelineRunResult,
  ListPipelineRunsParams,
  ListPipelineRunsResult,
  RetryPipelineRunParams,
  RetryPipelineRunResult,
  StopPipelineRunParams,
  StopPipelineRunResult,
  ListPipelineTemplatesResult,
  GetPipelineTemplateParams,
  GetPipelineTemplateResult,
} from '../types/pipeline';
import { settingsRepository } from '../db/settingsRepository';
import { USER_DATA_DIR } from '../db/userDataDir';
import type { agentRepository as AgentRepo } from '../db/agentRepository';
import type { acpManager as AcpMgr } from './acpManager';
import type { scaffoldAgent as ScaffoldFn, installAgentDeps as InstallFn } from '../generators/agentGenerator';
import { agentRepository } from '../db/agentRepository';
import { messageRepository } from '../db/conversationRepository';
import { pipelineRepository } from '../db/pipelineRepository';
import { pipelineRunRepository } from '../db/pipelineRunRepository';
import { pipelineTemplateRepository } from '../db/pipelineTemplateRepository';
import { pipelineRunner } from './pipelineRunner';
import { getDatabase } from '../db/database';

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
    isDefault: r.isDefault,
  }));
  return { agents };
}

export async function handleGetAgent(params: { agentId: string }): Promise<{ agent: AgentInfo | null; error?: string }> {
  if (!params?.agentId?.trim()) return { agent: null, error: 'agentId es requerido' };
  const record = agentRepository.findById(params.agentId.trim());
  if (!record) return { agent: null, error: 'Agente no encontrado' };
  return {
    agent: {
      id: record.id,
      name: record.name,
      description: record.description,
      hasWorkspace: record.hasWorkspace,
      status: record.status,
      createdAt: record.createdAt,
      provider: record.provider as ProviderId,
      isDefault: record.isDefault,
    },
  };
}

export async function handleUpdateAgent(params: { agentId: string; name?: string; description?: string; systemPrompt?: string }): Promise<{ success: boolean; error?: string }> {
  if (!params?.agentId?.trim()) return { success: false, error: 'agentId es requerido' };
  if (params.name !== undefined) {
    const nameError = validateAgentName(params.name);
    if (nameError) return { success: false, error: nameError };
  }
  try {
    agentRepository.updateAgent(params.agentId.trim(), {
      name: params.name,
      description: params.description,
      systemPrompt: params.systemPrompt,
    });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
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

// --- Pipeline CRUD ---

export async function handleCreatePipeline(params: CreatePipelineParams): Promise<CreatePipelineResult> {
  if (!params?.name?.trim()) return { success: false, error: 'name es requerido' };
  if (!params?.steps?.length) return { success: false, error: 'Al menos un paso es requerido' };

  try {
    const db = getDatabase();
    const result = pipelineRepository.createPipeline(db, {
      name: params.name.trim(),
      description: params.description?.trim() ?? '',
      templateId: params.templateId ?? null,
      steps: params.steps.map((s) => ({
        name: s.name,
        agentId: s.agentId,
        inputTemplate: s.inputTemplate,
      })),
    });
    return { success: true, pipelineId: result.id };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function handleListPipelines(): Promise<ListPipelinesResult> {
  const db = getDatabase();
  const pipelines = pipelineRepository.listPipelines(db);
  return {
    pipelines: pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      stepCount: p.stepCount,
      lastRunAt: p.lastRun ?? null,
      lastRunStatus: null,
      createdAt: p.createdAt,
    })),
  };
}

export async function handleGetPipeline(params: GetPipelineParams): Promise<GetPipelineResult> {
  if (!params?.pipelineId?.trim()) return { pipeline: null };
  const db = getDatabase();
  const pipeline = pipelineRepository.getPipeline(db, params.pipelineId.trim());
  if (!pipeline) return { pipeline: null };

  return {
    pipeline: {
      id: pipeline.id,
      name: pipeline.name,
      description: pipeline.description,
      steps: pipeline.steps.map((s) => {
        const agent = agentRepository.findById(s.agentId);
        return {
          id: s.id,
          order: s.stepOrder,
          name: s.name,
          agentId: s.agentId,
          agentName: agent?.name ?? 'Unknown',
          inputTemplate: s.inputTemplate,
        };
      }),
    },
  };
}

export async function handleUpdatePipeline(params: UpdatePipelineParams): Promise<UpdatePipelineResult> {
  if (!params?.pipelineId?.trim()) return { success: false, error: 'pipelineId es requerido' };
  try {
    const db = getDatabase();
    pipelineRepository.updatePipeline(db, params.pipelineId.trim(), {
      name: params.name?.trim(),
      description: params.description?.trim(),
      steps: params.steps?.map((s) => ({
        name: s.name,
        agentId: s.agentId,
        inputTemplate: s.inputTemplate,
      })),
    });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function handleDeletePipeline(params: DeletePipelineParams): Promise<DeletePipelineResult> {
  if (!params?.pipelineId?.trim()) return { success: false, error: 'pipelineId es requerido' };
  try {
    const db = getDatabase();
    pipelineRepository.deletePipeline(db, params.pipelineId.trim());
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// --- Pipeline Execution ---

export async function handleExecutePipeline(params: ExecutePipelineParams): Promise<ExecutePipelineResult> {
  if (!params?.pipelineId?.trim()) return { success: false, error: 'pipelineId es requerido' };

  try {
    const db = getDatabase();
    const pipeline = pipelineRepository.getPipeline(db, params.pipelineId.trim());
    if (!pipeline) return { success: false, error: 'Pipeline no encontrado' };

    const run = pipelineRunRepository.createRun(db, params.pipelineId.trim(), params.variables ?? {});

    // Fire-and-forget: launch runner async, return runId immediately
    pipelineRunner.execute({
      pipelineId: params.pipelineId.trim(),
      variables: params.variables ?? {},
      runId: run.id,
    }).catch((e) => console.error('[pipelineRunner] execute error:', e));

    return { success: true, runId: run.id };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function handleGetPipelineRun(params: GetPipelineRunParams): Promise<GetPipelineRunResult> {
  if (!params?.runId?.trim()) return { run: null };
  const db = getDatabase();
  const run = pipelineRunRepository.getRun(db, params.runId.trim());
  if (!run) return { run: null };

  const pipeline = pipelineRepository.getPipeline(db, run.pipelineId);

  return {
    run: {
      id: run.id,
      pipelineId: run.pipelineId,
      pipelineName: pipeline?.name ?? 'Unknown',
      status: run.status,
      variables: run.variables,
      steps: run.stepRuns.map((sr) => ({
        stepName: sr.agentName,
        agentName: sr.agentName,
        status: sr.status,
        output: sr.output,
        startedAt: sr.startedAt,
        completedAt: sr.completedAt,
      })),
      startedAt: run.startedAt ?? run.createdAt,
      completedAt: run.completedAt,
      error: run.error,
    },
  };
}

export async function handleListPipelineRuns(params: ListPipelineRunsParams): Promise<ListPipelineRunsResult> {
  if (!params?.pipelineId?.trim()) return { runs: [], totalCount: 0 };
  const db = getDatabase();
  const runs = pipelineRunRepository.listRuns(db, params.pipelineId.trim(), params.limit ?? 20, params.offset ?? 0);
  return {
    runs: runs.map((r) => ({
      id: r.id,
      status: r.status,
      variables: r.variables,
      startedAt: r.startedAt ?? r.createdAt,
      completedAt: r.completedAt,
    })),
    totalCount: runs.length,
  };
}

export async function handleRetryPipelineRun(params: RetryPipelineRunParams): Promise<RetryPipelineRunResult> {
  if (!params?.runId?.trim()) return { success: false, error: 'runId es requerido' };
  try {
    const db = getDatabase();
    const run = pipelineRunRepository.getRun(db, params.runId.trim());
    if (!run) return { success: false, error: 'Run no encontrado' };

    pipelineRunner.resume({ runId: params.runId.trim(), fromStepIndex: 0 }).catch((e) =>
      console.error('[pipelineRunner] resume error:', e)
    );
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function handleStopPipelineRun(params: StopPipelineRunParams): Promise<StopPipelineRunResult> {
  if (!params?.runId?.trim()) return { success: false, error: 'runId es requerido' };
  try {
    pipelineRunner.stop(params.runId.trim());
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// --- Templates ---

export async function handleListPipelineTemplates(): Promise<ListPipelineTemplatesResult> {
  const db = getDatabase();
  const templates = pipelineTemplateRepository.listTemplates(db);
  return {
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      stepCount: t.stepCount,
      isBuiltin: t.isBuiltin,
      recommendedModel: t.recommendedModel,
    })),
  };
}

export async function handleGetPipelineTemplate(params: GetPipelineTemplateParams): Promise<GetPipelineTemplateResult> {
  if (!params?.templateId?.trim()) return { template: null };
  const db = getDatabase();
  const template = pipelineTemplateRepository.getTemplate(db, params.templateId.trim());
  if (!template) return { template: null };

  return {
    template: {
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      variables: template.variables,
      steps: template.steps,
      isBuiltin: template.isBuiltin,
    },
  };
}

// --- Onboarding ---

export async function handleGetOnboardingCompleted(): Promise<{ completed: boolean }> {
  const value = settingsRepository.get('onboarding_completed');
  return { completed: value === 'true' };
}

export async function handleSetOnboardingCompleted(completed: boolean): Promise<{ success: boolean }> {
  try {
    settingsRepository.set('onboarding_completed', completed ? 'true' : 'false');
    return { success: true };
  } catch (e: any) {
    return { success: false };
  }
}

// --- Provider Detection ---

export async function handleDetectLocalProviders(): Promise<{ providers: Array<{ id: string; label: string; available: boolean; host: string }> }> {
  const providers = [
    { id: 'lmstudio', label: 'LM Studio', host: 'http://127.0.0.1:1234' },
    { id: 'ollama', label: 'Ollama', host: 'http://127.0.0.1:11434' },
  ];

  const results = await Promise.all(
    providers.map(async (p) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(p.host + '/api/tags', { signal: controller.signal });
        clearTimeout(timeoutId);
        return { ...p, available: res.ok };
      } catch {
        return { ...p, available: false };
      }
    })
  );

  return { providers: results };
}

export async function handleValidateProviderConnection(params: { providerId: string; apiKey?: string }): Promise<{ success: boolean; error?: string }> {
  if (!params?.providerId) return { success: false, error: 'providerId es requerido' };

  const hosts: Record<string, string> = {
    lmstudio: 'http://127.0.0.1:1234',
    ollama: 'http://127.0.0.1:11434',
  };

  const host = hosts[params.providerId];
  if (!host) return { success: false, error: 'Provider no soportado para validacion' };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(host + '/api/tags', { signal: controller.signal });
    clearTimeout(timeoutId);
    return { success: res.ok };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
