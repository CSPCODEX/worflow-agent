import type { DetectLocalProvidersResult } from '../../types/pipeline';
import { escapeHtml } from '../utils/html';

export interface OnboardingCallbacks {
  onComplete: () => void;
  onTryExample: () => void;
}

export function renderOnboarding(
  container: HTMLElement,
  callbacks: OnboardingCallbacks
): { cleanup(): void } {
  const rpc = (window as any).appRpc;
  let currentStep = 1;
  let providersDetected: DetectLocalProvidersResult['providers'] = [];

  function render() {
    container.innerHTML = getStepHtml(currentStep);
    attachEvents();
  }

  function getStepHtml(step: number): string {
    switch (step) {
      case 1:
        return `
          <div class="onboarding-view">
            <div class="onboarding-card">
              <div class="onboarding-logo">
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                  <circle cx="32" cy="32" r="30" stroke="#6366f1" stroke-width="4"/>
                  <path d="M20 32 L28 40 L44 24" stroke="#6366f1" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <h1 class="onboarding-title">Bienvenido a FlowTeam</h1>
              <p class="onboarding-desc">Orquesta multiples agentes de IA en pipelines secuenciales. Define equipos especializados, conectalos entre si, y ejecuta tareas complejas sin escribir codigo.</p>
              <p class="onboarding-desc onboarding-desc-secondary">Todo funciona localmente con tu propia GPU. No se necesitan API keys.</p>
              <div class="onboarding-actions">
                <button id="ob-next-1" class="btn-primary">Comenzar</button>
              </div>
              <div class="onboarding-step-dots">
                <span class="dot active"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
            </div>
          </div>
        `;

      case 2:
        return `
          <div class="onboarding-view">
            <div class="onboarding-card">
              <h1 class="onboarding-title">Configura tu modelo</h1>
              <p class="onboarding-desc">FlowTeam necesita un modelo de IA local para funcionar. Estamos detectando LM Studio y Ollama...</p>
              <div id="ob-providers-loading" class="onboarding-providers-loading">
                <div class="spinner"></div>
                <span>Buscando providers...</span>
              </div>
              <div id="ob-providers-result" class="onboarding-providers-result" style="display:none"></div>
              <div id="ob-no-providers" class="onboarding-no-providers" style="display:none">
                <div class="onboarding-warning">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="#f59e0b" stroke-width="2"/>
                    <path d="M12 8v4M12 16h.01" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                  <span>No se detectaron providers locales</span>
                </div>
                <p class="onboarding-desc">Instala LM Studio u Ollama para usar modelos locales, o configura un proveedor cloud en Ajustes.</p>
                <div class="onboarding-provider-links">
                  <a href="#" id="ob-dl-lmstudio" class="onboarding-dl-link">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    Descargar LM Studio
                  </a>
                  <a href="#" id="ob-dl-ollama" class="onboarding-dl-link">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    Descargar Ollama
                  </a>
                </div>
                <button id="ob-skip-providers" class="btn-secondary">Usar proveedor cloud</button>
              </div>
              <div class="onboarding-actions">
                <button id="ob-back-2" class="btn-secondary">Atras</button>
                <button id="ob-next-2" class="btn-primary" disabled>Continuar</button>
              </div>
              <div class="onboarding-step-dots">
                <span class="dot"></span>
                <span class="dot active"></span>
                <span class="dot"></span>
              </div>
            </div>
          </div>
        `;

      case 3:
        const hasProvider = providersDetected.some((p) => p.available);
        const providerLabels = providersDetected
          .filter((p) => p.available)
          .map((p) => p.label)
          .join(' / ');
        return `
          <div class="onboarding-view">
            <div class="onboarding-card">
              <div class="onboarding-success-icon">
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                  <circle cx="32" cy="32" r="30" stroke="#22c55e" stroke-width="4"/>
                  <path d="M20 32 L28 40 L44 24" stroke="#22c55e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <h1 class="onboarding-title">Todo listo</h1>
              ${hasProvider
                ? `<p class="onboarding-desc">Hemos detectado ${escapeHtml(providerLabels)} funcionando. Puedes empezar a ejecutar pipelines.</p>`
                : `<p class="onboarding-desc">Configura tu proveedor en Ajustes cuando lo necesites.</p>`
              }
              <div class="onboarding-actions onboarding-actions-col">
                <button id="ob-start-pipeline" class="btn-primary btn-large">Ejecutar tu primer pipeline</button>
                <button id="ob-try-example" class="btn-secondary">Probar con un ejemplo</button>
              </div>
              <div class="onboarding-skip-link">
                <button id="ob-skip-onboarding" class="btn-link">Omitir y ir a la app</button>
              </div>
              <div class="onboarding-step-dots">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot active"></span>
              </div>
            </div>
          </div>
        `;

      default:
        return '';
    }
  }

  function attachEvents() {
    switch (currentStep) {
      case 1: {
        const nextBtn = container.querySelector<HTMLButtonElement>('#ob-next-1');
        nextBtn?.addEventListener('click', () => {
          currentStep = 2;
          render();
          detectProviders();
        });
        break;
      }
      case 2: {
        const backBtn = container.querySelector<HTMLButtonElement>('#ob-back-2');
        const nextBtn = container.querySelector<HTMLButtonElement>('#ob-next-2');
        const skipBtn = container.querySelector<HTMLButtonElement>('#ob-skip-providers');
        const dlLmstudio = container.querySelector<HTMLAnchorElement>('#ob-dl-lmstudio');
        const dlOllama = container.querySelector<HTMLAnchorElement>('#ob-dl-ollama');

        backBtn?.addEventListener('click', () => {
          currentStep = 1;
          render();
        });

        nextBtn?.addEventListener('click', () => {
          currentStep = 3;
          render();
        });

        skipBtn?.addEventListener('click', () => {
          currentStep = 3;
          render();
        });

        dlLmstudio?.addEventListener('click', (e) => {
          e.preventDefault();
          rpc.request.openExternal({ url: 'https://lmstudio.ai' });
        });

        dlOllama?.addEventListener('click', (e) => {
          e.preventDefault();
          rpc.request.openExternal({ url: 'https://ollama.com' });
        });
        break;
      }
      case 3: {
        const startBtn = container.querySelector<HTMLButtonElement>('#ob-start-pipeline');
        const tryBtn = container.querySelector<HTMLButtonElement>('#ob-try-example');
        const skipBtn = container.querySelector<HTMLButtonElement>('#ob-skip-onboarding');

        startBtn?.addEventListener('click', async () => {
          await rpc.request.setOnboardingCompleted({ completed: true });
          callbacks.onComplete();
        });

        tryBtn?.addEventListener('click', async () => {
          await rpc.request.setOnboardingCompleted({ completed: true });
          callbacks.onTryExample();
        });

        skipBtn?.addEventListener('click', async () => {
          await rpc.request.setOnboardingCompleted({ completed: true });
          callbacks.onComplete();
        });
        break;
      }
    }
  }

  async function detectProviders() {
    const loadingEl = container.querySelector<HTMLDivElement>('#ob-providers-loading');
    const resultEl = container.querySelector<HTMLDivElement>('#ob-providers-result');
    const noProvidersEl = container.querySelector<HTMLDivElement>('#ob-no-providers');
    const nextBtn = container.querySelector<HTMLButtonElement>('#ob-next-2');

    try {
      const result: DetectLocalProvidersResult = await rpc.request.detectLocalProviders();
      providersDetected = result.providers;

      if (loadingEl) loadingEl.style.display = 'none';

      const available = result.providers.filter((p) => p.available);

      if (available.length > 0) {
        if (resultEl) {
          resultEl.innerHTML = `
            <div class="onboarding-provider-item onboarding-provider-available">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#22c55e" stroke-width="2"/>
                <path d="M8 12l3 3 5-5" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>${available.map((p) => escapeHtml(p.label)).join(' / ')} disponible${available.length > 1 ? 's' : ''}</span>
            </div>
          `;
          resultEl.style.display = 'block';
        }
        if (nextBtn) nextBtn.disabled = false;
      } else {
        if (noProvidersEl) noProvidersEl.style.display = 'block';
        if (nextBtn) nextBtn.disabled = false;
      }
    } catch (e) {
      if (loadingEl) loadingEl.style.display = 'none';
      if (noProvidersEl) noProvidersEl.style.display = 'block';
      if (nextBtn) nextBtn.disabled = false;
    }
  }

  render();

  return {
    cleanup() {},
  };
}
