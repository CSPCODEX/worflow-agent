import { acpManager } from './acpManager';
import { pipelineRepository } from '../db/pipelineRepository';
import { pipelineRunRepository } from '../db/pipelineRunRepository';
import { agentRepository } from '../db/agentRepository';
import { getDatabase } from '../db/database';
import type { Database } from 'bun:sqlite';

export interface PipelineRunnerConfig {
  maxStepOutputBytes: number;
  stepTimeoutMs: number;
  retryAttempts: number;
}

export interface StepStartEvent {
  runId: string;
  stepIndex: number;
  stepName: string;
}

export interface StepChunkEvent {
  runId: string;
  stepIndex: number;
  text: string;
}

export interface StepCompleteEvent {
  runId: string;
  stepIndex: number;
  output: string;
}

export interface StepErrorEvent {
  runId: string;
  stepIndex: number;
  error: string;
}

export interface PipelineCompleteEvent {
  runId: string;
  finalOutput: string;
}

export interface PipelineErrorEvent {
  runId: string;
  error: string;
}

type StepCallback = (event: StepStartEvent) => void;
type ChunkCallback = (event: StepChunkEvent) => void;
type StepCompleteCallback = (event: StepCompleteEvent) => void;
type StepErrorCallback = (event: StepErrorEvent) => void;
type PipelineCompleteCallback = (event: PipelineCompleteEvent) => void;
type PipelineErrorCallback = (event: PipelineErrorEvent) => void;

const DEFAULT_CONFIG: PipelineRunnerConfig = {
  maxStepOutputBytes: 50_000,
  stepTimeoutMs: 120_000,
  retryAttempts: 0,
};

function resolveInputTemplate(
  template: string,
  variables: Record<string, string>,
  previousOutputs: Map<number, string>
): string {
  let resolved = template;

  for (const [key, value] of Object.entries(variables)) {
    resolved = resolved.replaceAll(`{{${key}}}`, value);
  }

  for (const [stepNum, output] of previousOutputs) {
    resolved = resolved.replaceAll(`{{output_paso_${stepNum}}}`, output);
  }

  return resolved;
}

function truncateOutput(output: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(output, 'utf8');
  if (bytes <= maxBytes) return output;
  return output.slice(0, Math.floor(maxBytes * 0.9)) + '\n[Output truncated: exceeded limit]';
}

export class PipelineRunner {
  private config: PipelineRunnerConfig;
  private onStepStartCb?: StepCallback;
  private onStepChunkCb?: ChunkCallback;
  private onStepCompleteCb?: StepCompleteCallback;
  private onStepErrorCb?: StepErrorCallback;
  private onPipelineCompleteCb?: PipelineCompleteCallback;
  private onPipelineErrorCb?: PipelineErrorCallback;
  private activeSessions = new Map<string, string>();
  private stoppedRuns = new Set<string>();

