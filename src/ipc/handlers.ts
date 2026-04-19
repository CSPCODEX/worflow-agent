import { defineElectrobunRPC, Utils } from 'electrobun/bun';
import { rmSync, existsSync } from 'fs';
import path, { join } from 'path';
import type { AppRPC, AgentEnhanceDone, ProviderId, PipelineSnapshotIPC, AgentMetricsIPC, GetHistoryParams, GetHistoryResult, GetAgentTrendsResult, GetAgentTimelineParams, GetAgentTimelineResult, GetAgentBehaviorTimelineParams, GetAgentBehaviorTimelineResult, GetComplianceScoresParams, GetComplianceScoresResult, GetRejectionPatternsParams, GetRejectionPatternsResult } from '../types/ipc';
import { scaffoldAgent, installAgentDeps, rewriteAgentIndexTs } from '../generators/agentGenerator';
import { acpManager } from './acpManager';
import { AGENTS_DIR, USER_DATA_DIR } from '../db/userDataDir';
import { agentRepository } from '../db/agentRepository';
import { conversationRepository, messageRepository } from '../db/conversationRepository';
import { enhancePrompt } from '../enhancer/promptEnhancer';
import {
  handleGenerateAgent,
  handleListAgents,
  handleGetAgent,
  handleUpdateAgent,
  handleCreateSession,
  handleSaveMessage,
  handleDeleteAgent,
  handleLoadSettings,
  handleSaveSettings,
  handleCreatePipeline,
  handleListPipelines,
  handleGetPipeline,
  handleUpdatePipeline,
  handleDeletePipeline,
  handleExecutePipeline,
  handleGetPipelineRun,
  handleListPipelineRuns,
  handleRetryPipelineRun,
  handleStopPipelineRun,
  handleListPipelineTemplates,
  handleGetPipelineTemplate,
  handleDetectLocalProviders,
  handleValidateProviderConnection,
  handleGetOnboardingCompleted,
  handleSetOnboardingCompleted,
} from './handlerLogic';
import { PipelinePoller, getHistoryDb, queryHistory, queryAgentTrends, queryAgentTimeline, queryAgentBehaviorTimeline, queryComplianceScores, queryRejectionPatterns } from '../dev-tools/monitor/index';
import type { PipelineSnapshot } from '../dev-tools/monitor/index';
import { pipelineRunner } from './pipelineRunner';

// Agentes validos del pipeline — usados para whitelisting en handlers IPC.
const VALID_AGENTS = ['leo', 'cloe', 'max', 'ada', 'cipher'] as const;
type ValidAgentId = typeof VALID_AGENTS[number];

// Instanciar poller. Busca docs/ subiendo desde process.cwd() hasta encontrarlo.
// En Electrobun dev, process.cwd() apunta al bin/ del build, no al repo root.
// En produccion docs/ no existe y el monitor retornara snapshot vacio.
function findDocsDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'docs');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), 'docs');
}
const docsDir = findDocsDir();
const repoRoot = path.dirname(docsDir);
console.log('[monitor] docsDir:', docsDir);
console.log('[monitor] repoRoot:', repoRoot);
const poller = new PipelinePoller({
  docsDir,
  pollIntervalMs: 30_000,
  historyDbPath: join(USER_DATA_DIR, 'monitor-history.db'),
  repoRoot,
});
// NOTA: poller.start() se llama dentro de createRpc(), despues de registrar onSnapshot,
// para garantizar que el primer scan ya tenga el callback registrado y el push llegue al renderer.

function sanitizeForIpc(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '?');
}

function snapshotToIPC(snapshot: PipelineSnapshot): PipelineSnapshotIPC {
  return {
    features: snapshot.features.map(({ filePath: _fp, leoContract: _lc, rejectionRecords: _rr, ...f }) => ({
      ...f,
      handoffs: f.handoffs,
      metrics: f.metrics,
      behaviorMetrics: Object.fromEntries(
        Object.entries(f.behaviorMetrics ?? {}).map(([agentId, bm]) => [
          agentId,
          {
            agentId: bm!.agentId,
            checklistTotal: bm!.checklistTotal,
            checklistChecked: bm!.checklistChecked,
            checklistRate: bm!.checklistRate,
            structureScore: bm!.structureScore,
            hallucinationRefsTotal: bm!.hallucinationRefsTotal,
            hallucinationRefsValid: bm!.hallucinationRefsValid,
            hallucinationRate: bm!.hallucinationRate,
            memoryRead: bm!.memoryRead,
          },
        ])
      ),
    })),
    bugs: snapshot.bugs.map(({ filePath: _fp, ...b }) => ({
      ...b,
      agentMetrics: b.agentMetrics as Record<string, AgentMetricsIPC>,
    })),
    agentSummaries: snapshot.agentSummaries,
    lastUpdatedAt: snapshot.lastUpdatedAt,
    parseErrors: snapshot.parseErrors.map(sanitizeForIpc),
  };
}

