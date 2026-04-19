import { renderPipelineBuilder } from './pipeline-builder';
import { renderTemplateSelector } from './pipeline-template-selector';
import { escapeHtml } from '../utils/html';

interface PipelineListItem {
  id: string;
  name: string;
  description: string;
  stepCount: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  createdAt: string;
}

function showConfirm(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-dialog-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <div class="confirm-dialog-title">${escapeHtml(title)}</div>
        <div class="confirm-dialog-message">${escapeHtml(message)}</div>
        <div class="confirm-dialog-actions">
          <button id="confirm-cancel" class="btn-secondary">Cancelar</button>
          <button id="confirm-ok" class="btn-danger">Eliminar</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cancelBtn = overlay.querySelector<HTMLButtonElement>('#confirm-cancel')!;
    const okBtn = overlay.querySelector<HTMLButtonElement>('#confirm-ok')!;

    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve(false);
    });

    okBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve(true);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
        resolve(false);
      }
    });
  });
}

export function renderPipelineList(container: HTMLElement) {
  const rpc = (window as any).appRpc;
  let pipelines: PipelineListItem[] = [];

  container.innerHTML = `
    <div class="pipeline-list-view">
      <div class="pipeline-list-header">
        <h2>Pipelines</h2>
        <button id="pl-new" class="btn-primary">+ Nuevo Pipeline</button>
      </div>
      <div id="pl-content">
        <div class="pipeline-list-loading">
          <div class="spinner"></div>
          <span>Cargando pipelines...</span>
        </div>
      </div>
    </div>
  `;

  const contentEl = container.querySelector<HTMLDivElement>('#pl-content')!;
  const newBtn = container.querySelector<HTMLButtonElement>('#pl-new')!;

  function renderPipelineItems() {
    if (pipelines.length === 0) {
      contentEl.innerHTML = `
        <div class="empty-state">
          <p>No hay pipelines todavia.</p>
          <p style="margin-top:8px;color:#555;font-size:12px">Crea tu primer pipeline con el boton de arriba.</p>
        </div>
      `;
      return;
    }

    contentEl.innerHTML = `
      <div class="pipeline-items-list">
        ${pipelines.map((p) => `
          <div class="pipeline-item" data-pipeline-id="${escapeHtml(p.id)}">
            <div class="pipeline-item-main">
              <div class="pipeline-item-name">${escapeHtml(p.name)}</div>
              <div class="pipeline-item-desc">${escapeHtml(p.description || 'Sin descripcion')}</div>
              <div class="pipeline-item-meta">
                <span>${p.stepCount} paso${p.stepCount !== 1 ? 's' : ''}</span>
                ${p.lastRunAt ? `<span>Ultima ejecucion: ${formatDate(p.lastRunAt)}</span>` : '<span>Sin ejecucion</span>'}
              </div>
            </div>
            <div class="pipeline-item-actions">
              <button class="btn-pipeline-edit" data-pipeline-id="${escapeHtml(p.id)}" title="Editar">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M10 2l2 2-7 7H3v-2l7-7z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                </svg>
                Editar
              </button>
              <button class="btn-pipeline-delete" data-pipeline-id="${escapeHtml(p.id)}" title="Eliminar">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 3h10M5 3V2h4v1M5 6v5M9 6v5M3 3l1 9h6l1-9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    // Edit button handlers
    contentEl.querySelectorAll<HTMLButtonElement>('.btn-pipeline-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.pipelineId!;
        openBuilder('edit', id);
      });
    });

    // Delete button handlers
    contentEl.querySelectorAll<HTMLButtonElement>('.btn-pipeline-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.pipelineId!;
        const pipeline = pipelines.find((p) => p.id === id);
        const confirmed = await showConfirm(
          'Eliminar Pipeline',
          `Estas seguro de que quieres eliminar "${pipeline?.name || id}"? Esta accion no se puede deshacer.`
        );
        if (!confirmed) return;

        try {
          const result = await rpc.request.deletePipeline({ pipelineId: id });
          if (result.success) {
            await loadPipelines();
          }
        } catch (e: any) {
          console.error('Error deleting pipeline:', e);
        }
      });
    });

    // Click on pipeline item to edit
    contentEl.querySelectorAll<HTMLElement>('.pipeline-item-main').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el.closest('.pipeline-item') as HTMLElement)?.dataset.pipelineId;
        if (id) openBuilder('edit', id);
      });
    });
  }

  async function loadPipelines() {
    try {
      const result = await rpc.request.listPipelines();
      pipelines = result.pipelines || [];
      renderPipelineItems();
    } catch (e) {
      contentEl.innerHTML = `
        <div class="empty-state">
          <p>Error al cargar pipelines.</p>
        </div>
      `;
    }
  }

  function openBuilder(mode: 'create' | 'edit', pipelineId?: string, templateId?: string) {
    // Clear content and render builder
    contentEl.innerHTML = '';

    const builderContainer = document.createElement('div');
    contentEl.appendChild(builderContainer);

    renderPipelineBuilder(builderContainer, {
      mode,
      pipelineId,
      templateId,
      onSaved: () => {
        loadPipelines();
      },
      onCancel: () => {
        loadPipelines();
      },
    });
  }

  function openTemplateSelector() {
    const overlay = document.createElement('div');
    document.body.appendChild(overlay);

    renderTemplateSelector(overlay as HTMLElement, {
      onSelect: (template) => {
        document.body.removeChild(overlay);
        openBuilder('create', undefined, template.id);
      },
      onBlank: () => {
        document.body.removeChild(overlay);
        openBuilder('create');
      },
      onClose: () => {
        document.body.removeChild(overlay);
      },
    });
  }

  newBtn.addEventListener('click', openTemplateSelector);

  loadPipelines();
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}