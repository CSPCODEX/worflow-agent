import type { RPCSchema } from 'electrobun/bun';
import type { AgentConfig } from '../cli/prompts';

export type { AgentConfig } from '../cli/prompts';

export type ProviderId = 'lmstudio' | 'ollama' | 'openai' | 'anthropic' | 'gemini';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  requiresApiKey: boolean;
  apiKeyEnvVar: string | null;
  defaultModel: string;
  isLocal: boolean;
}

export interface ListProvidersResult {
  providers: ProviderInfo[];
}

export interface GenerateAgentResult {
  success: boolean;
  error?: string;
}

export type AgentStatus = 'active' | 'broken';

export interface AgentInfo {
  name: string;
  description: string;
  hasWorkspace: boolean;
  status: AgentStatus;
  id: string;
  createdAt: string;
  provider: ProviderId;
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
  agentName: string;
  error?: string;
}

export interface AgentEnhanceDone {
  agentName: string;
  strategy: 'lmstudio' | 'static' | 'failed';
  error?: string;
}

// --- Conversation & Message types ---

export interface ConversationInfo {
  id: string;
  agentId: string;
  title: string;
  createdAt: string;
}

export interface MessageInfo {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface CreateConversationParams {
  agentId: string;
  title?: string;
}

export interface CreateConversationResult {
  success: boolean;
  conversation?: ConversationInfo;
  error?: string;
}

export interface ListConversationsParams {
  agentId: string;
}

export interface ListConversationsResult {
  conversations: ConversationInfo[];
}

export interface GetMessagesParams {
  conversationId: string;
}

export interface GetMessagesResult {
  messages: MessageInfo[];
}

export interface SaveMessageParams {
  conversationId: string;
  role: string;
  content: string;
}

export interface SaveMessageResult {
  success: boolean;
  message?: MessageInfo;
  error?: string;
}

export interface DeleteConversationParams {
  conversationId: string;
}

export interface DeleteConversationResult {
  success: boolean;
}

export interface DeleteAgentParams {
  agentId: string;
  agentName: string;
}

export interface DeleteAgentResult {
  success: boolean;
  error?: string;
}

// --- Monitor types ---

// FeatureRecord e BugRecord "seguros para IPC" — sin filePath (ruta interna)
export interface FeatureRecordIPC {
  slug: string;
  title: string;
  state: string;
  branch: string;
  openedAt: string;
  handoffs: HandoffStatusIPC[];
  metrics: AgentMetricsIPC[];
}

export interface BugRecordIPC {
  id: string;
  slug: string;
  title: string;
  state: string;
  openedAt: string;
  hasSecurityImplication: boolean;
  agentMetrics: Record<string, AgentMetricsIPC>;
}

export interface AgentMetricsIPC {
  agentId: string;
  archivosLeidos: number | null;
  archivosCreados: number | null;
  archivosModificados: number | null;
  rework: boolean | null;
  iteraciones: number | null;
  confianza: 'alta' | 'media' | 'baja' | null;
  gapsDeclarados: number | null;
}

export interface HandoffStatusIPC {
  from: string;
  to: string;
  completed: boolean;
  hasRework: boolean;
}

export interface AgentSummaryIPC {
  agentId: string;
  totalFeatures: number;
  avgIterations: number;
  reworkCount: number;
  reworkRate: number;
  avgConfidence: number;
  totalGapsDeclared: number;
  completedHandoffs: number;
}

export interface PipelineSnapshotIPC {
  features: FeatureRecordIPC[];
  bugs: BugRecordIPC[];
  agentSummaries: AgentSummaryIPC[];
  lastUpdatedAt: string;
  parseErrors: string[];
}

export interface GetPipelineSnapshotResult {
  snapshot: PipelineSnapshotIPC;
}

// --- Settings types ---

export interface AppSettings {
  lmstudioHost: string;
  enhancerModel: string;
  dataDir: string;          // readonly, valor de USER_DATA_DIR
}

export interface LoadSettingsResult {
  settings: AppSettings;
}

export interface SaveSettingsParams {
  lmstudioHost: string;
  enhancerModel: string;
}

export interface SaveSettingsResult {
  success: boolean;
  error?: string;
}

export type AppRPC = {
  bun: RPCSchema<{
    requests: {
      generateAgent: { params: AgentConfig; response: GenerateAgentResult };
      listAgents: { params: undefined; response: ListAgentsResult };
      listProviders: { params: undefined; response: ListProvidersResult };
      createSession: { params: CreateSessionParams; response: CreateSessionResult };
      sendMessage: { params: SendMessageParams; response: SendMessageResult };
      closeSession: { params: { sessionId: string }; response: void };
      createConversation: { params: CreateConversationParams; response: CreateConversationResult };
      listConversations: { params: ListConversationsParams; response: ListConversationsResult };
      getMessages: { params: GetMessagesParams; response: GetMessagesResult };
      saveMessage: { params: SaveMessageParams; response: SaveMessageResult };
      deleteConversation: { params: DeleteConversationParams; response: DeleteConversationResult };
      deleteAgent: { params: DeleteAgentParams; response: DeleteAgentResult };
      loadSettings: { params: undefined; response: LoadSettingsResult };
      saveSettings: { params: SaveSettingsParams; response: SaveSettingsResult };
      getPipelineSnapshot: { params: undefined; response: GetPipelineSnapshotResult };
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
      agentEnhanceDone: AgentEnhanceDone;
      pipelineSnapshotUpdated: PipelineSnapshotIPC;
    };
  }>;
};
