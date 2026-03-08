import type { AgentInfo } from '../types/ipc';

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
        item.className = 'agent-item';
        item.dataset.agentName = agent.name;
        item.innerHTML = `
          <div class="agent-item-name">${escapeHtml(agent.name)}</div>
          <div class="agent-item-desc">${escapeHtml(agent.description)}</div>
        `;
        item.addEventListener('click', () => {
          container.querySelectorAll('.agent-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          onSelect(agent);
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

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
