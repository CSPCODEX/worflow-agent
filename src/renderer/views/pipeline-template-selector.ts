import type { ListPipelineTemplatesResult } from '../../types/pipeline';
import { escapeHtml } from '../utils/html';

export interface TemplateSelectorCallbacks {
  onSelect: (template: ListPipelineTemplatesResult['templates'][0]) => void;
  onBlank: () => void;
  onClose: () => void;
}

export function renderTemplateSelector(
  container: HTMLElement,
  callbacks: TemplateSelectorCallbacks
) {
  const rpc = (window as any).appRpc;

  container.innerHTML = `
    <div class="template-selector-overlay">
      <div class="template-selector-modal">
        <div class="template-selector-header">
          <h2>Seleccionar Template</h2>
          <button id="ts-close" class="btn-icon" title="Cerrar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="template-selector-body">
          <div id="ts-loading" class="template-selector-loading">
            <div class="spinner"></div>
            <span>Cargando templates...</span>
          </div>
          <div id="ts-grid" class="template-grid" style="display:none"></div>
          <div id="ts-error" class="template-selector-error" style="display:none"></div>
        </div>
        <div class="template-selector-footer">
          <button id="ts-blank" class="btn-secondary">Desde cero</button>
        </div>
      </div>
    </div>
  `;

  const closeBtn = container.querySelector<HTMLButtonElement>('#ts-close')!;
  const blankBtn = container.querySelector<HTMLButtonElement>('#ts-blank')!;
  const loadingEl = container.querySelector<HTMLDivElement>('#ts-loading')!;
  const gridEl = container.querySelector<HTMLDivElement>('#ts-grid')!;
  const errorEl = container.querySelector<HTMLDivElement>('#ts-error')!;

  closeBtn.addEventListener('click', callbacks.onClose);
  blankBtn.addEventListener('click', callbacks.onBlank);

  rpc.request.listPipelineTemplates().then((result: ListPipelineTemplatesResult) => {
    loadingEl.style.display = 'none';

    if (!result.templates || result.templates.length === 0) {
      errorEl.textContent = 'No hay templates disponibles.';
      errorEl.style.display = 'block';
      return;
    }

    gridEl.innerHTML = result.templates.map((t) => `
      <div class="template-card" data-template-id="${escapeHtml(t.id)}">
        <div class="template-card-header">
          <span class="template-card-name">${escapeHtml(t.name)}</span>
          ${t.isBuiltin ? '<span class="template-badge-builtin">builtin</span>' : ''}
        </div>
        <div class="template-card-desc">${escapeHtml(t.description || 'Sin descripcion')}</div>
        <div class="template-card-meta">
          <span class="template-card-category">${escapeHtml(t.category)}</span>
          <span class="template-card-steps">${t.stepCount} paso${t.stepCount !== 1 ? 's' : ''}</span>
          ${t.recommendedModel ? `<span class="template-card-model">${escapeHtml(t.recommendedModel)}</span>` : ''}
        </div>
      </div>
    `).join('');

    gridEl.style.display = 'grid';

    // Attach click handlers to cards
    gridEl.querySelectorAll<HTMLElement>('.template-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.templateId!;
        const template = result.templates.find((t) => t.id === id);
        if (template) callbacks.onSelect(template);
      });
    });
  }).catch((e: Error) => {
    loadingEl.style.display = 'none';
    errorEl.textContent = `Error al cargar templates: ${e.message}`;
    errorEl.style.display = 'block';
  });
}