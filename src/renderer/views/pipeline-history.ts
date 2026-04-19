import type { ListPipelineRunsResult } from '../../types/pipeline';
import { escapeHtml } from '../utils/html';

const PAGE_SIZE = 10;

export interface PipelineHistoryParams {
  pipelineId: string;
  pipelineName: string;
  onSelectRun: (runId: string) => void;
  onBack: () => void;
}

export function renderPipelineHistory(container: HTMLElement, params: PipelineHistoryParams) {
  const rpc = (window as any).appRpc;

  let currentOffset = 0;
  let totalCount = 0;
  let runs: ListPipelineRunsResult['runs'] = [];

  container.innerHTML = `
    <div class="pipeline-history-view">
      <div class="pipeline-history-header">
        <div class="pipeline-history-header-left">
          <button id="ph-back" class="btn-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <h2>Historial: <span id="ph-pipeline-name"></span></h2>
        </div>
        <button id="ph-close" class="btn-secondary">Volver a Pipelines</button>
      </div>
      <div id="ph-content" class="pipeline-history-body">
        <div class="pipeline-history-loading">
          <div class="spinner"></div>
          <span>Cargando historial...</span>
        </div>
      </div>
      <div id="ph-pagination" class="pipeline-history-pagination" style="display:none">
        <button id="ph-prev" class="btn-secondary">Anterior</button>
        <span id="ph-page-info"></span>
        <button id="ph-next" class="btn-secondary">Siguiente</button>
      </div>
    </div>
  `;

  const nameEl = container.querySelector<HTMLSpanElement>('#ph-pipeline-name')!;
  const contentEl = container.querySelector<HTMLDivElement>('#ph-content')!;
  const paginationEl = container.querySelector<HTMLDivElement>('#ph-pagination')!;
  const prevBtn = container.querySelector<HTMLButtonElement>('#ph-prev')!;
  const nextBtn = container.querySelector<HTMLButtonElement>('#ph-next')!;
  const pageInfoEl = container.querySelector<HTMLSpanElement>('#ph-page-info')!;
  const backBtn = container.querySelector<HTMLButtonElement>('#ph-back')!;
  const closeBtn = container.querySelector<HTMLButtonElement>('#ph-close')!;

  nameEl.textContent = params.pipelineName;

  backBtn.addEventListener('click', () => params.onBack());
  closeBtn.addEventListener('click', () => params.onBack());

  prevBtn.addEventListener('click', () => {
    currentOffset = Math.max(0, currentOffset - PAGE_SIZE);
    loadRuns();
  });

  nextBtn.addEventListener('click', () => {
    currentOffset += PAGE_SIZE;
    loadRuns();
  });

  function renderRuns() {
    if (runs.length === 0) {
      contentEl.innerHTML = `
        <div class="empty-state">
          <p>No hay ejecuciones en el historial.</p>
        </div>
      `;
      paginationEl.style.display = 'none';
      return;
    }

    contentEl.innerHTML = `
      <div class="pipeline-history-table">
        <div class="pipeline-history-table-header">
          <div class="pipeline-history-col-status">Estado</div>
          <div class="pipeline-history-col-date">Fecha</div>
          <div class="pipeline-history-col-variables">Variables</div>
        </div>
        <div id="ph-runs-list" class="pipeline-history-runs-list">
          ${runs.map((run) => `
            <div class="pipeline-history-run-row" data-run-id="${escapeHtml(run.id)}">
              <div class="pipeline-history-col-status">
                ${getStatusBadge(run.status)}
              </div>
              <div class="pipeline-history-col-date">
                ${formatDate(run.startedAt)}
              </div>
              <div class="pipeline-history-col-variables">
                ${Object.entries(run.variables).map(([k, v]) => `
                  <span class="ph-variable-chip">${escapeHtml(k)}: ${escapeHtml(v.length > 20 ? v.slice(0, 20) + '...' : v)}</span>
                `).join('') || '<span style="color:#666;font-size:12px">Sin variables</span>'}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Click on row to select run
    contentEl.querySelectorAll<HTMLElement>('.pipeline-history-run-row').forEach((row) => {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        const runId = row.dataset.runId;
        if (runId) params.onSelectRun(runId);
      });
    });

    // Update pagination
    paginationEl.style.display = 'flex';
    const currentPage = Math.floor(currentOffset / PAGE_SIZE) + 1;
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    pageInfoEl.textContent = `Pagina ${currentPage} de ${totalPages}`;
    prevBtn.disabled = currentOffset === 0;
    nextBtn.disabled = currentOffset + PAGE_SIZE >= totalCount;
  }

  async function loadRuns() {
    try {
      const result = await rpc.request.listPipelineRuns({
        pipelineId: params.pipelineId,
        limit: PAGE_SIZE,
        offset: currentOffset,
      });
      runs = result.runs || [];
      totalCount = result.totalCount || 0;
      renderRuns();
    } catch (e) {
      contentEl.innerHTML = `
        <div class="pipeline-history-error">
          <p>Error al cargar historial.</p>
        </div>
      `;
    }
  }

  loadRuns();
}

function getStatusBadge(status: string): string {
  switch (status) {
    case 'completed':
      return `<span class="ph-status-badge ph-status-badge-completed">Completado</span>`;
    case 'failed':
      return `<span class="ph-status-badge ph-status-badge-failed">Fallido</span>`;
    case 'running':
      return `<span class="ph-status-badge ph-status-badge-running">Ejecutando</span>`;
    case 'paused':
      return `<span class="ph-status-badge ph-status-badge-paused">Pausado</span>`;
    default:
      return `<span class="ph-status-badge ph-status-badge-pending">${escapeHtml(status)}</span>`;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
