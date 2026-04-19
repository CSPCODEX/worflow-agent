// Constants shared across renderSettings
const PROVIDER_LABELS: Record<string, string> = {
  lmstudio: 'LM Studio',
  ollama: 'Ollama',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
};
const LOCAL_PROVIDER_IDS = ['lmstudio', 'ollama'];

export function renderSettings(container: HTMLElement): { cleanup(): void } {
  container.innerHTML = `
    <div class="settings-view">
      <h2>Configuracion</h2>

      <!-- AI Model Section -->
      <div class="settings-section">
        <h3 class="settings-section-title">Modelo de IA</h3>
        <p class="settings-section-desc">Selecciona el provider que quieres usar para todos los agentes.</p>

        <!-- Local models radio -->
        <div class="provider-group">
          <label class="radio-group-label">
            <input type="radio" name="provider-type" id="pt-local" value="local" />
            Modelo local (recomendado)
          </label>

          <div class="provider-list" id="local-providers-list">
            <div class="provider-item" id="provider-lmstudio">
              <div class="provider-radio">
                <input type="radio" name="provider" id="prov-lmstudio" value="lmstudio" />
              </div>
              <div class="provider-info">
                <div class="provider-name">LM Studio</div>
                <div class="provider-host">localhost:1234</div>
              </div>
              <div class="provider-status" id="status-lmstudio">
                <span class="status-dot status-checking"></span>
                <span class="status-text">Detectando...</span>
              </div>
              <button class="btn-test-conn" id="test-lmstudio" data-provider="lmstudio">Probar</button>
            </div>

            <div class="provider-item" id="provider-ollama">
              <div class="provider-radio">
                <input type="radio" name="provider" id="prov-ollama" value="ollama" />
              </div>
              <div class="provider-info">
                <div class="provider-name">Ollama</div>
                <div class="provider-host">localhost:11434</div>
              </div>
              <div class="provider-status" id="status-ollama">
                <span class="status-dot status-checking"></span>
                <span class="status-text">Detectando...</span>
              </div>
              <button class="btn-test-conn" id="test-ollama" data-provider="ollama">Probar</button>
            </div>
          </div>
        </div>

        <!-- Cloud API radio -->
        <div class="provider-group">
          <label class="radio-group-label">
            <input type="radio" name="provider-type" id="pt-cloud" value="cloud" />
            API Cloud (requiere API key)
          </label>

          <div class="provider-list" id="cloud-providers-list">
            <div class="provider-item" id="provider-openai">
              <div class="provider-radio">
                <input type="radio" name="provider" id="prov-openai" value="openai" />
              </div>
              <div class="provider-info">
                <div class="provider-name">OpenAI</div>
              </div>
              <div class="provider-api-key">
                <input type="password" id="apikey-openai" placeholder="sk-..." class="api-key-input" autocomplete="off" />
                <button class="btn-test-conn" id="test-openai" data-provider="openai">Probar</button>
              </div>
            </div>

            <div class="provider-item" id="provider-anthropic">
              <div class="provider-radio">
                <input type="radio" name="provider" id="prov-anthropic" value="anthropic" />
              </div>
              <div class="provider-info">
                <div class="provider-name">Anthropic</div>
              </div>
              <div class="provider-api-key">
                <input type="password" id="apikey-anthropic" placeholder="sk-ant-..." class="api-key-input" autocomplete="off" />
                <button class="btn-test-conn" id="test-anthropic" data-provider="anthropic">Probar</button>
              </div>
            </div>

            <div class="provider-item" id="provider-gemini">
              <div class="provider-radio">
                <input type="radio" name="provider" id="prov-gemini" value="gemini" />
              </div>
              <div class="provider-info">
                <div class="provider-name">Gemini</div>
              </div>
              <div class="provider-api-key">
                <input type="password" id="apikey-gemini" placeholder="AI..." class="api-key-input" autocomplete="off" />
                <button class="btn-test-conn" id="test-gemini" data-provider="gemini">Probar</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Active provider indicator -->
        <div class="active-provider" id="active-provider-display">
          Provider activo: <strong id="active-provider-name">—</strong>
          <span id="active-provider-check"></span>
        </div>
      </div>

      <!-- About Section -->
      <div class="settings-section">
        <h3 class="settings-section-title">Acerca de</h3>
        <div class="about-info">
          <div class="about-row">
            <span class="about-label">Version</span>
            <span class="about-value" id="app-version">—</span>
          </div>
          <div class="about-row">
            <span class="about-label">Documentacion</span>
            <a href="#" id="docs-link" class="about-link" target="_blank">Abrir documentacion</a>
          </div>
        </div>
      </div>

      <div id="st-feedback" class="form-feedback"></div>
    </div>
  `;

  const rpc = (window as any).appRpc;
  let currentActiveProvider = '';

  // ── Helpers ──────────────────────────────────────────────────────

  function showFeedback(type: 'success' | 'error', message: string) {
    const feedback = container.querySelector<HTMLDivElement>('#st-feedback')!;
    feedback.textContent = message;
    feedback.className = `form-feedback ${type}`;
    if (type === 'success') {
      setTimeout(() => {
        feedback.className = 'form-feedback';
        feedback.textContent = '';
      }, 3000);
    }
  }

  function setProviderStatus(providerId: string, status: 'available' | 'unavailable' | 'checking' | 'testing' | 'success' | 'error', errorMsg?: string) {
    const statusEl = container.querySelector<HTMLDivElement>(`#status-${providerId}`);
    if (!statusEl) return;

    const dot = statusEl.querySelector('.status-dot') as HTMLElement;
    const text = statusEl.querySelector('.status-text') as HTMLElement;
    if (!dot || !text) return;

    dot.className = 'status-dot';
    switch (status) {
      case 'available':
        dot.classList.add('status-available');
        text.textContent = 'Detectado';
        break;
      case 'unavailable':
        dot.classList.add('status-unavailable');
        text.textContent = 'No detectado';
        break;
      case 'checking':
        dot.classList.add('status-checking');
        text.textContent = 'Detectando...';
        break;
      case 'testing':
        dot.classList.add('status-checking');
        text.textContent = 'Probando...';
        break;
      case 'success':
        dot.classList.add('status-available');
        text.textContent = 'OK';
        break;
      case 'error':
        dot.classList.add('status-unavailable');
        text.textContent = errorMsg ?? 'Error';
        break;
    }
  }

  function updateActiveProviderDisplay(providerId: string, label: string) {
    const nameEl = container.querySelector<HTMLSpanElement>('#active-provider-name')!;
    const checkEl = container.querySelector<HTMLSpanElement>('#active-provider-check')!;
    nameEl.textContent = label;
    checkEl.textContent = ' ';
    currentActiveProvider = providerId;
  }

  function selectProviderRadio(providerId: string) {
    const radio = container.querySelector<HTMLInputElement>(`#prov-${providerId}`);
    if (radio) radio.checked = true;
  }

  // ── Initial Load ─────────────────────────────────────────────────

  async function init() {
    try {
      // 1. Detect local providers
      const detectResult = await rpc.request.detectLocalProviders();
      const localProviders: Array<{ id: string; label: string; available: boolean; host: string }> = detectResult.providers ?? [];

      for (const p of localProviders) {
        setProviderStatus(p.id, p.available ? 'available' : 'unavailable');
      }

      // 2. Load settings (current active provider)
      const settingsResult = await rpc.request.loadSettings();
      const { defaultProvider, defaultProviderConfig } = settingsResult.settings;

      // Determine provider type
      const isLocal = LOCAL_PROVIDER_IDS.includes(defaultProvider);
      const ptRadio = container.querySelector<HTMLInputElement>(isLocal ? '#pt-local' : '#pt-cloud');
      if (ptRadio) ptRadio.checked = true;

      // Show/hide provider lists based on selected type
      const localList = container.querySelector<HTMLElement>('#local-providers-list');
      const cloudList = container.querySelector<HTMLElement>('#cloud-providers-list');
      if (localList) localList.style.display = isLocal ? 'flex' : 'none';
      if (cloudList) cloudList.style.display = isLocal ? 'none' : 'flex';

      // Select active provider radio
      selectProviderRadio(defaultProvider);

      // Load encrypted API keys for cloud providers
      if (!isLocal && defaultProviderConfig) {
        try {
          const config = typeof defaultProviderConfig === 'string'
            ? JSON.parse(defaultProviderConfig)
            : defaultProviderConfig;
          // API keys are stored encrypted; we show masked version (last 4 chars)
          if (config.apiKey && config.apiKey.startsWith('enc:')) {
            // API key is encrypted — show masked
            const maskedKey = '****' + config.apiKeyLast4;
            const input = container.querySelector<HTMLInputElement>(`#apikey-${defaultProvider}`);
            if (input) {
              input.value = maskedKey;
              input.dataset.masked = 'true';
            }
          }
        } catch { /* ignore parse errors */ }
      }

      // Get provider label
      updateActiveProviderDisplay(defaultProvider, PROVIDER_LABELS[defaultProvider] ?? defaultProvider);

      // 3. App version (from package.json via IPC or hardcoded)
      const versionEl = container.querySelector<HTMLSpanElement>('#app-version');
      if (versionEl) versionEl.textContent = '0.1.0';

    } catch (e: any) {
      showFeedback('error', 'Error al cargar configuracion: ' + (e.message ?? 'desconocido'));
    }
  }

  // ── Event Listeners ──────────────────────────────────────────────

  // Toggle provider type (local vs cloud)
  container.querySelectorAll<HTMLInputElement>('input[name="provider-type"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const isLocal = radio.value === 'local';
      const localList = container.querySelector<HTMLElement>('#local-providers-list');
      const cloudList = container.querySelector<HTMLElement>('#cloud-providers-list');
      if (localList) localList.style.display = isLocal ? 'flex' : 'none';
      if (cloudList) cloudList.style.display = isLocal ? 'none' : 'flex';
    });
  });

  // Select a specific provider (radio change)
  container.querySelectorAll<HTMLInputElement>('input[name="provider"]').forEach((radio) => {
    radio.addEventListener('change', async () => {
      const providerId = radio.value;
      updateActiveProviderDisplay(providerId, PROVIDER_LABELS[providerId] ?? providerId);
    });
  });

  // Test connection buttons
  container.querySelectorAll<HTMLButtonElement>('.btn-test-conn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const providerId = btn.dataset.provider;
      if (!providerId) return;

      const isLocal = providerId === 'lmstudio' || providerId === 'ollama';

      // Disable button while checking
      btn.disabled = true;
      const originalText = btn.textContent ?? 'Probar';
      setProviderStatus(providerId, 'testing');

      try {
        // For cloud providers, get the API key from the input
        let apiKey: string | undefined;
        if (!isLocal) {
          const input = container.querySelector<HTMLInputElement>(`#apikey-${providerId}`);
          if (input) apiKey = input.value.trim();
        }

        const result = await rpc.request.validateProviderConnection({ providerId, apiKey });
        if (result.success) {
          setProviderStatus(providerId, 'success');
        } else {
          setProviderStatus(providerId, 'error', result.error ?? 'Error');
        }
      } catch (e: any) {
        setProviderStatus(providerId, 'error', e.message ?? 'Error');
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  });

  // Save button — triggered when leaving settings or explicit save button
  // Settings auto-save on provider selection (for MVP)
  // We add a save button for explicit confirmation
  const saveBtn = document.createElement('button');
  saveBtn.id = 'st-save';
  saveBtn.className = 'btn-primary';
  saveBtn.textContent = 'Guardar configuracion';
  saveBtn.style.marginTop = '20px';

  const actionsDiv = container.querySelector<HTMLDivElement>('.settings-view');
  if (actionsDiv) {
    // Insert before feedback div
    const feedback = actionsDiv.querySelector('#st-feedback');
    actionsDiv.insertBefore(saveBtn, feedback);
  }

  async function onSave() {
    const selectedRadio = container.querySelector<HTMLInputElement>('input[name="provider"]:checked');
    if (!selectedRadio) {
      showFeedback('error', 'Selecciona un provider.');
      return;
    }

    const providerId = selectedRadio.value;
    const isLocal = providerId === 'lmstudio' || providerId === 'ollama';

    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';

    try {
      let defaultProviderConfig: Record<string, string> = {};

      // For cloud providers, encrypt and save API key
      if (!isLocal) {
        const input = container.querySelector<HTMLInputElement>(`#apikey-${providerId}`);
        const rawKey = input?.value.trim() ?? '';
        if (rawKey && !rawKey.startsWith('****')) {
          // New key entered — encrypt it in the renderer before sending
          const encryptedResult = await rpc.request.encryptApiKey({ plaintext: rawKey });
          defaultProviderConfig = {
            apiKey: encryptedResult.encrypted,
            apiKeyLast4: rawKey.slice(-4),
          };
        } else if (rawKey.startsWith('****')) {
          // Masked — keep existing encrypted key from settings
          // We need to load existing config to preserve the encrypted key
          const existing = await rpc.request.loadSettings();
          const prevConfig = typeof existing.settings.defaultProviderConfig === 'string'
            ? JSON.parse(existing.settings.defaultProviderConfig)
            : existing.settings.defaultProviderConfig;
          defaultProviderConfig = prevConfig ?? {};
        }
      }

      const result = await rpc.request.saveSettings({
        lmstudioHost: 'ws://127.0.0.1:1234', // legacy field, still required by handler
        enhancerModel: '', // legacy field
        defaultProvider: providerId,
        defaultProviderConfig: JSON.stringify(defaultProviderConfig),
      });

      if (result.success) {
        showFeedback('success', 'Configuracion guardada.');
      } else {
        showFeedback('error', result.error ?? 'Error al guardar.');
      }
    } catch (e: any) {
      showFeedback('error', e.message ?? 'Error de comunicacion.');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar configuracion';
    }
  }

  saveBtn.addEventListener('click', onSave);

  // Open docs link
  const docsLink = container.querySelector<HTMLAnchorElement>('#docs-link');
  if (docsLink) {
    docsLink.addEventListener('click', (e) => {
      e.preventDefault();
      rpc.request.openExternal({ url: 'https://flowteam.dev/docs' });
    });
  }

  init();

  return {
    cleanup() {
      saveBtn.removeEventListener('click', onSave);
    },
  };
}