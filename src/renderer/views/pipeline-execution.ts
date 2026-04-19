import type { PipelineRunStepUpdated, PipelineRunCompleted } from '../../types/pipeline';
import type { GetPipelineRunResult } from '../../types/pipeline';
import { escapeHtml } from '../utils/html';
import { OUTPUT_TRUNCATE_LIMIT } from '../utils/format';

export interface PipelineExecutionParams {
  pipelineId: string;
  pipelineName: string;
  variables: Array<{ name: string; label: string; type: string; required: boolean; placeholder?: string }>;
  onComplete: (runId: string) => void;
  onCancel: () => void;
}

interface StepDisplayState {
  stepIndex: number;
  stepName: string;
  agentName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output: string;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export function renderPipelineExecution(container: HTMLElement, params: PipelineExecutionParams): { cleanup(): void } {
  const rpc = (window as any).appRpc;

  let stepStates: StepDisplayState[] = [];
  let currentRunId: string | null = null;
  let isRunning = false;

  container.innerHTML = `
    <div class="pipeline-execution-view">
      <div class="pipeline-execution-header">
        <h2>Ejecutando: <span id="pe-pipeline-name"></span></h2>
        <button id="pe-stop" class="btn-danger" style="display:none">Detener ejecucion</button>
      </div>
      <div class="pipeline-execution-body">
        <div id="pe-steps-list" class="pipeline-execution-steps"></div>
      </div>
      <div class="pipeline-execution-footer">
        <button id="pe-cancel" class="btn-secondary">Cancelar</button>
      </div>
    </div>
  `;

  const nameEl = container.querySelector<HTMLSpanElement>('#pe-pipeline-name')!;
  const stepsListEl = container.querySelector<HTMLDivElement>('#pe-steps-list')!;
  const stopBtn = container.querySelector<HTMLButtonElement>('#pe-stop')!;
  const cancelBtn = container.querySelector<HTMLButtonElement>('#pe-cancel')!;

  nameEl.textContent = params.pipelineName;

  // Initial step states from variables count (pending steps will be loaded from getPipeline)
  // We need step info from getPipelineRun after execute
  async function startExecution(variables: Record<string, string>) {
    try {
      const result = await rpc.request.executePipeline({
        pipelineId: params.pipelineId,
        variables,
      });

      if (!result.success || !result.runId) {
        showError(result.error || 'Error al iniciar ejecucion.');
        return;
      }

      currentRunId = result.runId;
      isRunning = true;
      stopBtn.style.display = 'block';
      cancelBtn.disabled = true;

      // Load run to get step info
      const runResult = await rpc.request.getPipelineRun({ runId: result.runId });
      if (runResult.run) {
        initializeSteps(runResult.run);
      }

      params.onComplete(result.runId);
    } catch (e: any) {
      showError(e.message || 'Error de comunicacion.');
    }
  }

  function initializeSteps(run: GetPipelineRunResult['run']) {
    if (!run) return;
    stepStates = run.steps.map((s, i) => ({
      stepIndex: i,
      stepName: s.stepName,
      agentName: s.agentName,
      status: s.status as StepDisplayState['status'],
      output: s.output || '',
      error: null,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
    }));
    renderSteps();
  }

  function renderSteps() {
    stepsListEl.innerHTML = '';

    stepStates.forEach((step, index) => {
      const stepEl = document.createElement('div');
      stepEl.className = `pipeline-execution-step pipeline-execution-step-${step.status}`;
      stepEl.dataset.stepIndex = String(index);

      const statusIcon = getStatusIcon(step.status);
      const outputHtml = getStepOutputHtml(step, index);

      stepEl.innerHTML = `
        <div class="pipeline-execution-step-header">
          <div class="pipeline-execution-step-number">${index + 1}</div>
          <div class="pipeline-execution-step-info">
            <span class="pipeline-execution-step-name">${escapeHtml(step.stepName)}</span>
            <span class="pipeline-execution-step-agent">${escapeHtml(step.agentName)}</span>
          </div>
          <div class="pipeline-execution-step-status">
            ${statusIcon}
            <span class="pipeline-execution-step-status-label">${getStatusLabel(step.status)}</span>
          </div>
        </div>
        <div class="pipeline-execution-step-output" id="pe-step-output-${index}">
          ${outputHtml}
        </div>
      `;

      stepsListEl.appendChild(stepEl);
    });
  }

  function getStepOutputHtml(step: StepDisplayState, index: number): string {
    if (step.status === 'pending') {
      return `<div class="pipeline-execution-step-output-placeholder">Pendiente...</div>`;
    }

    if (step.status === 'running') {
      const truncated = step.output.length > OUTPUT_TRUNCATE_LIMIT;
      const displayText = truncated ? step.output.slice(0, OUTPUT_TRUNCATE_LIMIT) : step.output;
      return `
        <div class="pipeline-execution-step-output-content streaming" id="pe-step-content-${index}">${escapeHtml(displayText)}</div>
        ${truncated ? `<div class="pipeline-execution-output-truncated">Output truncado</div>` : ''}
      `;
    }

    if (step.status === 'failed') {
      return `
        <div class="pipeline-execution-step-error">${escapeHtml(step.error || 'Error desconocido')}</div>
        <div class="pipeline-execution-step-actions">
          <button class="btn-retry-step" data-step-index="${index}">Reintentar desde este paso</button>
        </div>
      `;
    }

    // completed
    const truncated = step.output.length > OUTPUT_TRUNCATE_LIMIT;
    const displayText = truncated ? step.output.slice(0, OUTPUT_TRUNCATE_LIMIT) : step.output;
    return `
      <div class="pipeline-execution-step-output-content" id="pe-step-content-${index}">${escapeHtml(displayText)}</div>
      ${truncated ? `<div class="pipeline-execution-output-truncated">Output truncado</div>` : ''}
    `;
  }

  function getStatusIcon(status: StepDisplayState['status']): string {
    switch (status) {
      case 'pending':
        return `<svg class="step-status-icon step-status-icon-pending" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="#666" stroke-width="1.5"/>
        </svg>`;
      case 'running':
        return `<div class="spinner" style="width:16px;height:16px;border-width:1.5px;"></div>`;
      case 'completed':
        return `<svg class="step-status-icon step-status-icon-completed" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" fill="#1a3a1a" stroke="#2a5a2a" stroke-width="1.5"/>
          <path d="M5 8l2 2 4-4" stroke="#6ab56a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
      case 'failed':
        return `<svg class="step-status-icon step-status-icon-failed" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" fill="#3a1a1a" stroke="#5a2a2a" stroke-width="1.5"/>
          <path d="M6 6l4 4M10 6l-4 4" stroke="#d46a6a" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`;
    }
  }

  function getStatusLabel(status: StepDisplayState['status']): string {
    switch (status) {
      case 'pending': return 'PENDIENTE';
      case 'running': return 'EJECUTANDO...';
      case 'completed': return 'COMPLETADO';
      case 'failed': return 'ERROR';
    }
  }

  function showError(message: string) {
    stepsListEl.innerHTML = `
      <div class="pipeline-execution-error">
        <p>${escapeHtml(message)}</p>
        <button id="pe-retry-start" class="btn-primary">Reintentar</button>
      </div>
    `;
    const retryBtn = stepsListEl.querySelector<HTMLButtonElement>('#pe-retry-start');
    retryBtn?.addEventListener('click', () => {
      stepsListEl.innerHTML = '';
      currentRunId = null;
      isRunning = false;
      stopBtn.style.display = 'none';
      cancelBtn.disabled = false;
    });
  }

  // Listen for push messages
  const msgHandler = (msg: PipelineRunStepUpdated | PipelineRunCompleted) => {
    if (!currentRunId) return;

    if ('runId' in msg && msg.runId !== currentRunId) return;

    if (msg.runId && 'stepIndex' in msg) {
      handleStepUpdated(msg as PipelineRunStepUpdated);
    } else if ('runId' in msg && 'status' in msg && !('stepIndex' in msg)) {
      handleRunCompleted(msg as PipelineRunCompleted);
    }
  };

  const unsubStep = (window as any).appRpc?.messages?.pipelineRunStepUpdated?.subscribe(msgHandler);
  const unsubCompleted = (window as any).appRpc?.messages?.pipelineRunCompleted?.subscribe(msgHandler);

  stopBtn.addEventListener('click', async () => {
    if (!currentRunId) return;
    stopBtn.disabled = true;
    stopBtn.textContent = 'Deteniendo...';
    try {
      await rpc.request.stopPipelineRun({ runId: currentRunId });
    } catch (e) {
      console.error('Error stopping pipeline:', e);
    }
  });

  cancelBtn.addEventListener('click', () => {
    params.onCancel();
  });

  // Attach retry button handlers via delegation
  stepsListEl.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('.btn-retry-step');
    if (!btn) return;
    const stepIndex = parseInt((btn as HTMLButtonElement).dataset.stepIndex!);
    if (!currentRunId) return;

    try {
      btn.setAttribute('disabled', 'disabled');
      btn.textContent = 'Reintentando...';
      const result = await rpc.request.retryPipelineRun({ runId: currentRunId });
      if (result.success && result.runId) {
        currentRunId = result.runId;
        // Reset this step and all subsequent
        for (let i = stepIndex; i < stepStates.length; i++) {
          const s = stepStates[i];
          if (s) {
            s.status = 'pending';
            s.output = '';
            s.error = null;
            s.startedAt = null;
            s.completedAt = null;
          }
        }
        renderSteps();
      } else {
        btn.removeAttribute('disabled');
        btn.textContent = 'Reintentar desde este paso';
        console.error('Retry failed:', result.error);
      }
    } catch (e) {
      btn.removeAttribute('disabled');
      btn.textContent = 'Reintentar desde este paso';
      console.error('Error retrying:', e);
    }
  });

  function handleStepUpdated(msg: PipelineRunStepUpdated) {
    const stepIndex = msg.stepIndex;
    if (!stepStates[stepIndex]) return;

    if (msg.status === 'running') {
      stepStates[stepIndex].status = 'running';
      stepStates[stepIndex].startedAt = new Date().toISOString();
    } else if (msg.status === 'completed') {
      stepStates[stepIndex].status = 'completed';
      stepStates[stepIndex].completedAt = new Date().toISOString();
    } else if (msg.status === 'failed') {
      stepStates[stepIndex].status = 'failed';
      stepStates[stepIndex].error = msg.error || 'Error desconocido';
      stepStates[stepIndex].completedAt = new Date().toISOString();
    }

    if (msg.output !== undefined) {
      // Streaming: append chunk
      stepStates[stepIndex].output += msg.output;
    }

    renderSteps();
  }

  function handleRunCompleted(msg: PipelineRunCompleted) {
    if (!currentRunId) return;
    isRunning = false;
    stopBtn.style.display = 'none';

    if (msg.status === 'failed') {
      // Mark all remaining steps as failed or leave as-is
      stepStates.forEach((s) => {
        if (s.status === 'running') {
          s.status = 'failed';
          s.error = msg.error || 'Pipeline fallido';
        }
      });
      renderSteps();
    }
  }

  // Start execution - show modal first if variables are defined
  if (params.variables && params.variables.length > 0) {
    showVariablesModal({
      variables: params.variables,
      onExecute: (collectedVariables) => {
        startExecution(collectedVariables);
      },
      onCancel: () => {
        params.onCancel();
      },
    });
  } else {
    startExecution({});
  }

  return {
    cleanup() {
      if (typeof unsubStep === 'function') unsubStep();
      if (typeof unsubCompleted === 'function') unsubCompleted();
    },
  };
}

// Show variables modal before execution
export interface VariableModalParams {
  variables: Array<{ name: string; label: string; type: string; required: boolean; placeholder?: string; defaultValue?: string }>;
  onExecute: (variables: Record<string, string>) => void;
  onCancel: () => void;
}

export function showVariablesModal(params: VariableModalParams) {
  const overlay = document.createElement('div');
  overlay.className = 'variables-modal-overlay';
  document.body.appendChild(overlay);

  const hasVariables = params.variables && params.variables.length > 0;

  overlay.innerHTML = `
    <div class="variables-modal">
      <div class="variables-modal-header">
        <h2>Variables del Pipeline</h2>
        <button id="vm-close" class="btn-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <div class="variables-modal-body">
        ${!hasVariables ? '<p style="color:#666;font-size:13px">Este pipeline no requiere variables.</p>' : ''}
        ${params.variables.map((v) => `
          <div class="form-group">
            <label for="vm-var-${escapeHtml(v.name)}">${escapeHtml(v.label)}${v.required ? ' *' : ''}</label>
            ${v.type === 'textarea' || v.type === 'code'
              ? `<textarea id="vm-var-${escapeHtml(v.name)}" class="var-input" rows="4" placeholder="${escapeHtml(v.placeholder || '')}">${escapeHtml(v.defaultValue || '')}</textarea>`
              : `<input id="vm-var-${escapeHtml(v.name)}" type="text" class="var-input" value="${escapeHtml(v.defaultValue || '')}" placeholder="${escapeHtml(v.placeholder || '')}" />`
            }
          </div>
        `).join('')}
      </div>
      <div class="variables-modal-footer">
        <button id="vm-cancel" class="btn-secondary">Cancelar</button>
        <button id="vm-execute" class="btn-primary">Ejecutar</button>
      </div>
    </div>
  `;

  const closeBtn = overlay.querySelector<HTMLButtonElement>('#vm-close')!;
  const cancelBtn = overlay.querySelector<HTMLButtonElement>('#vm-cancel')!;
  const executeBtn = overlay.querySelector<HTMLButtonElement>('#vm-execute')!;

  closeBtn.addEventListener('click', () => {
    document.body.removeChild(overlay);
    params.onCancel();
  });

  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(overlay);
    params.onCancel();
  });

  executeBtn.addEventListener('click', () => {
    if (!hasVariables) {
      document.body.removeChild(overlay);
      params.onExecute({});
      return;
    }

    const variables: Record<string, string> = {};
    let valid = true;

    params.variables.forEach((v) => {
      const input = overlay.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#vm-var-${v.name}`);
      if (input) {
        const value = input.value.trim();
        if (v.required && !value) {
          valid = false;
          input.style.borderColor = '#d46a6a';
        } else {
          input.style.borderColor = '';
          variables[v.name] = value;
        }
      }
    });

    if (!valid) return;

    document.body.removeChild(overlay);
    params.onExecute(variables);
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      document.body.removeChild(overlay);
      params.onCancel();
    }
  });
}
