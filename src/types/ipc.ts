import type { RPCSchema } from 'electrobun/bun';
import type { AgentConfig } from '../cli/prompts';

export type { AgentConfig } from '../cli/prompts';

export interface GenerateAgentResult {
  success: boolean;
  agentDir?: string;
  error?: string;
}

export interface AgentInfo {
  name: string;
  description: string;
  hasWorkspace: boolean;
  path: string;
}

export interface ListAgentsResult {
  agents: AgentInfo[];
}

export interface CreateSessionParams {
  agentName: string;
}

export interface CreateSessionResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

export interface SendMessageParams {
  sessionId: string;
  message: string;
}

export interface SendMessageResult {
  success: boolean;
  error?: string;
}

export interface AgentMessageChunk {
  sessionId: string;
  text: string;
}

export interface AgentMessageEnd {
  sessionId: string;
}

export interface AgentError {
  sessionId: string;
  error: string;
}

export interface AgentInstallDone {
  agentDir: string;
  agentName: string;
  error?: string;
}

export type AppRPC = {
  bun: RPCSchema<{
    requests: {
      generateAgent: { params: AgentConfig; response: GenerateAgentResult };
      listAgents: { params: undefined; response: ListAgentsResult };
      createSession: { params: CreateSessionParams; response: CreateSessionResult };
      sendMessage: { params: SendMessageParams; response: SendMessageResult };
      closeSession: { params: { sessionId: string }; response: void };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      agentMessageChunk: AgentMessageChunk;
      agentMessageEnd: AgentMessageEnd;
      agentError: AgentError;
      agentInstallDone: AgentInstallDone;
    };
  }>;
};
