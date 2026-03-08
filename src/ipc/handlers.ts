import { defineElectrobunRPC } from 'electrobun/bun';
import path from 'path';
import { promises as fs, existsSync } from 'fs';
import type { AppRPC, AgentInfo } from '../types/ipc';
import { generateAgentCore } from '../generators/agentGenerator';
import { acpManager } from './acpManager';
import { validateAgentName } from '../cli/validations';

export function createRpc() {
  const rpc = defineElectrobunRPC<AppRPC, 'bun'>('bun', {
    handlers: {
      requests: {
        generateAgent: async (config) => {
          if (!config?.name) return { success: false, error: 'Agent name required' };
          const nameError = validateAgentName(config.name);
          if (nameError) return { success: false, error: nameError };
          try {
            await generateAgentCore(config, process.cwd());
            return { success: true, agentDir: path.join(process.cwd(), config.name) };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },

        listAgents: async () => {
          const baseDir = process.cwd();
          const agents: AgentInfo[] = [];
          try {
            const entries = await fs.readdir(baseDir, { withFileTypes: true });
            await Promise.all(entries.map(async (entry) => {
              if (!entry.isDirectory()) return;
              const agentDir = path.join(baseDir, entry.name);
              const pkgPath = path.join(agentDir, 'package.json');
              const envPath = path.join(agentDir, '.env');
              if (!existsSync(pkgPath) || !existsSync(envPath)) return;
              try {
                const raw = await fs.readFile(pkgPath, 'utf-8');
                const pkg = JSON.parse(raw);
                if (!pkg.dependencies?.['@agentclientprotocol/sdk']) return;
                agents.push({
                  name: pkg.name || entry.name,
                  description: pkg.description || '',
                  hasWorkspace: existsSync(path.join(agentDir, 'workspace')),
                  path: agentDir,
                });
              } catch {}
            }));
          } catch {}
          return { agents };
        },

        createSession: async ({ agentName }) => {
          if (!agentName?.trim()) return { success: false, error: 'agentName is required' };
          const nameError = validateAgentName(agentName.trim());
          if (nameError) return { success: false, error: nameError };
          return acpManager.createSession(agentName.trim());
        },

        sendMessage: async ({ sessionId, message }) => {
          return acpManager.sendMessage(sessionId, message);
        },

        closeSession: async ({ sessionId }) => {
          acpManager.closeSession(sessionId);
        },
      },
    },
  });

  // Wire acpManager streaming events to webview via rpc.send
  acpManager.setMessageCallback((type, sessionId, data) => {
    if (type === 'chunk') {
      (rpc as any).send.agentMessageChunk({ sessionId, text: data! });
    } else if (type === 'end') {
      (rpc as any).send.agentMessageEnd({ sessionId });
    } else {
      (rpc as any).send.agentError({ sessionId, error: data || 'Unknown error' });
    }
  });

  return rpc;
}
