import type { RPCSchema } from 'electrobun/bun';
import type { AgentConfig } from '../cli/prompts';
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
  DetectLocalProvidersResult,
  ValidateConnectionParams,
  ValidateConnectionResult,
  PipelineRunStepUpdated,
  PipelineRunCompleted,
} from './pipeline';

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
  isDefault: boolean;
}

export interface GetAgentParams {
  agentId: string;
}

export interface GetAgentResult {
  agent: AgentInfo | null;
  error?: string;
}

export interface UpdateAgentParams {
  agentId: string;
  name?: string;
  description?: string;
  systemPrompt?: string;
}

export interface UpdateAgentResult {
  success: boolean;
  error?: string;
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

// FeatureRecord e BugRecord "seguros para IPC" -- sin filePath (ruta interna)
export interface AgentBehaviorMetricsIPC {
  agentId: string;
  checklistTotal: number | null;
  checklistChecked: number | null;
  checklistRate: number | null;
  structureScore: number | null;
  hallucinationRefsTotal: number | null;
  hallucinationRefsValid: number | null;
  hallucinationRate: number | null;
  memoryRead: boolean | null;
}

export interface AgentBehaviorPointIPC {
  itemSlug: string;
  itemType: 'feature' | 'bug';
  checklistRate: number | null;
  structureScore: number | null;
  hallucinationRate: number | null;
  memoryRead: number | null;   // 0 o 1 para eje Y numerico
  recordedAt: string;
}

export interface GetAgentBehaviorTimelineParams {
  agentId: string;
}

export interface GetAgentBehaviorTimelineResult {
  points: AgentBehaviorPointIPC[];
}

export interface FeatureRecordIPC {
  slug: string;
  title: string;
  state: string;
  branch: string;
  openedAt: string;
  handoffs: HandoffStatusIPC[];
  metrics: AgentMetricsIPC[];
  behaviorMetrics: Record<string, AgentBehaviorMetricsIPC>;
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
  // Metricas de comportamiento calculadas externamente
  avgChecklistRate: number | null;
  avgStructureScore: number | null;
  avgHallucinationRate: number | null;
  memoryReadRate: number | null;
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

// --- Monitor History types ---

export type PipelineEventType =
  | 'feature_state_changed'
  | 'bug_state_changed'
  | 'handoff_completed'
  | 'metrics_updated';

export interface HistoryEventIPC {
  id: number;
  eventType: PipelineEventType;
  itemType: 'feature' | 'bug';
  itemSlug: string;
  itemTitle: string;
  fromValue: string | null;
  toValue: string;
  agentId: string | null;
  recordedAt: string;
}

export interface AgentTrendIPC {
  agentId: string;
  historicReworkRate: number;
  historicAvgIterations: number;
  historicAvgConfidence: number;
  totalHistoricSamples: number;
  reworkTrend: 'mejorando' | 'empeorando' | 'estable' | 'sin_datos';
}

export interface GetHistoryParams {
  itemSlug?: string;
  itemType?: 'feature' | 'bug';
  agentId?: string;
  eventType?: PipelineEventType;
  limit?: number;
  offset?: number;
}

export interface GetHistoryResult {
  events: HistoryEventIPC[];
  totalCount: number;
}

export interface GetAgentTrendsResult {
  trends: AgentTrendIPC[];
}

// --- Monitor Agent Timeline types ---

export interface AgentTimelinePoint {
  itemSlug: string;
  itemType: 'feature' | 'bug';
  rework: number | null;      // 0 or 1
  iteraciones: number | null;
  confianza: number | null;   // 1=baja, 2=media, 3=alta
  recordedAt: string;
}

export interface GetAgentTimelineParams {
  agentId: string;
}

export interface GetAgentTimelineResult {
  points: AgentTimelinePoint[];
}

// ── Compliance IPC ──

export interface ComplianceScoreIPC {
  id: number;
  featureSlug: string;
  score: number;
  filesSpec: number;
  filesOk: number;
  filesViol: number;
  branch: string;
  baseRef: string;
  recordedAt: string;
}

export interface GetComplianceScoresParams {
  featureSlug?: string;
  limit?: number;
  offset?: number;
}

export interface GetComplianceScoresResult {
  scores: ComplianceScoreIPC[];
  totalCount: number;
}

export interface RejectionRecordIPC {
  id: number;
  featureSlug: string;
  agentAtFault: string;
  instructionViolated: string;
  instructionSource: 'CLAUDE.md' | 'agent_system_prompt' | 'handoff_anterior';
  failureType: 'patron_conocido' | 'instruccion_ambigua' | 'instruccion_ausente';
  recordedAt: string;
}

export interface RejectionPatternAggregate {
  agentId: string;
  totalRejections: number;
  byFailureType: {
    patron_conocido: number;
    instruccion_ambigua: number;
    instruccion_ausente: number;
  };
  bySource: {
    'CLAUDE.md': number;
    agent_system_prompt: number;
    handoff_anterior: number;
  };
  mostFrequentViolation: string | null;
}

export interface GetRejectionPatternsParams {
  agentId?: string;
  featureSlug?: string;
  limit?: number;
  offset?: number;
}

export interface GetRejectionPatternsResult {
  records: RejectionRecordIPC[];
  totalCount: number;
  aggregates: RejectionPatternAggregate[];
}

// --- Settings types ---

export interface AppSettings {
  dataDir: string;          // readonly, valor de USER_DATA_DIR
  defaultProvider: string;
  defaultProviderConfig: string;
}

export interface LoadSettingsResult {
  settings: AppSettings;
}

export interface SaveSettingsParams {
  defaultProvider?: string;
  defaultProviderConfig?: string;
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
      getAgent: { params: GetAgentParams; response: GetAgentResult };
      updateAgent: { params: UpdateAgentParams; response: UpdateAgentResult };
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
      getHistory: { params: GetHistoryParams; response: GetHistoryResult };
      getAgentTrends: { params: undefined; response: GetAgentTrendsResult };
      getAgentTimeline: { params: GetAgentTimelineParams; response: GetAgentTimelineResult };
      getAgentBehaviorTimeline: { params: GetAgentBehaviorTimelineParams; response: GetAgentBehaviorTimelineResult };
      getComplianceScores: { params: GetComplianceScoresParams; response: GetComplianceScoresResult };
      getRejectionPatterns: { params: GetRejectionPatternsParams; response: GetRejectionPatternsResult };
      // Pipeline CRUD
      createPipeline: { params: CreatePipelineParams; response: CreatePipelineResult };
      listPipelines: { params: undefined; response: ListPipelinesResult };
      getPipeline: { params: GetPipelineParams; response: GetPipelineResult };
      updatePipeline: { params: UpdatePipelineParams; response: UpdatePipelineResult };
      deletePipeline: { params: DeletePipelineParams; response: DeletePipelineResult };
      // Pipeline Execution
      executePipeline: { params: ExecutePipelineParams; response: ExecutePipelineResult };
      getPipelineRun: { params: GetPipelineRunParams; response: GetPipelineRunResult };
      listPipelineRuns: { params: ListPipelineRunsParams; response: ListPipelineRunsResult };
      retryPipelineRun: { params: RetryPipelineRunParams; response: RetryPipelineRunResult };
      stopPipelineRun: { params: StopPipelineRunParams; response: StopPipelineRunResult };
      // Templates
      listPipelineTemplates: { params: undefined; response: ListPipelineTemplatesResult };
      getPipelineTemplate: { params: GetPipelineTemplateParams; response: GetPipelineTemplateResult };
      // Provider Detection
      detectLocalProviders: { params: undefined; response: DetectLocalProvidersResult };
      validateProviderConnection: { params: ValidateConnectionParams; response: ValidateConnectionResult };
      // Onboarding
      getOnboardingCompleted: { params: undefined; response: { completed: boolean } };
      setOnboardingCompleted: { params: { completed: boolean }; response: { success: boolean } };
      // Utilities
      openExternal: { params: { url: string }; response: { success: boolean } };
      encryptApiKey: { params: { plaintext: string }; response: { encrypted: string } };
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
      pipelineRunStepUpdated: PipelineRunStepUpdated;
      pipelineRunCompleted: PipelineRunCompleted;
    };
  }>;
};
