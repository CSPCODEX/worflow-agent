type DoneCallback = () => void;

export function renderCreateAgent(container: HTMLElement, onDone: DoneCallback) {
  container.innerHTML = `
    <div class="create-agent-view">
      <h2>Crear nuevo agente</h2>

      <div class="form-group">
        <label for="ca-name">Nombre</label>
        <input id="ca-name" type="text" placeholder="mi-agente" autocomplete="off" />
      </div>

      <div class="form-group">
        <label for="ca-desc">Descripción</label>
        <input id="ca-desc" type="text" placeholder="Un agente especializado en..." />
      </div>

      <div class="form-group">
        <label for="ca-role">System Prompt (Rol)</label>
        <textarea id="ca-role" placeholder="Eres un experto en TypeScript..."></textarea>
      </div>

      <div class="form-group">
        <label class="checkbox-row">
          <input id="ca-workspace" type="checkbox" checked />
          <span>Crear carpeta workspace (para manipulación de archivos)</span>
        </label>
      </div>

      <div class="form-actions">
        <button id="ca-submit" class="btn-primary" style="padding: 10px 24px; font-size: 13px;">
          Crear agente
        </button>
      </div>

      <div id="ca-feedback" class="form-feedback"></div>
    </div>
  `;

  const nameInput = container.querySelector<HTMLInputElement>('#ca-name')!;
  const descInput = container.querySelector<HTMLInputElement>('#ca-desc')!;
  const roleInput = container.querySelector<HTMLTextAreaElement>('#ca-role')!;
  const workspaceInput = container.querySelector<HTMLInputElement>('#ca-workspace')!;
  const submitBtn = container.querySelector<HTMLButtonElement>('#ca-submit')!;
  const feedback = container.querySelector<HTMLDivElement>('#ca-feedback')!;
  const rpc = (window as any).appRpc;

  submitBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const description = descInput.value.trim();
    const role = roleInput.value.trim();

    if (!name) { showFeedback('error', 'El nombre es obligatorio.'); return; }
    if (!description) { showFeedback('error', 'La descripción es obligatoria.'); return; }
    if (!role) { showFeedback('error', 'El rol/system prompt es obligatorio.'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creando...';
    feedback.className = 'form-feedback';

    try {
      const result = await rpc.request.generateAgent({
        name,
        description,
        role,
        needsWorkspace: workspaceInput.checked,
      });

      if (result.success) {
        showFeedback('success', `Agente "${name}" creado correctamente.`);
        nameInput.value = '';
        descInput.value = '';
        roleInput.value = '';
        // Notify app to refresh agent list
        document.dispatchEvent(new CustomEvent('agent:created'));
        setTimeout(() => onDone(), 1500);
      } else {
        showFeedback('error', result.error || 'Error desconocido al crear el agente.');
      }
    } catch (e: any) {
      showFeedback('error', e.message || 'Error al comunicarse con el proceso principal.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Crear agente';
    }
  });

  function showFeedback(type: 'success' | 'error', message: string) {
    feedback.textContent = message;
    feedback.className = `form-feedback ${type}`;
  }
}
