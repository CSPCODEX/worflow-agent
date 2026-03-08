import { defineElectrobunRPC } from 'electrobun/bun';
import { mkdirSync, rmSync } from 'fs';
import type { AppRPC, AgentInfo } from '../types/ipc';
import { scaffoldAgent, installAgentDeps } from '../generators/agentGenerator';
import { acpManager } from './acpManager';
import { validateAgentName } from '../cli/validations';
import { AGENTS_DIR } from '../db/userDataDir';
import { agentRepository } from '../db/agentRepository';
import { conversationRepository, messageRepository } from '../db/conversationRepository';

export function createRpc() {
  const rpc = defineElectrobunRPC<AppRPC, 'bun'>('bun', {
    handlers: {
      requests: {
        generateAgent: async (config) => {
          if (!config?.name) return { success: false, error: 'Agent name required' };
          const nameError = validateAgentName(config.name);
          if (nameError) return { success: false, error: nameError };

          // Validate against DB before touching the filesystem
          const existing = agentRepository.findByName(config.name);
          if (existing) return { success: false, error: `El agente "${config.name}" ya existe.` };

          mkdirSync(AGENTS_DIR, { recursive: true });

          try {
            // Phase 1 — fast: create dirs, copy templates, write files.
            const agentDir = await scaffoldAgent(config, AGENTS_DIR);

            // Register in DB immediately after scaffolding so listAgents can see it.
            try {
              agentRepository.insert({
                name: config.name,
                description: config.description,
                systemPrompt: config.role,
                model: '',
                hasWorkspace: config.needsWorkspace ?? false,
                path: agentDir,
              });
            } catch (dbErr: any) {
              // Rollback: remove the scaffolded directory to avoid orphaned folders
              try { rmSync(agentDir, { recursive: true, force: true }); } catch {}
              throw dbErr;
            }

            // Phase 2 — slow: bun install runs in background.
            installAgentDeps(agentDir, (installError) => {
              (rpc as any).send.agentInstallDone({
                agentDir,
                agentName: config.name,
                ...(installError ? { error: installError } : {}),
              });
            });

            return { success: true };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },

        listAgents: async () => {
          const records = agentRepository.findAll();
          const agents: AgentInfo[] = records.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            hasWorkspace: r.hasWorkspace,
            status: r.status,
            createdAt: r.createdAt,
          }));
          return { agents };
        },

        createSession: async ({ agentName }) => {
          if (!agentName?.trim()) return { success: false, error: 'agentName is required' };
          const nameError = validateAgentName(agentName.trim());
          if (nameError) return { success: false, error: nameError };

          const agent = agentRepository.findByName(agentName.trim());
          if (!agent) return { success: false, error: `Agente "${agentName}" no encontrado en la base de datos.` };
          if (agent.status === 'broken') return { success: false, error: `El agente "${agentName}" no se encuentra en disco. Esta marcado como roto.` };

          return acpManager.createSession(agentName.trim(), agent.path);
        },

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

        saveMessage: async ({ conversationId, role, content }) => {
          const VALID_ROLES = ['user', 'assistant', 'system'] as const;
          if (!VALID_ROLES.includes(role as any)) {
            return { success: false, error: `role inválido: "${role}". Debe ser uno de: user, assistant, system.` };
          }
          try {
            const record = messageRepository.save({ conversationId, role, content });
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
        },

        deleteConversation: async ({ conversationId }) => {
          conversationRepository.delete(conversationId);
          return { success: true };
        },
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
