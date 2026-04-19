// Pipeline domain types

export type PipelineRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';
export type StepRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  templateId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineStep {
  id: string;
  pipelineId: string;
  order: number;
  name: string;
  agentId: string;
  inputTemplate: string;
  createdAt: string;
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  pipelineName: string;
  status: PipelineRunStatus;
  variables: Record<string, string>;
  steps: PipelineStepRun[];
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface PipelineStepRun {
  stepName: string;
  agentName: string;
  status: StepRunStatus;
  output: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  category: 'content' | 'code' | 'data' | 'translation' | 'custom';
  variables: TemplateVariable[];
  steps: TemplateStep[];
  createdAt: string;
  isBuiltin: boolean;
}

export interface TemplateVariable {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'code';
  required: boolean;
  defaultValue?: string;
  placeholder?: string;
}

export interface TemplateStep {
  order: number;
  name: string;
  agentRoleHint: string;
  inputTemplate: string;
  description: string;
}

// IPC request/response params and results

export interface CreatePipelineParams {
  name: string;
  description: string;
  templateId?: string;
  steps: Array<{
    order: number;
    name: string;
    agentId: string;
    inputTemplate: string;
  }>;
}

export interface CreatePipelineResult {
  success: boolean;
  pipelineId?: string;
  error?: string;
}

export interface ListPipelinesResult {
  pipelines: Array<{
    id: string;
    name: string;
    description: string;
    stepCount: number;
    lastRunAt: string | null;
    createdAt: string;
  }>;
}

export interface GetPipelineParams {
  pipelineId: string;
}

export interface GetPipelineResult {
  pipeline: {
    id: string;
    name: string;
    description: string;
    templateId: string | null;
    steps: Array<{
      id: string;
      order: number;
      name: string;
      agentId: string;
      agentName: string;
      inputTemplate: string;
    }>;
  } | null;
}

export interface UpdatePipelineParams {
  pipelineId: string;
  name?: string;
  description?: string;
  steps?: Array<{
    order: number;
    name: string;
    agentId: string;
    inputTemplate: string;
  }>;
}

export interface UpdatePipelineResult {
  success: boolean;
  error?: string;
}

export interface DeletePipelineParams {
  pipelineId: string;
}

export interface DeletePipelineResult {
  success: boolean;
  error?: string;
}

export interface ExecutePipelineParams {
  pipelineId: string;
  variables: Record<string, string>;
}

export interface ExecutePipelineResult {
  success: boolean;
  runId?: string;
  error?: string;
}

export interface GetPipelineRunParams {
  runId: string;
}

export interface GetPipelineRunResult {
  run: {
    id: string;
    pipelineId: string;
    pipelineName: string;
    status: PipelineRunStatus;
    variables: Record<string, string>;
    steps: PipelineStepRun[];
    startedAt: string;
    completedAt: string | null;
    error: string | null;
  } | null;
}

export interface ListPipelineRunsParams {
  pipelineId: string;
  limit?: number;
  offset?: number;
}

export interface ListPipelineRunsResult {
  runs: Array<{
    id: string;
    status: string;
    variables: Record<string, string>;
    startedAt: string;
    completedAt: string | null;
  }>;
  totalCount: number;
}

export interface RetryPipelineRunParams {
  runId: string;
}

export interface RetryPipelineRunResult {
  success: boolean;
  error?: string;
}

export interface StopPipelineRunParams {
  runId: string;
}

export interface StopPipelineRunResult {
  success: boolean;
  error?: string;
}

export interface ListPipelineTemplatesResult {
  templates: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    stepCount: number;
    isBuiltin: boolean;
    recommendedModel: string | null;
  }>;
}

export interface GetPipelineTemplateParams {
  templateId: string;
}

export interface GetPipelineTemplateResult {
  template: {
    id: string;
    name: string;
    description: string;
    category: string;
    variables: Array<{ name: string; label: string; type: string; required: boolean; placeholder?: string }>;
    steps: Array<{ order: number; name: string; agentRoleHint: string; inputTemplate: string; description: string }>;
    isBuiltin: boolean;
  } | null;
}

export interface DetectLocalProvidersResult {
  providers: Array<{
    id: string;
    label: string;
    available: boolean;
    host: string;
  }>;
}

export interface ValidateConnectionParams {
  providerId: string;
  apiKey?: string;
}

export interface ValidateConnectionResult {
  success: boolean;
  error?: string;
}

// Messages from main to renderer

export interface PipelineRunStepUpdated {
  runId: string;
  stepIndex: number;
  status: 'running' | 'completed' | 'failed';
  output?: string;
  error?: string;
}

export interface PipelineRunCompleted {
  runId: string;
  status: 'completed' | 'failed';
  error?: string;
}
