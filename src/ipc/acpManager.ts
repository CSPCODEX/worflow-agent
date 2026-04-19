import { spawn, type ChildProcess } from 'node:child_process';
import { Writable, Readable } from 'node:stream';
import {
  ndJsonStream,
  ClientSideConnection,
  PROTOCOL_VERSION,
  type Client,
  type SessionNotification,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ReadTextFileResponse,
  type WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

type MessageCallbackType = 'chunk' | 'end' | 'error';
type MessageCallback = (type: MessageCallbackType, sessionId: string, data?: string) => void;

interface Session {
  process: ChildProcess;
  connection: ClientSideConnection;
  acpSessionId: string;
  agentName: string;
}

class AcpManager {
  private sessions = new Map<string, Session>();
  private onMessage?: MessageCallback;

  setMessageCallback(cb: MessageCallback | undefined) {
    this.onMessage = cb;
  }

  getMessageCallback(): MessageCallback | undefined {
    return this.onMessage;
  }

  async createSession(agentName: string, agentPath: string): Promise<{ success: boolean; sessionId?: string; error?: string }> {
    const agentDir = agentPath;
    const agentEntry = path.join(agentDir, 'index.ts');
    const sessionId = randomUUID();
    const notify = this.onMessage;

    class StreamingClient implements Client {
      async sessionUpdate(params: SessionNotification) {
        const update = params.update;
        if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
          notify?.('chunk', sessionId, update.content.text);
        }
      }

      async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
        return { outcome: { outcome: 'selected', optionId: params.options[0].optionId } };
      }

      async readTextFile(): Promise<ReadTextFileResponse> {
        return { content: '' };
      }

      async writeTextFile(): Promise<WriteTextFileResponse> {
        return {};
      }
    }

    try {
      const agentProcess = spawn('bun', ['run', agentEntry], {
        stdio: ['pipe', 'pipe', 'inherit'], // inherit stderr so agent logs reach the main process console
        cwd: agentDir,
      });

      const stream = ndJsonStream(
        Writable.toWeb(agentProcess.stdin),
        Readable.toWeb(agentProcess.stdout)
      );

      const connection = new ClientSideConnection((_agent) => new StreamingClient(), stream);

      await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      });

      const { sessionId: acpSessionId } = await connection.newSession({
        cwd: agentDir,
        mcpServers: [],
      });

      this.sessions.set(sessionId, { process: agentProcess, connection, acpSessionId, agentName });

      agentProcess.on('error', (err) => {
        notify?.('error', sessionId, err.message);
        this.sessions.delete(sessionId);
      });

      agentProcess.on('exit', () => {
        this.sessions.delete(sessionId);
      });

      return { success: true, sessionId };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async sendMessage(sessionId: string, message: string): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false, error: `Session not found: ${sessionId}` };

    const notify = this.onMessage;

    session.connection.prompt({
      sessionId: session.acpSessionId,
      prompt: [{ type: 'text', text: message }],
    }).then(() => {
      notify?.('end', sessionId);
    }).catch((err: Error) => {
      notify?.('error', sessionId, err.message);
    });

    return { success: true };
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      try { session.process.kill(); } catch {}
      this.sessions.delete(sessionId);
    }
  }

  closeSessionByAgentName(agentName: string): void {
    // Collect all matching IDs first to avoid mutating the Map while iterating.
    const toClose = Array.from(this.sessions.entries())
      .filter(([, session]) => session.agentName === agentName)
      .map(([sessionId]) => sessionId);
    for (const sessionId of toClose) {
      this.closeSession(sessionId);
    }
  }

  closeAll(): void {
    for (const [id] of this.sessions) {
      this.closeSession(id);
    }
  }
}

export const acpManager = new AcpManager();
