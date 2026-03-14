import type { AgentInfo } from '../types/ipc';
import { showConfirmDialog } from './confirm-dialog';

type SelectCallback = (agent: AgentInfo) => void;

export function renderAgentList(container: HTMLElement, onSelect: SelectCallback) {
  container.innerHTML = '<div class="agent-list-empty">Cargando...</div>';

  const rpc = (window as any).appRpc;

  async function refresh() {
    try {
      const result = await rpc.request.listAgents();
      if (!result.agents.length) {
        container.innerHTML = '<div class="agent-list-empty">Sin agentes. Crea uno nuevo.</div>';
        return;
      }
      container.innerHTML = '';
      for (const agent of result.agents) {
        const item = document.createElement('div');
        const isBroken = agent.status === 'broken';
        item.className = isBroken ? 'agent-item broken' : 'agent-item';
        item.dataset.agentName = agent.name;
        item.innerHTML = `
          <div class="agent-item-name">${escapeHtml(agent.name)}</div>
          <div class="agent-item-desc">${escapeHtml(agent.description)}</div>
          <div class="agent-item-provider">${escapeHtml(agent.provider ?? 'lmstudio')}</div>
          ${isBroken ? '<div class="agent-item-broken-badge">Sin conexion</div>' : ''}
          <button class="agent-item-delete" title="Eliminar agente" data-agent-id="${agent.id}" data-agent-name="${escapeHtml(agent.name)}">Eliminar</button>
        `;
        item.addEventListener('click', () => {
          if (isBroken) return;
          container.querySelectorAll('.agent-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          onSelect(agent);
        });
        const deleteBtn = item.querySelector<HTMLButtonElement>('.agent-item-delete')!;
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showConfirmDialog({
            title: 'Eliminar agente',
            message: `Eliminar "${agent.name}"? Esta accion no se puede deshacer. Se borraran todos los archivos y conversaciones.`,
            onConfirm: async () => {
              deleteBtn.disabled = true;
              try {
                const result = await rpc.request.deleteAgent({ agentId: agent.id, agentName: agent.name });
                if (result.success) {
                  document.dispatchEvent(new CustomEvent('agent:deleted', { detail: { agentId: agent.id, agentName: agent.name } }));
                } else {
                  deleteBtn.disabled = false;
                  showItemError(item, result.error ?? 'Error al eliminar el agente.');
                }
              } catch (e: any) {
                deleteBtn.disabled = false;
                showItemError(item, e.message ?? 'Error de comunicación.');
              }
            },
          });
        });
        container.appendChild(item);
      }
    } catch {
      container.innerHTML = '<div class="agent-list-empty">Error al cargar agentes.</div>';
    }
  }

  refresh();

  // Expose refresh so app.ts can trigger it after creating an agent
  (container as any).__refresh = refresh;
}

function showItemError(item: HTMLElement, message: string): void {
  const existing = item.querySelector('.agent-item-error');
  if (existing) existing.remove();

  const errorSpan = document.createElement('span');
  errorSpan.className = 'agent-item-error';
  errorSpan.textContent = message;
  item.appendChild(errorSpan);

  setTimeout(() => {
    // Guard against the item being removed from the DOM before the timer fires
    // (e.g. the agent was deleted successfully while the error was still showing).
    if (errorSpan.isConnected) errorSpan.remove();
  }, 3500);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
