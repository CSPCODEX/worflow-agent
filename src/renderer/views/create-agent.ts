type DoneCallback = () => void;

const VALID_PROVIDER_IDS = new Set(['lmstudio', 'ollama', 'openai', 'anthropic', 'gemini']);
const PROVIDERS_REQUIRING_KEY = new Set(['openai', 'anthropic', 'gemini']);

const API_KEY_LABELS: Record<string, string> = {
  openai: 'OpenAI API Key',
  anthropic: 'Anthropic API Key',
  gemini: 'Gemini API Key',
};

const DEFAULT_PROVIDER_OPTIONS = `
  <option value="lmstudio">LM Studio (local, sin API key)</option>
  <option value="ollama">Ollama (local, sin API key)</option>
  <option value="openai">OpenAI (requiere API key)</option>
  <option value="anthropic">Anthropic (requiere API key)</option>
  <option value="gemini">Gemini (requiere API key)</option>
`;

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

      <div class="form-group">
        <label for="ca-provider">Proveedor de LLM</label>
        <select id="ca-provider">
          ${DEFAULT_PROVIDER_OPTIONS}
        </select>
      </div>

      <div class="form-group" id="ca-apikey-group" style="display: none;">
        <label for="ca-apikey" id="ca-apikey-label">API Key</label>
        <input id="ca-apikey" type="password" placeholder="sk-..." autocomplete="off" />
        <small style="color: var(--text-muted, #888); font-size: 11px; margin-top: 4px; display: block;">
          La key se guardará encriptada en el archivo .env del agente.
        </small>
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
  const providerSelect = container.querySelector<HTMLSelectElement>('#ca-provider')!;
  const apiKeyGroup = container.querySelector<HTMLDivElement>('#ca-apikey-group')!;
  const apiKeyLabel = container.querySelector<HTMLLabelElement>('#ca-apikey-label')!;
  const apiKeyInput = container.querySelector<HTMLInputElement>('#ca-apikey')!;
  const submitBtn = container.querySelector<HTMLButtonElement>('#ca-submit')!;
  const feedback = container.querySelector<HTMLDivElement>('#ca-feedback')!;
  const rpc = (window as any).appRpc;

  // Load provider list from main process; fall back to default options if unavailable
  rpc.request.listProviders().then((result: { providers: Array<{ id: string; label: string; requiresApiKey: boolean; isLocal: boolean }> }) => {
    if (!result?.providers?.length) return;
    providerSelect.innerHTML = result.providers
      .map((p) => `<option value="${p.id}">${p.label}${p.isLocal ? ' (local)' : ' (requiere API key)'}</option>`)
      .join('');
    // Ensure change handler runs with the freshly loaded options
    updateApiKeyVisibility();
  }).catch(() => {
    // Keep the hardcoded fallback options already in the DOM
  });

  function updateApiKeyVisibility() {
    const provider = providerSelect.value;
    if (PROVIDERS_REQUIRING_KEY.has(provider)) {
      apiKeyGroup.style.display = '';
      apiKeyLabel.textContent = API_KEY_LABELS[provider] ?? 'API Key';
    } else {
      apiKeyGroup.style.display = 'none';
      apiKeyInput.value = '';
    }
  }

  providerSelect.addEventListener('change', updateApiKeyVisibility);

  submitBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const description = descInput.value.trim();
    const role = roleInput.value.trim();
    const provider = providerSelect.value;
    const apiKey = apiKeyInput.value.trim() || undefined;

    if (!name) { showFeedback('error', 'El nombre es obligatorio.'); return; }
    if (!description) { showFeedback('error', 'La descripción es obligatoria.'); return; }
    if (!role) { showFeedback('error', 'El rol/system prompt es obligatorio.'); return; }
    if (!VALID_PROVIDER_IDS.has(provider)) { showFeedback('error', 'Proveedor no válido. Selecciona uno de la lista.'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creando...';
    feedback.className = 'form-feedback';

    // Coordination flags — navigation waits for BOTH events.
    let installDone = false;
    let enhanceDone = false;

    function tryNavigate() {
      if (installDone && enhanceDone) {
        setTimeout(() => onDone(), 800);
      }
    }

    // Registered before the RPC call so they are in place when the events arrive.
    function onInstallDone(e: Event) {
      const { agentName, error } = (e as CustomEvent).detail as { agentName: string; error?: string };
      if (agentName !== name) return;

      document.removeEventListener('agent:install-done', onInstallDone);
      installDone = true;

      if (error) {
        document.removeEventListener('agent:enhance-done', onEnhanceDone);
        showFeedback('error', `Dependencias no instaladas: ${error}. Ejecuta "bun install" en la carpeta del agente.`);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Crear agente';
      } else {
        if (!enhanceDone) {
          showFeedback('installing', `Agente "${name}" listo. Optimizando prompt...`);
        }
        tryNavigate();
      }
    }

    function onEnhanceDone(e: Event) {
      const detail = (e as CustomEvent).detail as { agentName: string; strategy: string; error?: string };
      if (detail.agentName !== name) return;

      document.removeEventListener('agent:enhance-done', onEnhanceDone);
      enhanceDone = true;

      if (detail.strategy === 'lmstudio') {
        showFeedback('success', `Agente "${name}" listo. Prompt optimizado con IA.`);
      } else if (detail.strategy === 'static') {
        showFeedback('success', `Agente "${name}" listo. Prompt estructurado.`);
      }
      // strategy === 'failed': keep the current message — agent works with the original prompt.

      tryNavigate();
    }

    document.addEventListener('agent:install-done', onInstallDone);
    document.addEventListener('agent:enhance-done', onEnhanceDone);

    try {
      const result = await rpc.request.generateAgent({
        name,
        description,
        role,
        needsWorkspace: workspaceInput.checked,
        provider,
        ...(apiKey !== undefined ? { apiKey } : {}),
      });

      if (result.success) {
        // Scaffolding complete. Dependencies + enhance are running in the background.
        showFeedback('installing', `Estructura creada. Instalando dependencias...`);
        nameInput.value = '';
        descInput.value = '';
        roleInput.value = '';
        apiKeyInput.value = '';
        providerSelect.value = 'lmstudio';
        updateApiKeyVisibility();
        // Notify app to refresh the agent list immediately so the new entry is visible.
        document.dispatchEvent(new CustomEvent('agent:created'));
      } else {
        document.removeEventListener('agent:install-done', onInstallDone);
        document.removeEventListener('agent:enhance-done', onEnhanceDone);
        showFeedback('error', result.error || 'Error desconocido al crear el agente.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Crear agente';
      }
    } catch (e: any) {
      document.removeEventListener('agent:install-done', onInstallDone);
      document.removeEventListener('agent:enhance-done', onEnhanceDone);
      showFeedback('error', e.message || 'Error al comunicarse con el proceso principal.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Crear agente';
    }
  });

  function showFeedback(type: 'success' | 'error' | 'installing', message: string) {
    feedback.textContent = message;
    feedback.className = `form-feedback ${type}`;
  }
}
