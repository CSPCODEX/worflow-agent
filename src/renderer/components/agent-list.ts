import type { AgentInfo } from '../../types/ipc';
import { showConfirmDialog } from './confirm-dialog';

type SelectCallback = (agent: AgentInfo) => void;
type EditCallback = (agent: AgentInfo) => void;

export function renderAgentList(container: HTMLElement, onSelect: SelectCallback, onEdit: EditCallback) {
  container.innerHTML = `
    <div class="agents-section-header">
      <span class="agents-section-title">Agentes</span>
      <button id="btn-new-agent-inline" class="btn-new-agent-inline" title="Nuevo agente">+</button>
    </div>
    <div class="agent-list-items" id="agent-list-items"><div class="agent-list-empty">Cargando...</div></div>
  `;

  const listItems = container.querySelector<HTMLElement>('#agent-list-items')!;
  const btnNewInline = container.querySelector<HTMLButtonElement>('#btn-new-agent-inline')!;
  const rpc = (window as any).appRpc;

  // "Nuevo agente" button inside the agent section
  btnNewInline.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('agent:create-requested'));
  });

  async function refresh() {
    try {
      const result = await rpc.request.listAgents();
      if (!result.agents.length) {
        listItems.innerHTML = '<div class="agent-list-empty">Sin agentes. Crea uno nuevo.</div>';
        return;
      }
      listItems.innerHTML = '';
      for (const agent of result.agents) {
        const item = document.createElement('div');
        const isBroken = agent.status === 'broken';
        item.className = isBroken ? 'agent-item broken' : 'agent-item';
        item.dataset.agentName = agent.name;
        item.innerHTML = `
          <div class="agent-item-name">${escapeHtml(agent.name)}</div>
          <div class="agent-item-desc">${escapeHtml(agent.description || '')}</div>
          ${agent.isDefault ? '<span class="agent-default-badge">Por defecto</span>' : ''}
          ${isBroken ? '<div class="agent-item-broken-badge">Sin conexion</div>' : ''}
          ${!agent.isDefault && !isBroken ? `<button class="agent-item-delete" title="Eliminar agente" data-agent-id="${agent.id}" data-agent-name="${escapeHtml(agent.name)}">Eliminar</button>` : ''}
        `;
        item.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).classList.contains('agent-item-delete')) return;
          if (isBroken) return;
          listItems.querySelectorAll('.agent-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          onEdit(agent);
        });
        const deleteBtn = item.querySelector<HTMLButtonElement>('.agent-item-delete');
        if (deleteBtn) {
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
                  showItemError(item, e.message ?? 'Error de comunicacion.');
                }
              },
            });
          });
        }
        listItems.appendChild(item);
      }
    } catch {
      listItems.innerHTML = '<div class="agent-list-empty">Error al cargar agentes.</div>';
    }
  }

  refresh();

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
    if (errorSpan.isConnected) errorSpan.remove();
  }, 3500);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}