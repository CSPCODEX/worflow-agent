type DoneCallback = () => void;
type EditModeCallback = (agentId: string) => void;

export function renderCreateAgent(
  container: HTMLElement,
  onDone: DoneCallback,
  onTestAgent?: (agentId: string, agentName: string) => void,
  editingAgentId?: string
) {
  const rpc = (window as any).appRpc;

  let isEditMode = false;
  let editingAgent: AgentInfo | null = null;

  // If editingAgentId is provided, load agent data first
  async function loadAgentData() {
    if (!editingAgentId) return null;
    try {
      const result = await rpc.request.getAgent({ agentId: editingAgentId });
      if (result.agent) return result.agent;
    } catch {}
    return null;
  }

  function renderForm(agent: AgentInfo | null) {
    isEditMode = !!agent;
    editingAgent = agent;

    const isDefaultAgent = isEditMode && agent?.isDefault === true;
    const titleText = isEditMode ? 'Editar agente' : 'Crear nuevo agente';
    const submitText = isEditMode ? 'Guardar cambios' : 'Crear agente';
    const showTestBtn = isEditMode && onTestAgent;

    container.innerHTML = `
      <div class="create-agent-view">
        <h2>${titleText}</h2>

        ${isDefaultAgent ? '<div class="form-feedback" style="background: #fef3cd; color: #856404; border: 1px solid #ffeeba; margin-bottom: 12px; padding: 10px 14px; border-radius: 4px; font-size: 13px;">Los agentes por defecto no son editables.</div>' : ''}

        <div class="form-group">
          <label for="ca-name">Nombre</label>
          <input id="ca-name" type="text" placeholder="mi-agente" autocomplete="off" value="${escapeHtml(agent?.name ?? '')}" ${isEditMode ? 'readonly' : ''} ${isDefaultAgent ? 'disabled' : ''} />
        </div>

        <div class="form-group">
          <label for="ca-desc">Descripcion</label>
          <input id="ca-desc" type="text" placeholder="Un agente especializado en..." value="${escapeHtml(agent?.description ?? '')}" ${isDefaultAgent ? 'readonly disabled' : ''} />
        </div>

        <div class="form-group">
          <label for="ca-role">System Prompt (Rol)</label>
          <textarea id="ca-role" placeholder="Eres un experto en TypeScript..." ${isDefaultAgent ? 'readonly disabled' : ''}>${escapeHtml(agent?.systemPrompt ?? '')}</textarea>
        </div>

        <div class="form-group">
          <label for="ca-provider">Proveedor de LLM</label>
          <select id="ca-provider" disabled>
            <option value="global">Usar global (recomendado)</option>
          </select>
          <small style="color: var(--text-muted, #888); font-size: 11px; margin-top: 4px; display: block;">
            Configurable en V1
          </small>
        </div>

        ${showTestBtn && !isDefaultAgent ? `
        <div class="form-group">
          <button id="ca-test" class="btn-secondary" style="padding: 8px 16px; font-size: 13px;">
            Probar agente
          </button>
        </div>` : ''}

        <div class="form-actions">
          ${!isDefaultAgent ? `<button id="ca-submit" class="btn-primary" style="padding: 10px 24px; font-size: 13px;">
            ${submitText}
          </button>` : ''}
          ${isEditMode ? '<button id="ca-cancel" class="btn-secondary" style="padding: 10px 16px; font-size: 13px;">Volver</button>' : ''}
        </div>

        <div id="ca-feedback" class="form-feedback"></div>
      </div>
    `;

    const nameInput = container.querySelector<HTMLInputElement>('#ca-name')!;
    const descInput = container.querySelector<HTMLInputElement>('#ca-desc')!;
    const roleInput = container.querySelector<HTMLTextAreaElement>('#ca-role')!;
    const submitBtn = container.querySelector<HTMLButtonElement>('#ca-submit')!;
    const feedback = container.querySelector<HTMLDivElement>('#ca-feedback')!;

    if (isEditMode) {
      const cancelBtn = container.querySelector<HTMLButtonElement>('#ca-cancel')!;
      cancelBtn.addEventListener('click', () => {
        onDone();
      });
    }

    if (showTestBtn) {
      const testBtn = container.querySelector<HTMLButtonElement>('#ca-test')!;
      testBtn.addEventListener('click', () => {
        if (editingAgent && onTestAgent) {
          onTestAgent(editingAgent.id, editingAgent.name);
        }
      });
    }

    submitBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const description = descInput.value.trim();
      const role = roleInput.value.trim();

      if (!name) { showFeedback('error', 'El nombre es obligatorio.'); return; }
      if (!role) { showFeedback('error', 'El rol/system prompt es obligatorio.'); return; }

      submitBtn.disabled = true;
      submitBtn.textContent = isEditMode ? 'Guardando...' : 'Creando...';
      feedback.className = 'form-feedback';

      try {
        if (isEditMode && editingAgent) {
          const result = await rpc.request.updateAgent({
            agentId: editingAgent.id,
            name,
            description,
            systemPrompt: role,
          });
          if (result.success) {
            document.dispatchEvent(new CustomEvent('agent:updated'));
            onDone();
          } else {
            showFeedback('error', result.error || 'Error al guardar.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Guardar cambios';
          }
        } else {
          const result = await rpc.request.generateAgent({
            name,
            description,
            role,
            needsWorkspace: false,
            provider: 'lmstudio',
          });
          if (result.success) {
            showFeedback('success', `Agente "${name}" creado.`);
            nameInput.value = '';
            descInput.value = '';
            roleInput.value = '';
            document.dispatchEvent(new CustomEvent('agent:created'));
            setTimeout(() => onDone(), 800);
          } else {
            showFeedback('error', result.error || 'Error desconocido al crear el agente.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Crear agente';
          }
        }
      } catch (e: any) {
        showFeedback('error', e.message || 'Error al comunicarse con el proceso principal.');
        submitBtn.disabled = false;
        submitBtn.textContent = isEditMode ? 'Guardar cambios' : 'Crear agente';
      }
    });
  }

  // Start: load agent if editing, then render
  loadAgentData().then((agent) => {
    renderForm(agent);
  }).catch(() => {
    renderForm(null);
  });
}

interface AgentInfo {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  [key: string]: unknown;
}

function showFeedback(type: 'success' | 'error' | 'installing', message: string) {
  const el = document.querySelector<HTMLElement>('#ca-feedback');
  if (el) {
    el.textContent = message;
    el.className = `form-feedback ${type}`;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}