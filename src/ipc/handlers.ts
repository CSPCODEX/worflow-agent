import { defineElectrobunRPC } from 'electrobun/bun';
import path from 'path';
import { promises as fs, existsSync } from 'fs';
import type { AppRPC, AgentInfo } from '../types/ipc';
import { scaffoldAgent, installAgentDeps } from '../generators/agentGenerator';
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
            // Phase 1 — fast: create dirs, copy templates, write files.
            // Returns immediately so the RPC response is sent well within the 10 s timeout.
            const agentDir = await scaffoldAgent(config, process.cwd());

            // Phase 2 — slow: bun install runs in background.
            // When it finishes, notify the renderer via the webview message channel.
            installAgentDeps(agentDir, (installError) => {
              (rpc as any).send.agentInstallDone({
                agentDir,
                agentName: config.name,
                ...(installError ? { error: installError } : {}),
              });
            });

            return { success: true, agentDir };
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
      // encodeURIComponent ensures only ASCII travels through Electrobun's IPC
      // (the evaluateJavascript fallback path can mangle non-ASCII UTF-8 bytes)
      (rpc as any).send.agentMessageChunk({ sessionId, text: encodeURIComponent(data!) });
    } else if (type === 'end') {
      (rpc as any).send.agentMessageEnd({ sessionId });
    } else {
      (rpc as any).send.agentError({ sessionId, error: data || 'Unknown error' });
    }
  });

  return rpc;
}