  constructor(config: Partial<PipelineRunnerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  onStepStart(cb: StepCallback): void {
    this.onStepStartCb = cb;
  }

  onStepChunk(cb: ChunkCallback): void {
    this.onStepChunkCb = cb;
  }

  onStepComplete(cb: StepCompleteCallback): void {
    this.onStepCompleteCb = cb;
  }

  onStepError(cb: StepErrorCallback): void {
    this.onStepErrorCb = cb;
  }

  onPipelineComplete(cb: PipelineCompleteCallback): void {
    this.onPipelineCompleteCb = cb;
  }

  onPipelineError(cb: PipelineErrorCallback): void {
    this.onPipelineErrorCb = cb;
  }

  async execute(params: { pipelineId: string; variables: Record<string, string>; runId: string }): Promise<void> {
    const { pipelineId, variables, runId } = params;
    this.stoppedRuns.delete(runId);

    const pipeline = pipelineRepository.getPipeline(getDatabase(), pipelineId);
    if (!pipeline) {
      this.onPipelineErrorCb?.({ runId, error: `Pipeline not found: ${pipelineId}` });
      return;
    }

    pipelineRunRepository.updateRunStatus(getDatabase(), runId, 'running');

    const previousOutputs = new Map<number, string>();
    const stepOutputs: string[] = [];

    for (let i = 0; i < pipeline.steps.length; i++) {
      if (this.stoppedRuns.has(runId)) {
        pipelineRunRepository.updateRunStatus(getDatabase(), runId, 'paused');
        return;
      }

      const step = pipeline.steps[i]!;
      const stepOrder = i + 1;

      const stepRunResult = pipelineRunRepository.createStepRun(
        getDatabase(),
        runId,
        step.id,
        stepOrder,
        step.name
      );
      const stepRunId = stepRunResult.id;

      this.onStepStartCb?.({ runId, stepIndex: i, stepName: step.name });

      const agent = agentRepository.findById(step.agentId);
      if (!agent) {
        const errorMsg = `Agent not found: ${step.agentId}`;
        pipelineRunRepository.updateStepRun(getDatabase(), stepRunId, 'failed', undefined, errorMsg);
        this.onStepErrorCb?.({ runId, stepIndex: i, error: errorMsg });
        pipelineRunRepository.updateRunStatus(getDatabase(), runId, 'paused', errorMsg);
        this.onPipelineErrorCb?.({ runId, error: errorMsg });
        return;
      }

      let fullOutput = '';
      const sessionId = await this.runStepWithTimeout({
        runId,
        stepId: step.id,
        stepRunId: stepRunId,
        agentPath: agent.path,
        inputTemplate: step.inputTemplate,
        variables,
        previousOutputs,
        stepIndex: i,
        stepName: step.name,
        onChunk: (text) => {
          fullOutput += text;
          this.onStepChunkCb?.({ runId, stepIndex: i, text });
        },
      });

      if (this.stoppedRuns.has(runId)) {
        pipelineRunRepository.updateRunStatus(getDatabase(), runId, 'paused');
        if (sessionId) acpManager.closeSession(sessionId);
        return;
      }

      if (!sessionId) {
        const errorMsg = 'Step timed out or agent failed to start';
        pipelineRunRepository.updateStepRun(getDatabase(), stepRunId, 'failed', undefined, errorMsg);
        this.onStepErrorCb?.({ runId, stepIndex: i, error: errorMsg });
        pipelineRunRepository.updateRunStatus(getDatabase(), runId, 'paused', errorMsg);
        this.onPipelineErrorCb?.({ runId, error: errorMsg });
        return;
      }

      acpManager.closeSession(sessionId);

      const truncated = truncateOutput(fullOutput, this.config.maxStepOutputBytes);
      pipelineRunRepository.updateStepRun(getDatabase(), stepRunId, 'completed', truncated);
      this.onStepCompleteCb?.({ runId, stepIndex: i, output: truncated });

      previousOutputs.set(stepOrder, truncated);
      stepOutputs.push(truncated);
    }

    const finalOutput = stepOutputs.join('\n\n');
    pipelineRunRepository.updateRunStatus(getDatabase(), runId, 'completed');
    this.onPipelineCompleteCb?.({ runId, finalOutput });
  }

  private async runStepWithTimeout(params: {
    runId: string;
    stepId: string;
    stepRunId: string;
    agentPath: string;
    inputTemplate: string;
    variables: Record<string, string>;
    previousOutputs: Map<number, string>;
    stepIndex: number;
    stepName: string;
    onChunk: (text: string) => void;
  }): Promise<string | null> {
    const { runId, agentPath, inputTemplate, variables, previousOutputs, onChunk } = params;

    const resolvedInput = resolveInputTemplate(inputTemplate, variables, previousOutputs);

    const sessionResult = await acpManager.createSession('pipeline-agent', agentPath);
    if (!sessionResult.success || !sessionResult.sessionId) {
      return null;
    }
    const sessionId = sessionResult.sessionId;
    this.activeSessions.set(runId, sessionId);

    const savedCallback = acpManager.getMessageCallback();
    const chunkHandler = (type: 'chunk' | 'end' | 'error', _sessionId: string, data?: string) => {
      if (type === 'chunk' && data) {
        onChunk(data);
      }
    };
    acpManager.setMessageCallback(chunkHandler);

    try {
      await Promise.race([
        acpManager.sendMessage(sessionId, resolvedInput),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Step timed out')), this.config.stepTimeoutMs)
        ),
      ]);
      return sessionId;
    } catch {
      return null;
    } finally {
      acpManager.setMessageCallback(savedCallback);
    }
  }

