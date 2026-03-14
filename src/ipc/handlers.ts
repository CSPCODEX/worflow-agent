import { defineElectrobunRPC } from 'electrobun/bun';
import { rmSync } from 'fs';
import type { AppRPC, AgentEnhanceDone, ProviderId } from '../types/ipc';
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
} from './handlerLogic';

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
      },
    },
  });

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
