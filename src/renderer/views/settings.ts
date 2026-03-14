export function renderSettings(container: HTMLElement): { cleanup(): void } {
  container.innerHTML = `
    <div class="settings-view">
      <h2>Configuracion</h2>

      <div class="form-group">
        <label for="st-lmhost">Host de LM Studio</label>
        <input id="st-lmhost" type="text" placeholder="ws://127.0.0.1:1234" autocomplete="off" />
        <small>Direccion WebSocket del servidor LM Studio local.</small>
      </div>

      <div class="form-group">
        <label for="st-model">Modelo del enhancer (opcional)</label>
        <input id="st-model" type="text" placeholder="dejar vacio para usar el modelo activo" autocomplete="off" />
        <small>Nombre exacto del modelo a usar para optimizar prompts. Vacio = primer modelo disponible.</small>
      </div>

      <div class="form-group">
        <label for="st-datadir">Directorio de datos</label>
        <input id="st-datadir" type="text" disabled />
        <small>Solo lectura. Ubicacion de la base de datos y agentes generados.</small>
      </div>

      <div class="form-actions">
        <button id="st-save" class="btn-primary">Guardar</button>
      </div>

      <div id="st-feedback" class="form-feedback"></div>
    </div>
  `;

  const hostInput = container.querySelector<HTMLInputElement>('#st-lmhost')!;
  const modelInput = container.querySelector<HTMLInputElement>('#st-model')!;
  const dataDirInput = container.querySelector<HTMLInputElement>('#st-datadir')!;
  const saveBtn = container.querySelector<HTMLButtonElement>('#st-save')!;
  const feedback = container.querySelector<HTMLDivElement>('#st-feedback')!;
  const rpc = (window as any).appRpc;

  // Load current settings
  rpc.request.loadSettings().then((result: { settings: { lmstudioHost: string; enhancerModel: string; dataDir: string } }) => {
    hostInput.value = result.settings.lmstudioHost;
    modelInput.value = result.settings.enhancerModel;
    dataDirInput.value = result.settings.dataDir;
  }).catch(() => {
    showFeedback('error', 'Error al cargar configuracion.');
  });

  async function onSave() {
    const lmstudioHost = hostInput.value.trim();
    const enhancerModel = modelInput.value.trim();

    if (!lmstudioHost) {
      showFeedback('error', 'El host de LM Studio no puede estar vacio.');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';

    try {
      const result = await rpc.request.saveSettings({ lmstudioHost, enhancerModel });
      if (result.success) {
        showFeedback('success', 'Configuracion guardada.');
        setTimeout(() => {
          feedback.className = 'form-feedback';
          feedback.textContent = '';
        }, 2000);
      } else {
        showFeedback('error', result.error ?? 'Error al guardar.');
      }
    } catch (e: any) {
      showFeedback('error', e.message ?? 'Error de comunicacion.');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar';
    }
  }

  saveBtn.addEventListener('click', onSave);

  function showFeedback(type: 'success' | 'error', message: string) {
    feedback.textContent = message;
    feedback.className = `form-feedback ${type}`;
  }

  return {
    cleanup() {
      saveBtn.removeEventListener('click', onSave);
    },
  };
}
