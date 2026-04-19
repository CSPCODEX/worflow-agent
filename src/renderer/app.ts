import { Electroview } from 'electrobun/view';
import type { AppRPC, AgentInfo, PipelineSnapshotIPC, GetHistoryParams, GetHistoryResult, GetAgentTrendsResult, GetAgentTimelineParams, GetAgentTimelineResult, GetAgentBehaviorTimelineParams, GetAgentBehaviorTimelineResult, GetComplianceScoresParams, GetComplianceScoresResult, GetRejectionPatternsParams, GetRejectionPatternsResult } from '../types/ipc';
import { renderAgentList } from './components/agent-list';
import { renderCreateAgent } from './views/create-agent';
import { renderChat, type ChatHandle } from './views/chat';
import { renderAgentPreview, type AgentPreviewHandle } from './views/agent-preview';
import { renderSettings } from './views/settings';
import { renderMonitor, type MonitorViewHandle } from './views/monitor';
import { renderPipelineList } from './views/pipeline-list';
import { renderPipelineExecution } from './views/pipeline-execution';
import { renderPipelineResults } from './views/pipeline-results';
import { renderPipelineHistory } from './views/pipeline-history';
import { renderOnboarding } from './views/onboarding';
import { renderPipelineBuilder } from './views/pipeline-builder';
import type { DetectLocalProvidersResult } from '../types/pipeline';

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
  let activePipelineListCleanup: (() => void) | null = null;
  let activePipelineExecutionCleanup: (() => void) | null = null;
  let activeAgentPreviewHandle: AgentPreviewHandle | null = null;
  let activeOnboardingCleanup: (() => void) | null = null;
  let providerPollingInterval: ReturnType<typeof setInterval> | null = null;

  // ── Provider status indicator ──────────────────────────────────────
  const sidebarHeader = document.querySelector('.sidebar-header');
  if (sidebarHeader) {
    const indicator = document.createElement('span');
    indicator.id = 'provider-indicator';
    indicator.className = 'provider-indicator';
    indicator.title = 'Detectando providers...';
    indicator.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#666;display:inline-block;margin-left:8px;cursor:default;';
    sidebarHeader.appendChild(indicator);
  }

  async function updateProviderIndicator() {
    const indicator = document.getElementById('provider-indicator');
    if (!indicator) return;
    try {
      const rpc = (window as any).appRpc;
      const result: DetectLocalProvidersResult = await rpc.request.detectLocalProviders();
      const hasProvider = result.providers.some((p: { available: boolean }) => p.available);
      if (hasProvider) {
        indicator.style.background = '#22c55e';
        indicator.title = 'Provider local disponible';
      } else {
        indicator.style.background = '#ef4444';
        indicator.title = 'Sin provider local — configura en Ajustes';
      }
    } catch {
      const indicator = document.getElementById('provider-indicator');
      if (indicator) {
        indicator.style.background = '#ef4444';
        indicator.title = 'Error detectando providers';
      }
    }
  }

  // Initial detection + 30s polling
  updateProviderIndicator();
  providerPollingInterval = setInterval(updateProviderIndicator, 30_000);

  // ── Onboarding check ────────────────────────────────────────────────
  async function checkOnboarding() {
    const rpc = (window as any).appRpc;
    try {
      const result: { completed: boolean } = await rpc.request.getOnboardingCompleted();
      if (!result.completed) {
        showOnboarding();
        return;
      }
    } catch {
      // If the check fails, proceed to main UI
    }
    renderAgentList(agentListEl, showChat, showEditAgent);
  }

  function showOnboarding() {
    teardownCurrentView();
    const handle = renderOnboarding(mainContentEl, {
      onComplete: () => {
        handle.cleanup();
        activeOnboardingCleanup = null;
        renderAgentList(agentListEl, showChat, showEditAgent);
      },
      onTryExample: () => {
        handle.cleanup();
        activeOnboardingCleanup = null;
        tryExamplePipeline();
      },
    });
    activeOnboardingCleanup = handle.cleanup;
  }

  function teardownCurrentView() {
    activeChatHandle?.cleanup();
    activeChatHandle = null;
    activeAgentName = null;
    activeSettingsHandle?.cleanup();
    activeSettingsHandle = null;
    activeMonitorHandle?.cleanup();
    activeMonitorHandle = null;
    if (activePipelineListCleanup) {
      activePipelineListCleanup();
      activePipelineListCleanup = null;
    }
    if (activePipelineExecutionCleanup) {
      activePipelineExecutionCleanup();
      activePipelineExecutionCleanup = null;
    }
    if (activeAgentPreviewHandle) {
      activeAgentPreviewHandle.cleanup();
      activeAgentPreviewHandle = null;
    }
    if (activeOnboardingCleanup) {
      activeOnboardingCleanup();
      activeOnboardingCleanup = null;
    }
  }

  function showCreate() {
    teardownCurrentView();
    renderCreateAgent(mainContentEl, () => {
      mainContentEl.innerHTML = '<div class="empty-state"><p>Agente creado. Selecciónalo de la lista.</p></div>';
    });
  }

  function showEditAgent(agent: AgentInfo) {
    teardownCurrentView();
    renderCreateAgent(
      mainContentEl,
      () => {
        mainContentEl.innerHTML = '<div class="empty-state"><p>Agente actualizado. Selecciónalo de la lista.</p></div>';
      },
      (agentId: string, agentName: string) => {
        // Test agent callback -> open preview
        teardownCurrentView();
        activeAgentPreviewHandle = renderAgentPreview(mainContentEl, agentId, agentName, () => {
          showEditAgent(agent);
        });
      },
      agent.id
    );
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
      (params: GetComplianceScoresParams): Promise<GetComplianceScoresResult> =>
        (rpc as any).request.getComplianceScores(params),
      (params: GetRejectionPatternsParams): Promise<GetRejectionPatternsResult> =>
        (rpc as any).request.getRejectionPatterns(params),
    );
    rpc.request.getPipelineSnapshot()
      .then((r: { snapshot: PipelineSnapshotIPC }) => {
        activeMonitorHandle?.updateSnapshot(r.snapshot);
      })
      .catch(console.error);
  }

  async function tryExamplePipeline() {
    const rpc = (window as any).appRpc;
    try {
      const result = await rpc.request.listPipelineTemplates();
      const templates = result.templates || [];
      // Find Content Creator builtin template using multiple strategies:
      // 1. Exact match on normalized "content creator"
      // 2. Contains "content" (any position, case-insensitive)
      // 3. Starts with "content"
      const contentCreator = templates.find(
        (t: { name: string; isBuiltin: boolean }) => {
          if (!t.isBuiltin) return false;
          const normalized = t.name.toLowerCase().replace(/\s+/g, ' ').trim();
          return (
            normalized === 'content creator' ||
            normalized.includes('content') ||
            normalized.startsWith('content')
          );
        }
      );
      if (!contentCreator) {
        showPipelineList();
        return;
      }
      // Navigate to pipeline builder with template pre-loaded
      teardownCurrentView();
      renderPipelineBuilder(mainContentEl, {
        mode: 'create',
        templateId: contentCreator.id,
        onSaved: () => showPipelineList(),
        onCancel: () => showPipelineList(),
      });
    } catch (e) {
      console.error('Error loading example pipeline:', e);
    }
  }

  function showPipelineList() {
    teardownCurrentView();
    renderPipelineList(mainContentEl, {
      onTryExample: tryExamplePipeline,
    });
  }

  async function showPipelineExecution(pipelineId: string) {
    teardownCurrentView();
    const rpc = (window as any).appRpc;
    let pipelineInfo: { name: string; variables: Array<{ name: string; label: string; type: string; required: boolean; placeholder?: string }> } | null = null;

    try {
      const result = await rpc.request.getPipeline({ pipelineId });
      if (result.pipeline) {
        let variables: Array<{ name: string; label: string; type: string; required: boolean; placeholder?: string }> = [];

        if (result.pipeline.templateId) {
          const templateResult = await rpc.request.getPipelineTemplate({ templateId: result.pipeline.templateId });
          variables = templateResult.template?.variables ?? [];
        }

        pipelineInfo = {
          name: result.pipeline.name,
          variables,
        };
      }
    } catch (e) {
      console.error('Error loading pipeline:', e);
    }

    if (!pipelineInfo) {
      mainContentEl.innerHTML = '<div class="empty-state"><p>Pipeline no encontrado.</p></div>';
      return;
    }

    const handleComplete = (runId: string) => {
      showPipelineResults(runId);
    };

    const handleCancel = () => {
      showPipelineList();
    };

    const handle = renderPipelineExecution(mainContentEl, {
      pipelineId,
      pipelineName: pipelineInfo.name,
      variables: pipelineInfo.variables,
      onComplete: handleComplete,
      onCancel: handleCancel,
    });
    activePipelineExecutionCleanup = handle.cleanup;
  }

  function showPipelineResults(runId: string) {
    teardownCurrentView();
    renderPipelineResults(mainContentEl, {
      runId,
      isHistory: false,
      onRerun: () => {
        showPipelineList();
      },
      onBack: () => {
        showPipelineList();
      },
    });
  }

  function showPipelineHistory(pipelineId: string, pipelineName: string) {
    teardownCurrentView();
    renderPipelineHistory(mainContentEl, {
      pipelineId,
      pipelineName,
      onSelectRun: (runId: string) => {
        showPipelineResults(runId);
      },
      onBack: () => {
        showPipelineList();
      },
    });
  }

  btnNewAgent.addEventListener('click', showCreate);

  const btnSettings = document.getElementById('btn-settings')!;
  btnSettings.addEventListener('click', showSettings);

  const btnMonitor = document.getElementById('btn-monitor')!;
  btnMonitor.addEventListener('click', showMonitor);

  const btnNewPipeline = document.getElementById('btn-new-pipeline')!;
  btnNewPipeline.addEventListener('click', showPipelineList);

  const pipelineSidebarHeader = document.getElementById('pipeline-sidebar-header')!;
  pipelineSidebarHeader.addEventListener('click', showPipelineList);

  // "Nuevo agente" from agent-list inline button
  document.addEventListener('agent:create-requested', showCreate);

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

  // Refresh agent list when an agent is updated
  document.addEventListener('agent:updated', () => {
    const refresh = (agentListEl as any).__refresh;
    if (typeof refresh === 'function') refresh();
  });

  // Expose pipeline navigation functions to window for use by views
  (window as any).showPipelineExecution = showPipelineExecution;
  (window as any).showPipelineResults = showPipelineResults;
  (window as any).showPipelineHistory = showPipelineHistory;

  // Start onboarding check — will call renderAgentList if already completed
  checkOnboarding();

  // Cleanup on page unload
  window.addEventListener('unload', () => {
    if (providerPollingInterval) {
      clearInterval(providerPollingInterval);
    }
  });
});