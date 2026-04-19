import type { GetPipelineRunResult } from '../../types/pipeline';
import { escapeHtml } from '../utils/html';
import { OUTPUT_TRUNCATE_LIMIT } from '../utils/format';

export interface PipelineResultsParams {
  runId: string;
  isHistory?: boolean;
  onRerun?: () => void;
  onBack?: () => void;
}

export function renderPipelineResults(container: HTMLElement, params: PipelineResultsParams) {
  const rpc = (window as any).appRpc;

  container.innerHTML = `
    <div class="pipeline-results-view">
      <div class="pipeline-results-header">
        <h2>Resultado de Ejecucion</h2>
        <div class="pipeline-results-header-actions">
          <button id="pr-back" class="btn-secondary">Volver</button>
          <button id="pr-copy" class="btn-secondary">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="margin-right:4px">
              <rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.2"/>
              <path d="M4 4V2h2M2 4H4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
            Copiar output
          </button>
          <button id="pr-rerun" class="btn-primary">Re-ejecutar</button>
        </div>
      </div>
      <div id="pr-content" class="pipeline-results-body">
        <div class="pipeline-results-loading">
          <div class="spinner"></div>
          <span>Cargando resultado...</span>
        </div>
      </div>
    </div>
  `;

  const contentEl = container.querySelector<HTMLDivElement>('#pr-content')!;
  const backBtn = container.querySelector<HTMLButtonElement>('#pr-back')!;
  const copyBtn = container.querySelector<HTMLButtonElement>('#pr-copy')!;
  const rerunBtn = container.querySelector<HTMLButtonElement>('#pr-rerun')!;

  backBtn.addEventListener('click', () => params.onBack?.());
  rerunBtn.addEventListener('click', () => params.onRerun?.());

  copyBtn.addEventListener('click', () => {
    const content = contentEl.querySelector('.pipeline-results-final-output');
    if (content) {
      navigator.clipboard.writeText(content.textContent || '').catch(() => {});
    }
  });

  async function loadRun() {
    try {
      const result = await rpc.request.getPipelineRun({ runId: params.runId });
      if (!result.run) {
        contentEl.innerHTML = `<div class="pipeline-results-error">Ejecucion no encontrada.</div>`;
        return;
      }
      renderRun(result.run);
    } catch (e) {
      contentEl.innerHTML = `<div class="pipeline-results-error">Error al cargar resultado.</div>`;
    }
  }

  function renderRun(run: GetPipelineRunResult['run']) {
    if (!run) return;

    const hasFailedStep = run.steps.some((s) => s.status === 'failed');
    const lastCompletedStep = [...run.steps].reverse().find((s) => s.status === 'completed');
    const finalOutput = lastCompletedStep?.output || '';

    let statusHtml = '';
    if (run.status === 'completed') {
      statusHtml = `<div class="pipeline-results-status pipeline-results-status-completed">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="8" fill="#1a3a1a" stroke="#2a5a2a" stroke-width="1.5"/>
          <path d="M6 10l3 3 5-5" stroke="#6ab56a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Pipeline completado correctamente</span>
      </div>`;
    } else if (run.status === 'failed') {
      statusHtml = `<div class="pipeline-results-status pipeline-results-status-failed">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="8" fill="#3a1a1a" stroke="#5a2a2a" stroke-width="1.5"/>
          <path d="M7 7l6 6M13 7l-6 6" stroke="#d46a6a" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span>Pipeline fallido${run.error ? ': ' + escapeHtml(run.error) : ''}</span>
      </div>`;
    }

    const stepsHtml = run.steps.map((step, i) => {
      const stepOutput = step.output || '';
      const truncated = stepOutput.length > OUTPUT_TRUNCATE_LIMIT;
      const displayText = truncated ? stepOutput.slice(0, OUTPUT_TRUNCATE_LIMIT) : stepOutput;

      let statusBadge = '';
      if (step.status === 'completed') {
        statusBadge = `<span class="pipeline-step-badge pipeline-step-badge-completed">COMPLETADO</span>`;
      } else if (step.status === 'failed') {
        statusBadge = `<span class="pipeline-step-badge pipeline-step-badge-failed">ERROR</span>`;
      } else if (step.status === 'running') {
        statusBadge = `<span class="pipeline-step-badge pipeline-step-badge-running">EJECUTANDO</span>`;
      }

      return `
        <div class="pipeline-results-step ${step.status === 'failed' ? 'pipeline-results-step-failed' : ''}" data-step-index="${i}">
          <div class="pipeline-results-step-header">
            <div class="pipeline-results-step-number">${i + 1}</div>
            <div class="pipeline-results-step-info">
              <span class="pipeline-results-step-name">${escapeHtml(step.stepName)}</span>
              <span class="pipeline-results-step-agent">${escapeHtml(step.agentName)}</span>
            </div>
            <div class="pipeline-results-step-status">${statusBadge}</div>
          </div>
          ${step.status === 'failed' && step.output ? `<div class="pipeline-results-step-error">${escapeHtml(step.output)}</div>` : ''}
          ${step.output ? `
            <div class="pipeline-results-step-output" id="pr-step-output-${i}">
              <div class="pipeline-results-step-output-content">${escapeHtml(displayText)}</div>
              ${truncated ? `<button class="btn-view-full-output" data-step-index="${i}">Ver completo (${formatBytes(stepOutput.length)})</button>` : ''}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    const finalOutputTruncated = finalOutput.length > OUTPUT_TRUNCATE_LIMIT;
    const finalOutputDisplay = finalOutputTruncated ? finalOutput.slice(0, OUTPUT_TRUNCATE_LIMIT) : finalOutput;

    contentEl.innerHTML = `
      ${statusHtml}
      <div class="pipeline-results-variables">
        <h3>Variables usadas</h3>
        <div class="pipeline-results-variables-list">
          ${Object.entries(run.variables).map(([k, v]) => `
            <div class="pipeline-results-variable">
              <span class="pipeline-results-variable-name">${escapeHtml(k)}</span>
              <span class="pipeline-results-variable-value">${escapeHtml(v)}</span>
            </div>
          `).join('') || '<span style="color:#666;font-size:12px">Sin variables</span>'}
        </div>
      </div>
      <div class="pipeline-results-final">
        <h3>Output final</h3>
        <div class="pipeline-results-final-output">${escapeHtml(finalOutputDisplay)}</div>
        ${finalOutputTruncated ? `
          <div class="pipeline-results-output-truncated">
            <span>Output truncado (${formatBytes(finalOutput.length)})</span>
            <button id="pr-view-full-output" class="btn-secondary">Ver completo</button>
          </div>
        ` : ''}
      </div>
      <div class="pipeline-results-steps-section">
        <h3>Pasos intermedios</h3>
        <div class="pipeline-results-steps-list">
          ${stepsHtml}
        </div>
      </div>
    `;

    // View full output button
    const viewFullBtn = contentEl.querySelector<HTMLButtonElement>('#pr-view-full-output');
    viewFullBtn?.addEventListener('click', async () => {
      viewFullBtn.disabled = true;
      viewFullBtn.textContent = 'Cargando...';
      try {
        const fullResult = await rpc.request.getPipelineRun({ runId: params.runId });
        if (fullResult.run) {
          const lastStep = [...fullResult.run.steps].reverse().find((s) => s.status === 'completed');
          if (lastStep?.output) {
            const content = contentEl.querySelector<HTMLDivElement>('.pipeline-results-final-output');
            if (content) content.textContent = lastStep.output;
            viewFullBtn.parentElement?.remove();
          }
        }
      } catch (e) {
        viewFullBtn.disabled = false;
        viewFullBtn.textContent = 'Ver completo';
      }
    });

    // View full step output buttons
    contentEl.querySelectorAll<HTMLButtonElement>('.btn-view-full-output').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const stepIndex = parseInt(btn.dataset.stepIndex!);
        btn.disabled = true;
        btn.textContent = 'Cargando...';
        try {
          const fullResult = await rpc.request.getPipelineRun({ runId: params.runId });
          if (fullResult.run && fullResult.run.steps[stepIndex]?.output) {
            const outputEl = contentEl.querySelector<HTMLDivElement>(`#pr-step-output-${stepIndex} .pipeline-results-step-output-content`);
            if (outputEl) {
              outputEl.textContent = fullResult.run.steps[stepIndex].output;
              btn.parentElement?.remove();
            }
          }
        } catch (e) {
          btn.disabled = false;
          btn.textContent = 'Ver completo';
        }
      });
    });

    // Retry from failed step
    if (hasFailedStep) {
      const failedStepIndex = run.steps.findIndex((s) => s.status === 'failed');
      const failedStep = run.steps[failedStepIndex];
      if (!failedStep) return;

      const retrySection = document.createElement('div');
      retrySection.className = 'pipeline-results-retry-section';
      retrySection.innerHTML = `
        <div class="pipeline-results-retry-info">
          <p>El paso <strong>${escapeHtml(failedStep.stepName)}</strong> fallo${failedStep.output ? ': ' + escapeHtml(failedStep.output.slice(0, 200)) : ''}.</p>
        </div>
        <button id="pr-retry-from-failed" class="btn-primary">Reintentar desde este paso</button>
      `;
      contentEl.insertBefore(retrySection, contentEl.firstChild);

      const retryBtn = retrySection.querySelector<HTMLButtonElement>('#pr-retry-from-failed');
      retryBtn?.addEventListener('click', async () => {
        retryBtn.disabled = true;
        retryBtn.textContent = 'Reintentando...';
        try {
          const result = await rpc.request.retryPipelineRun({ runId: params.runId });
          if (!result.success) {
            retryBtn.disabled = false;
            retryBtn.textContent = 'Reintentar desde este paso';
          }
        } catch (e) {
          retryBtn.disabled = false;
          retryBtn.textContent = 'Reintentar desde este paso';
        }
      });
    }
  }

  loadRun();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
