import { defineElectrobunRPC } from 'electrobun/bun';
import { rmSync, existsSync } from 'fs';
import path from 'path';
import type { AppRPC, AgentEnhanceDone, ProviderId, PipelineSnapshotIPC, AgentMetricsIPC } from '../types/ipc';
import { scaffoldAgent, installAgentDeps, rewriteAgentIndexTs } from '../generators/agentGenerator';
import { acpManager } from './acpManager';
import { AGENTS_DIR } from '../db/userDataDir';
import { agentRepository } from '../db/agentRepository';
import { conversationRepository, messageRepository } from '../db/conversationRepository';
import { enhancePrompt } from '../enhancer/promptEnhancer';
import {
  handleGenerateAgent,
  handleListAgents,
  handleCreateSession,
  handleSaveMessage,
  handleDeleteAgent,
  handleLoadSettings,
  handleSaveSettings,
} from './handlerLogic';
import { PipelinePoller } from '../monitor/index';
import type { PipelineSnapshot } from '../monitor/index';

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
console.log('[monitor] docsDir:', docsDir);
const poller = new PipelinePoller({ docsDir, pollIntervalMs: 30_000 });
// NOTA: poller.start() se llama dentro de createRpc(), despues de registrar onSnapshot,
// para garantizar que el primer scan ya tenga el callback registrado y el push llegue al renderer.

function sanitizeForIpc(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '?');
}

function snapshotToIPC(snapshot: PipelineSnapshot): PipelineSnapshotIPC {
  return {
    features: snapshot.features.map(({ filePath: _fp, ...f }) => ({
      ...f,
      handoffs: f.handoffs,
      metrics: f.metrics,
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

        getPipelineSnapshot: async () => {
          const snapshot = poller.getSnapshot();
          return { snapshot: snapshotToIPC(snapshot) };
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

  return rpc;
}