async function enhanceAndPersist(
  agentId: string,
  agentDir: string,
  agentName: string,
  originalPrompt: string,
  rpcSend: (payload: AgentEnhanceDone) => void
): Promise<void> {
  const result = await enhancePrompt(originalPrompt, agentName);

  // 'lmstudio' maps to 'done' in the DB schema; 'static' and 'failed' are stored as-is.
  const dbStatus = result.strategy === 'lmstudio' ? 'done' : result.strategy;
  agentRepository.updateSystemPrompt(agentId, result.enhancedPrompt, dbStatus);

  try {
    await rewriteAgentIndexTs(agentDir, result.enhancedPrompt);
  } catch (e: any) {
    console.error('[enhancer] No se pudo reescribir index.ts:', e.message);
  }

  rpcSend({
    agentName,
    strategy: result.strategy,
    ...(result.error ? { error: result.error } : {}),
  });
}

export function getPoller(): PipelinePoller {
  return poller;
}

export function createRpc() {
  const rpc = defineElectrobunRPC<AppRPC, 'bun'>('bun', {
    handlers: {
      requests: {
        listProviders: async () => {
          return {
            providers: [
              { id: 'lmstudio' as ProviderId, label: 'LM Studio', requiresApiKey: false, apiKeyEnvVar: null, defaultModel: '', isLocal: true },
              { id: 'ollama' as ProviderId, label: 'Ollama', requiresApiKey: false, apiKeyEnvVar: null, defaultModel: 'llama3.2', isLocal: true },
              { id: 'openai' as ProviderId, label: 'OpenAI', requiresApiKey: true, apiKeyEnvVar: 'OPENAI_API_KEY', defaultModel: 'gpt-4o-mini', isLocal: false },
              { id: 'anthropic' as ProviderId, label: 'Anthropic', requiresApiKey: true, apiKeyEnvVar: 'ANTHROPIC_API_KEY', defaultModel: 'claude-3-5-haiku-20241022', isLocal: false },
              { id: 'gemini' as ProviderId, label: 'Gemini', requiresApiKey: true, apiKeyEnvVar: 'GEMINI_API_KEY', defaultModel: 'gemini-2.0-flash', isLocal: false },
            ],
          };
        },

        generateAgent: async (config) =>
          handleGenerateAgent(config, AGENTS_DIR, {
            agentRepository,
            scaffoldAgent,
            installAgentDeps,
            enhanceAndPersist,
            onInstallDone: (p) => (rpc as any).send.agentInstallDone(p),
            onEnhanceDone: (p) => (rpc as any).send.agentEnhanceDone(p),
            rmSync,
          }),

        listAgents: async () => handleListAgents(),

        getAgent: async (params) => handleGetAgent(params),

        updateAgent: async (params) => handleUpdateAgent(params),

        createSession: async (params) =>
          handleCreateSession(params, { agentRepository, acpManager }),

        sendMessage: async ({ sessionId, message }) => {
          return acpManager.sendMessage(sessionId, message);
        },

        closeSession: async ({ sessionId }) => {
          acpManager.closeSession(sessionId);
        },

        createConversation: async ({ agentId, title }) => {
          try {
            const conversation = conversationRepository.create({ agentId, title });
            return {
              success: true,
              conversation: {
                id: conversation.id,
                agentId: conversation.agentId,
                title: conversation.title,
                createdAt: conversation.createdAt,
              },
            };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },

        listConversations: async ({ agentId }) => {
          const records = conversationRepository.findByAgent(agentId);
          return {
            conversations: records.map((r) => ({
              id: r.id,
              agentId: r.agentId,
              title: r.title,
              createdAt: r.createdAt,
            })),
          };
        },

        getMessages: async ({ conversationId }) => {
          const records = messageRepository.findByConversation(conversationId);
          return {
            messages: records.map((r) => ({
              id: r.id,
              conversationId: r.conversationId,
              role: r.role,
              content: r.content,
              createdAt: r.createdAt,
            })),
          };
        },

        saveMessage: async (params) => handleSaveMessage(params),

        deleteConversation: async ({ conversationId }) => {
          conversationRepository.delete(conversationId);
          return { success: true };
        },

        deleteAgent: async (params) =>
          handleDeleteAgent(params, { agentRepository, acpManager, rmSync }),

        loadSettings: async () => handleLoadSettings(),

        saveSettings: async (params) => handleSaveSettings(params),

        // --- Pipeline CRUD ---
        createPipeline: async (params) => handleCreatePipeline(params),
        listPipelines: async () => handleListPipelines(),
        getPipeline: async (params) => handleGetPipeline(params),
        updatePipeline: async (params) => handleUpdatePipeline(params),
        deletePipeline: async (params) => handleDeletePipeline(params),

        // --- Pipeline Execution ---
        executePipeline: async (params) => handleExecutePipeline(params),
        getPipelineRun: async (params) => handleGetPipelineRun(params),
        listPipelineRuns: async (params) => handleListPipelineRuns(params),
        retryPipelineRun: async (params) => handleRetryPipelineRun(params),
        stopPipelineRun: async (params) => handleStopPipelineRun(params),

        // --- Pipeline Templates ---
        listPipelineTemplates: async () => handleListPipelineTemplates(),
        getPipelineTemplate: async (params) => handleGetPipelineTemplate(params),

        // --- Provider Detection ---
        detectLocalProviders: async () => handleDetectLocalProviders(),
        validateProviderConnection: async (params) => handleValidateProviderConnection(params),

        // --- Onboarding ---
        getOnboardingCompleted: async () => handleGetOnboardingCompleted(),
        setOnboardingCompleted: async (params) => handleSetOnboardingCompleted(params.completed),

        // --- Utilities ---
        openExternal: async (params: { url: string }) => {
          try {
            Utils.openExternal(params.url);
            return { success: true };
          } catch (e: any) {
            return { success: false };
          }
        },

        getPipelineSnapshot: async () => {
          const snapshot = poller.getSnapshot();
          return { snapshot: snapshotToIPC(snapshot) };
        },

        getHistory: async (params: GetHistoryParams): Promise<GetHistoryResult> => {
          const db = getHistoryDb();
          if (!db) return { events: [], totalCount: 0 };
          try {
            // Validar params — whitelist para campos sensibles
            const safeParams = {
              itemSlug: typeof params?.itemSlug === 'string' ? params.itemSlug : undefined,
              itemType:
                params?.itemType === 'feature' || params?.itemType === 'bug'
                  ? params.itemType
                  : undefined,
              agentId: (VALID_AGENTS as readonly string[]).includes(params?.agentId ?? '')
                ? (params.agentId as ValidAgentId)
                : undefined,
              eventType: [
                'feature_state_changed',
                'bug_state_changed',
                'handoff_completed',
                'metrics_updated',
              ].includes(params?.eventType ?? '')
                ? params.eventType
                : undefined,
              limit: typeof params?.limit === 'number' ? Math.min(params.limit, 500) : 100,
              offset: typeof params?.offset === 'number' ? Math.max(params.offset, 0) : 0,
            };
            const result = queryHistory(db, safeParams);
            return {
              events: result.events.map((e) => ({
                ...e,
                // Sanitizar strings a ASCII puro (BUG #001 — IPC no soporta non-ASCII en Windows)
                itemTitle: e.itemTitle.replace(/[^\x20-\x7E]/g, '?'),
                fromValue: e.fromValue?.replace(/[^\x20-\x7E]/g, '?') ?? null,
                toValue: e.toValue.replace(/[^\x20-\x7E]/g, '?'),
              })),
              totalCount: result.totalCount,
            };
          } catch (e: any) {
            console.error('[handlers] getHistory error:', e.message);
            return { events: [], totalCount: 0 };
          }
        },

        getAgentTrends: async (_params: undefined): Promise<GetAgentTrendsResult> => {
          const db = getHistoryDb();
          if (!db) return { trends: [] };
          try {
            const snapshot = poller.getSnapshot();
            const currentSummaries = snapshot.agentSummaries.map((s) => ({
              agentId: s.agentId,
              reworkRate: s.reworkRate,
              avgIterations: s.avgIterations,
              avgConfidence: s.avgConfidence,
            }));
            const trends = queryAgentTrends(db, currentSummaries);
            return { trends };
          } catch (e: any) {
            console.error('[handlers] getAgentTrends error:', e.message);
            return { trends: [] };
          }
        },

        getAgentTimeline: async (params: GetAgentTimelineParams): Promise<GetAgentTimelineResult> => {
          const db = getHistoryDb();
          if (!db) return { points: [] };
          if (!VALID_AGENTS.includes(params?.agentId as any)) return { points: [] };
          try {
            const points = queryAgentTimeline(db, params.agentId);
            return { points };
          } catch (e: any) {
            console.error('[handlers] getAgentTimeline error:', e.message);
            return { points: [] };
          }
        },

        getAgentBehaviorTimeline: async (params: GetAgentBehaviorTimelineParams): Promise<GetAgentBehaviorTimelineResult> => {
          const db = getHistoryDb();
          if (!db) return { points: [] };
          if (!VALID_AGENTS.includes(params?.agentId as any)) return { points: [] };
          try {
            const points = queryAgentBehaviorTimeline(db, params.agentId);
            return { points };
          } catch (e: any) {
            console.error('[handlers] getAgentBehaviorTimeline error:', e.message);
            return { points: [] };
          }
        },

        getComplianceScores: async (params: GetComplianceScoresParams): Promise<GetComplianceScoresResult> => {
          // Validar params
          if (params.featureSlug && !/^[a-z0-9-]+$/.test(params.featureSlug)) {
            return { scores: [], totalCount: 0 };
          }
          const limit = typeof params.limit === 'number' && params.limit > 0 && params.limit <= 500
            ? params.limit : 100;
          const offset = typeof params.offset === 'number' && params.offset >= 0
            ? params.offset : 0;

          const db = getHistoryDb();
          if (!db) return { scores: [], totalCount: 0 };
          try {
            const raw = queryComplianceScores(db, { ...params, limit, offset });
            return {
              totalCount: raw.totalCount,
              scores: raw.scores.map((s) => ({
                ...s,
                featureSlug: sanitizeForIpc(s.featureSlug),
                branch: sanitizeForIpc(s.branch),
                baseRef: sanitizeForIpc(s.baseRef),
              })),
            };
          } catch (e: any) {
            console.error('[handlers] getComplianceScores error:', e.message);
            return { scores: [], totalCount: 0 };
          }
        },

        getRejectionPatterns: async (params: GetRejectionPatternsParams): Promise<GetRejectionPatternsResult> => {
          if (params.featureSlug && !/^[a-z0-9-]+$/.test(params.featureSlug)) {
            return { records: [], totalCount: 0, aggregates: [] };
          }
          if (params.agentId && !(VALID_AGENTS as readonly string[]).includes(params.agentId)) {
            return { records: [], totalCount: 0, aggregates: [] };
          }
          const limit = typeof params.limit === 'number' && params.limit > 0 && params.limit <= 500
            ? params.limit : 100;
          const offset = typeof params.offset === 'number' && params.offset >= 0
            ? params.offset : 0;

          const db = getHistoryDb();
          if (!db) return { records: [], totalCount: 0, aggregates: [] };
          try {
            const raw = queryRejectionPatterns(db, { ...params, limit, offset });
            return {
              totalCount: raw.totalCount,
              records: raw.records.map((r) => ({
                ...r,
                agentAtFault: sanitizeForIpc(r.agentAtFault),
                instructionViolated: sanitizeForIpc(r.instructionViolated),
              })),
              aggregates: raw.aggregates.map((a) => ({
                ...a,
                mostFrequentViolation: a.mostFrequentViolation !== null
                  ? sanitizeForIpc(a.mostFrequentViolation)
                  : null,
              })),
            };
          } catch (e: any) {
            console.error('[handlers] getRejectionPatterns error:', e.message);
            return { records: [], totalCount: 0, aggregates: [] };
          }
        },
      },
    },
  });

  // Wire poller snapshot events to webview via rpc.send.
  // onSnapshot se registra ANTES de start() para que el primer scan llegue al renderer.
  poller.onSnapshot((snapshot) => {
    try {
      (rpc as any).send.pipelineSnapshotUpdated(snapshotToIPC(snapshot));
    } catch (_e) {
      // Transport no listo aun (scan inicial en startup) — el renderer pide el snapshot via getPipelineSnapshot al abrir la vista
    }
  });

  // Arrancar el poller aqui garantiza que onSnapshot ya esta registrado
  // cuando se ejecuta el primer scan inmediato dentro de start().
  poller.start();

  // Wire acpManager streaming events to webview via rpc.send
  acpManager.setMessageCallback((type, sessionId, data) => {
    if (type === 'chunk') {
      (rpc as any).send.agentMessageChunk({ sessionId, text: encodeURIComponent(data!) });
    } else if (type === 'end') {
      (rpc as any).send.agentMessageEnd({ sessionId });
    } else {
      (rpc as any).send.agentError({ sessionId, error: data || 'Unknown error' });
    }
  });

  // Wire PipelineRunner events to webview messages
  pipelineRunner.onStepStart(({ runId, stepIndex }) => {
    (rpc as any).send.pipelineRunStepUpdated({ runId, stepIndex, status: 'running' });
  });

  pipelineRunner.onStepComplete(({ runId, stepIndex, output }) => {
    (rpc as any).send.pipelineRunStepUpdated({ runId, stepIndex, status: 'completed', output });
  });

  pipelineRunner.onStepError(({ runId, stepIndex, error }) => {
    (rpc as any).send.pipelineRunStepUpdated({ runId, stepIndex, status: 'failed', error });
  });

  pipelineRunner.onPipelineComplete(({ runId }) => {
    (rpc as any).send.pipelineRunCompleted({ runId, status: 'completed' });
  });

  pipelineRunner.onPipelineError(({ runId, error }) => {
    (rpc as any).send.pipelineRunCompleted({ runId, status: 'failed', error });
  });

  return rpc;
}
