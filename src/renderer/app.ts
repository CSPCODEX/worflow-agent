import { Electroview } from 'electrobun/view';
import type { AppRPC, AgentInfo, PipelineSnapshotIPC, GetHistoryParams, GetHistoryResult, GetAgentTrendsResult, GetAgentTimelineParams, GetAgentTimelineResult, GetAgentBehaviorTimelineParams, GetAgentBehaviorTimelineResult } from '../types/ipc';
import { renderAgentList } from './components/agent-list';
import { renderCreateAgent } from './views/create-agent';
import { renderChat, type ChatHandle } from './views/chat';
import { renderSettings } from './views/settings';
import { renderMonitor, type MonitorViewHandle } from './views/monitor';

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
      agentInstallDone: (payload) => {
        document.dispatchEvent(new CustomEvent('agent:install-done', { detail: payload }));
      },
      agentEnhanceDone: (payload) => {
        document.dispatchEvent(new CustomEvent('agent:enhance-done', { detail: payload }));
      },
      pipelineSnapshotUpdated: (payload) => {
        document.dispatchEvent(new CustomEvent('monitor:snapshot', { detail: payload }));
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
  let activeAgentName: string | null = null;
  let activeSettingsHandle: { cleanup(): void } | null = null;
  let activeMonitorHandle: MonitorViewHandle | null = null;

  function teardownCurrentView() {
    activeChatHandle?.cleanup();
    activeChatHandle = null;
    activeAgentName = null;
    activeSettingsHandle?.cleanup();
    activeSettingsHandle = null;
    activeMonitorHandle?.cleanup();
    activeMonitorHandle = null;
  }

  function showCreate() {
    teardownCurrentView();
    renderCreateAgent(mainContentEl, () => {
      mainContentEl.innerHTML = '<div class="empty-state"><p>Agente creado. Selecciónalo de la lista.</p></div>';
    });
  }

  function showChat(agent: AgentInfo) {
    teardownCurrentView();
    activeAgentName = agent.name;
    activeChatHandle = renderChat(mainContentEl, agent.name);
  }

  function showSettings() {
    teardownCurrentView();
    activeSettingsHandle = renderSettings(mainContentEl);
  }

  function showMonitor() {
    teardownCurrentView();
    const emptySnapshot: PipelineSnapshotIPC = {
      features: [],
      bugs: [],
      agentSummaries: [],
      lastUpdatedAt: '',
      parseErrors: [],
    };
    const rpc = (window as any).appRpc;
    activeMonitorHandle = renderMonitor(
      mainContentEl,
      emptySnapshot,
      () => {
        rpc.request.getPipelineSnapshot()
          .then((r: { snapshot: PipelineSnapshotIPC }) => {
            activeMonitorHandle?.updateSnapshot(r.snapshot);
          })
          .catch(console.error);
      },
      (params: GetHistoryParams): Promise<GetHistoryResult> =>
        (rpc as any).request.getHistory(params),
      (): Promise<GetAgentTrendsResult> =>
        (rpc as any).request.getAgentTrends(),
      (params: GetAgentTimelineParams): Promise<GetAgentTimelineResult> =>
        (rpc as any).request.getAgentTimeline(params),
      (params: GetAgentBehaviorTimelineParams): Promise<GetAgentBehaviorTimelineResult> =>
        (rpc as any).request.getAgentBehaviorTimeline(params),
    );
    // Pedir snapshot al arrancar la vista
    rpc.request.getPipelineSnapshot()
      .then((r: { snapshot: PipelineSnapshotIPC }) => {
        activeMonitorHandle?.updateSnapshot(r.snapshot);
      })
      .catch(console.error);
  }

  btnNewAgent.addEventListener('click', showCreate);

  const btnSettings = document.getElementById('btn-settings')!;
  btnSettings.addEventListener('click', showSettings);

  const btnMonitor = document.getElementById('btn-monitor')!;
  btnMonitor.addEventListener('click', showMonitor);

  // Refresh agent list when an agent is created
  document.addEventListener('agent:created', () => {
    const refresh = (agentListEl as any).__refresh;
    if (typeof refresh === 'function') refresh();
  });

  // Refresh agent list and clean up chat when an agent is deleted
  document.addEventListener('agent:deleted', (e) => {
    const { agentName } = (e as CustomEvent).detail as { agentId: string; agentName: string };
    const refresh = (agentListEl as any).__refresh;
    if (typeof refresh === 'function') refresh();
    if (agentName === activeAgentName) {
      teardownCurrentView();
      mainContentEl.innerHTML = '<div class="empty-state"><p>El agente ha sido eliminado.</p></div>';
    }
  });

  renderAgentList(agentListEl, showChat);
});