  async resume(params: { runId: string; fromStepIndex: number }): Promise<void> {
    const { runId, fromStepIndex } = params;
    this.stoppedRuns.delete(runId);

    const run = pipelineRunRepository.getRun(getDatabase(), runId);
    if (!run) {
      this.onPipelineErrorCb?.({ runId, error: `Run not found: ${runId}` });
      return;
    }

    const pipeline = pipelineRepository.getPipeline(getDatabase(), run.pipelineId);
    if (!pipeline) {
      this.onPipelineErrorCb?.({ runId, error: `Pipeline not found: ${run.pipelineId}` });
      return;
    }

    const previousOutputs = new Map<number, string>();
    for (let i = 0; i < fromStepIndex && i < run.stepRuns.length; i++) {
      const stepRun = run.stepRuns[i]!;
      if (stepRun.output) {
        previousOutputs.set(i + 1, stepRun.output);
      }
    }

    const stepOutputs: string[] = [];
    for (let i = 0; i < fromStepIndex && i < run.stepRuns.length; i++) {
      const stepRun = run.stepRuns[i]!;
      if (stepRun.output) {
        stepOutputs.push(stepRun.output);
      }
    }

    pipelineRunRepository.updateRunStatus(getDatabase(), runId, 'running');

    for (let i = fromStepIndex; i < pipeline.steps.length; i++) {
      if (this.stoppedRuns.has(runId)) {
        pipelineRunRepository.updateRunStatus(getDatabase(), runId, 'paused');
        return;
      }

      const step = pipeline.steps[i]!;
      const stepOrder = i + 1;

      const stepRunResult = pipelineRunRepository.createStepRun(
        getDatabase(),
        runId,
        step.id,
        stepOrder,
        step.name
      );
      const stepRunIdResume = stepRunResult.id;

      this.onStepStartCb?.({ runId, stepIndex: i, stepName: step.name });

      const agent = agentRepository.findById(step.agentId);
      if (!agent) {
        const errorMsg = `Agent not found: ${step.agentId}`;
        pipelineRunRepository.updateStepRun(getDatabase(), stepRunIdResume, 'failed', undefined, errorMsg);
        this.onStepErrorCb?.({ runId, stepIndex: i, error: errorMsg });
        pipelineRunRepository.updateRunStatus(getDatabase(), runId, 'paused', errorMsg);
        this.onPipelineErrorCb?.({ runId, error: errorMsg });
        return;
      }

      let fullOutput = '';
      const sessionId = await this.runStepWithTimeout({
        runId,
        stepId: step.id,
        stepRunId: stepRunIdResume,
        agentPath: agent.path,
        inputTemplate: step.inputTemplate,
        variables: run.variables,
        previousOutputs,
        stepIndex: i,
        stepName: step.name,
        onChunk: (text) => {
          fullOutput += text;
          this.onStepChunkCb?.({ runId, stepIndex: i, text });
        },
      });

      if (this.stoppedRuns.has(runId)) {
        pipelineRunRepository.updateRunStatus(getDatabase(), runId, 'paused');
        if (sessionId) acpManager.closeSession(sessionId);
        return;
      }

      if (!sessionId) {
        const errorMsg = 'Step timed out or agent failed to start';
        pipelineRunRepository.updateStepRun(getDatabase(), stepRunIdResume, 'failed', undefined, errorMsg);
        this.onStepErrorCb?.({ runId, stepIndex: i, error: errorMsg });
        pipelineRunRepository.updateRunStatus(getDatabase(), runId, 'paused', errorMsg);
        this.onPipelineErrorCb?.({ runId, error: errorMsg });
        return;
      }

      acpManager.closeSession(sessionId);

      const truncated = truncateOutput(fullOutput, this.config.maxStepOutputBytes);
      pipelineRunRepository.updateStepRun(getDatabase(), stepRunIdResume, 'completed', truncated);
      this.onStepCompleteCb?.({ runId, stepIndex: i, output: truncated });

      previousOutputs.set(stepOrder, truncated);
      stepOutputs.push(truncated);
    }

    const finalOutput = stepOutputs.join('\n\n');
    pipelineRunRepository.updateRunStatus(getDatabase(), runId, 'completed');
    this.onPipelineCompleteCb?.({ runId, finalOutput });
  }

  async stop(runId: string): Promise<void> {
    this.stoppedRuns.add(runId);
    const sessionId = this.activeSessions.get(runId);
    if (sessionId) {
      acpManager.closeSession(sessionId);
      this.activeSessions.delete(runId);
    }
    pipelineRunRepository.updateRunStatus(getDatabase(), runId, 'paused');
  }
}

export const pipelineRunner = new PipelineRunner();
