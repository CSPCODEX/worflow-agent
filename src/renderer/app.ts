import { Electroview } from 'electrobun/view';
import type { AppRPC } from '../types/ipc';
import type { AgentInfo } from '../types/ipc';
import { renderAgentList } from './components/agent-list';
import { renderCreateAgent } from './views/create-agent';
import { renderChat, type ChatHandle } from './views/chat';

const rpc = Electroview.defineRPC<AppRPC>({
  handlers: {
    requests: {},
    messages: {
      agentMessageChunk: (payload) => {
        const decoded = { ...payload, text: decodeURIComponent(payload.text) };
        document.dispatchEvent(new CustomEvent('agent:chunk', { detail: decoded }));
      },
      agentMessageEnd: (payload) => {
        document.dispatchEvent(new CustomEvent('agent:end', { detail: payload }));
      },
      agentError: (payload) => {
        document.dispatchEvent(new CustomEvent('agent:error', { detail: payload }));
      },
    },
  },
});

// Make rpc accessible to views via window
(window as any).appRpc = rpc;

const electroview = new Electroview({ rpc } as any);

document.addEventListener('DOMContentLoaded', () => {
  const agentListEl = document.getElementById('agent-list')!;
  const mainContentEl = document.getElementById('main-content')!;
  const btnNewAgent = document.getElementById('btn-new-agent')!;

  let activeChatHandle: ChatHandle | null = null;

  function teardownCurrentView() {
    activeChatHandle?.cleanup();
    activeChatHandle = null;
  }

  function showCreate() {
    teardownCurrentView();
    renderCreateAgent(mainContentEl, () => {
      mainContentEl.innerHTML = '<div class="empty-state"><p>Agente creado. Selecciónalo de la lista.</p></div>';
    });
  }

  function showChat(agent: AgentInfo) {
    teardownCurrentView();
    activeChatHandle = renderChat(mainContentEl, agent.name);
  }

  btnNewAgent.addEventListener('click', showCreate);

  // Refresh agent list when an agent is created
  document.addEventListener('agent:created', () => {
    const refresh = (agentListEl as any).__refresh;
    if (typeof refresh === 'function') refresh();
  });

  renderAgentList(agentListEl, showChat);
});
