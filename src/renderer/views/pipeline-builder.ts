import type { AgentInfo } from '../../types/ipc';
import type {
  GetPipelineResult,
  GetPipelineTemplateResult,
} from '../../types/pipeline';
import { escapeHtml } from '../utils/html';

export interface PipelineBuilderParams {
  mode: 'create' | 'edit';
  pipelineId?: string;
  templateId?: string;
  onSaved: () => void;
  onCancel: () => void;
}

interface StepState {
  id?: string;
  order: number;
  name: string;
  agentId: string;
  inputTemplate: string;
}

export function renderPipelineBuilder(
  container: HTMLElement,
  params: PipelineBuilderParams
) {
  const rpc = (window as any).appRpc;

  let steps: StepState[] = [];
  let availableAgents: AgentInfo[] = [];

  container.innerHTML = `
    <div class="pipeline-builder-view">
      <div class="pipeline-builder-header">
        <h2 id="pb-title">Nuevo Pipeline</h2>
      </div>
      <div class="pipeline-builder-body">
        <div class="form-group">
          <label for="pb-name">Nombre del pipeline</label>
          <input id="pb-name" type="text" placeholder="mi-pipeline" autocomplete="off" />
        </div>
        <div class="form-group">
          <label for="pb-desc">Descripcion</label>
          <textarea id="pb-desc" placeholder="Que hace este pipeline..." rows="2"></textarea>
        </div>

        <div class="pipeline-steps-section">
          <div class="pipeline-steps-header">
            <h3>Pasos</h3>
            <button id="pb-add-step" class="btn-secondary">+ Anadir paso</button>
          </div>
          <div id="pb-steps-list"></div>
        </div>
      </div>
      <div class="pipeline-builder-footer">
        <button id="pb-cancel" class="btn-secondary">Cancelar</button>
        <button id="pb-save" class="btn-primary">Guardar</button>
      </div>
      <div id="pb-feedback" class="form-feedback"></div>
    </div>
  `;

  const titleEl = container.querySelector<HTMLHeadingElement>('#pb-title')!;
  const nameInput = container.querySelector<HTMLInputElement>('#pb-name')!;
  const descInput = container.querySelector<HTMLTextAreaElement>('#pb-desc')!;
  const stepsListEl = container.querySelector<HTMLDivElement>('#pb-steps-list')!;
  const addStepBtn = container.querySelector<HTMLButtonElement>('#pb-add-step')!;
  const cancelBtn = container.querySelector<HTMLButtonElement>('#pb-cancel')!;
  const saveBtn = container.querySelector<HTMLButtonElement>('#pb-save')!;
  const feedbackEl = container.querySelector<HTMLDivElement>('#pb-feedback')!;

  titleEl.textContent = params.mode === 'edit' ? 'Editar Pipeline' : 'Nuevo Pipeline';

  // Load available agents
  rpc.request.listAgents().then((result: { agents: AgentInfo[] }) => {
    availableAgents = result.agents || [];
    renderSteps();
  }).catch(() => {
    availableAgents = [];
  });

  // Load pipeline data if editing
  if (params.mode === 'edit' && params.pipelineId) {
    rpc.request.getPipeline({ pipelineId: params.pipelineId }).then((result: GetPipelineResult) => {
      if (result.pipeline) {
        nameInput.value = result.pipeline.name;
        descInput.value = result.pipeline.description;
        steps = result.pipeline.steps.map((s) => ({
          id: s.id,
          order: s.order,
          name: s.name,
          agentId: s.agentId,
          inputTemplate: s.inputTemplate,
        }));
        renderSteps();
      }
    }).catch(() => {});
  }

  // Load template if provided
  if (params.templateId) {
    rpc.request.getPipelineTemplate({ templateId: params.templateId }).then((result: GetPipelineTemplateResult) => {
      if (result.template) {
        nameInput.value = result.template.name;
        descInput.value = result.template.description;
        steps = result.template.steps.map((s, i) => ({
          order: i + 1,
          name: s.name,
          agentId: '',
          inputTemplate: s.inputTemplate,
        }));
        renderSteps();
      }
    }).catch(() => {});
  }

  function renderSteps() {
    stepsListEl.innerHTML = '';

    steps.forEach((step, index) => {
      const stepEl = document.createElement('div');
      stepEl.className = 'pipeline-step-item';
      stepEl.innerHTML = `
        <div class="pipeline-step-number">${index + 1}</div>
        <div class="pipeline-step-fields">
          <div class="pipeline-step-row">
            <div class="form-group" style="flex:1">
              <label>Nombre del paso</label>
              <input class="step-name" type="text" value="${escapeHtml(step.name)}" placeholder="Nombre del paso" data-step-index="${index}" />
            </div>
          </div>
          <div class="pipeline-step-row">
            <div class="form-group" style="flex:1">
              <label>Agente</label>
              <select class="step-agent" data-step-index="${index}">
                <option value="">Seleccionar agente...</option>
                ${availableAgents.map((a) => `
                  <option value="${a.id}" ${a.id === step.agentId ? 'selected' : ''}>${escapeHtml(a.name)}</option>
                `).join('')}
              </select>
            </div>
          </div>
          <div class="pipeline-step-row">
            <div class="form-group" style="flex:1">
              <label>Input template <span class="step-template-hint">Usa {{variable}} o {{output_paso_N}}</span></label>
              <textarea class="step-template" rows="3" placeholder="Ej: Investiga sobre {{tema}}" data-step-index="${index}">${escapeHtml(step.inputTemplate)}</textarea>
            </div>
          </div>
        </div>
        <div class="pipeline-step-actions">
          <button class="btn-step-move step-up" data-step-index="${index}" title="Subir" ${index === 0 ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 3L3 7l4 4M3 7h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="btn-step-move step-down" data-step-index="${index}" title="Bajar" ${index === steps.length - 1 ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 11l4-4-4-4M11 7H3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="btn-step-delete" data-step-index="${index}" title="Eliminar paso">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      `;
      stepsListEl.appendChild(stepEl);
    });

    // Attach event listeners
    stepsListEl.querySelectorAll<HTMLInputElement>('.step-name').forEach((input) => {
      input.addEventListener('input', (e) => {
        const idx = parseInt((e.target as HTMLInputElement).dataset.stepIndex!);
        const step = steps[idx];
        if (step) step.name = (e.target as HTMLInputElement).value;
      });
    });

    stepsListEl.querySelectorAll<HTMLSelectElement>('.step-agent').forEach((select) => {
      select.addEventListener('change', (e) => {
        const idx = parseInt((e.target as HTMLSelectElement).dataset.stepIndex!);
        const step = steps[idx];
        if (step) step.agentId = (e.target as HTMLSelectElement).value;
      });
    });

    stepsListEl.querySelectorAll<HTMLTextAreaElement>('.step-template').forEach((textarea) => {
      textarea.addEventListener('input', (e) => {
        const idx = parseInt((e.target as HTMLTextAreaElement).dataset.stepIndex!);
        const step = steps[idx];
        if (step) step.inputTemplate = (e.target as HTMLTextAreaElement).value;
      });
    });

    stepsListEl.querySelectorAll<HTMLButtonElement>('.step-up').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.stepIndex!);
        if (idx > 0) {
          const prev = steps[idx - 1];
          const curr = steps[idx];
          if (prev && curr) {
            steps[idx] = prev;
            steps[idx - 1] = curr;
            steps.forEach((s, i) => { s.order = i + 1; });
            renderSteps();
          }
        }
      });
    });

    stepsListEl.querySelectorAll<HTMLButtonElement>('.step-down').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.stepIndex!);
        if (idx < steps.length - 1) {
          const curr = steps[idx];
          const next = steps[idx + 1];
          if (curr && next) {
            steps[idx] = next;
            steps[idx + 1] = curr;
            steps.forEach((s, i) => { s.order = i + 1; });
            renderSteps();
          }
        }
      });
    });

    stepsListEl.querySelectorAll<HTMLButtonElement>('.btn-step-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.stepIndex!);
        steps.splice(idx, 1);
        steps.forEach((s, i) => { s.order = i + 1; });
        renderSteps();
      });
    });
  }

  addStepBtn.addEventListener('click', () => {
    steps.push({
      order: steps.length + 1,
      name: '',
      agentId: '',
      inputTemplate: '',
    });
    renderSteps();
  });

  cancelBtn.addEventListener('click', params.onCancel);

  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const description = descInput.value.trim();

    if (!name) {
      showFeedback('error', 'El nombre es obligatorio.');
      return;
    }

    if (steps.length === 0) {
      showFeedback('error', 'Al menos un paso es requerido.');
      return;
    }

    const hasEmptyStep = steps.some((s) => !s.name.trim() || !s.agentId);
    if (hasEmptyStep) {
      showFeedback('error', 'Todos los pasos deben tener nombre y agente.');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';

    try {
      let result;
      if (params.mode === 'edit' && params.pipelineId) {
        result = await rpc.request.updatePipeline({
          pipelineId: params.pipelineId,
          name,
          description,
          steps: steps.map((s) => ({
            order: s.order,
            name: s.name,
            agentId: s.agentId,
            inputTemplate: s.inputTemplate,
          })),
        });
      } else {
        result = await rpc.request.createPipeline({
          name,
          description,
          templateId: params.templateId,
          steps: steps.map((s) => ({
            order: s.order,
            name: s.name,
            agentId: s.agentId,
            inputTemplate: s.inputTemplate,
          })),
        });
      }

      if (result.success) {
        showFeedback('success', params.mode === 'edit' ? 'Pipeline actualizado.' : 'Pipeline creado.');
        setTimeout(() => params.onSaved(), 800);
      } else {
        showFeedback('error', result.error || 'Error al guardar.');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar';
      }
    } catch (e: any) {
      showFeedback('error', e.message || 'Error de comunicacion.');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar';
    }
  });

  function showFeedback(type: 'success' | 'error', message: string) {
    feedbackEl.textContent = message;
    feedbackEl.className = `form-feedback ${type}`;
  }
}