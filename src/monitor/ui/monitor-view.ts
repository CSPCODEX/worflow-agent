import type {
  PipelineSnapshotIPC,
  AgentSummaryIPC,
  FeatureRecordIPC,
  BugRecordIPC,
  HandoffStatusIPC,
  GetHistoryParams,
  GetHistoryResult,
  GetAgentTrendsResult,
  HistoryEventIPC,
  AgentTrendIPC,
} from '../../types/ipc';

// NOTA: el import de types/ipc.ts es el UNICO acoplamiento con el host.
// Si el modulo se extrae a un repo separado, se reemplaza por tipos locales equivalentes.

export interface MonitorViewHandle {
  cleanup(): void;
  updateSnapshot(snapshot: PipelineSnapshotIPC): void;
}

// ──────────────────────────────────────────────
// Helpers de render (puros — no tocan el DOM)
// ──────────────────────────────────────────────

function stateBadge(state: string): string {
  return `<span class="monitor-state monitor-state-${state}">${state.replace(/_/g, ' ')}</span>`;
}

function formatTimestamp(iso: string): string {
  if (!iso) return 'sin datos';
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return 'ahora mismo';
    if (diffMin < 60) return `hace ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `hace ${diffH} h`;
    const diffD = Math.floor(diffH / 24);
    return `hace ${diffD} d`;
  } catch {
    return iso;
  }
}

function handoffIcons(handoffs: HandoffStatusIPC[]): string {
  // Pairs: L->C, C->M, M->A, A->Ci
  const labels = ['L', 'C', 'M', 'A', 'Ci'];
  const icons = handoffs.map((h, i) => {
    const label = labels[i] ?? '?';
    const cls = h.hasRework ? 'rework' : h.completed ? 'done' : 'pending';
    const title = `${h.from}->${h.to}: ${h.completed ? 'completo' : 'pendiente'}${h.hasRework ? ' (rework)' : ''}`;
    const arrow = i < handoffs.length - 1 ? '<span class="monitor-handoff-arrow">></span>' : '';
    return `<span class="monitor-handoff-icon ${cls}" title="${title}">${label}</span>${arrow}`;
  });
  return `<div class="monitor-handoffs">${icons.join('')}</div>`;
}

function hasAnyRework(handoffs: HandoffStatusIPC[]): boolean {
  return handoffs.some((h) => h.hasRework);
}

// ──────────────────────────────────────────────
// Render de la tabla de features
// ──────────────────────────────────────────────

function renderFeaturesTable(features: FeatureRecordIPC[], filterState: string): string {
  const filtered = filterState === 'all'
    ? features
    : features.filter((f) => f.state === filterState);

  if (filtered.length === 0) {
    return `<tr><td colspan="6" class="monitor-table-empty">Sin features que mostrar.</td></tr>`;
  }

  return filtered.map((f) => `
    <tr>
      <td title="${escapeHtml(f.slug)}">${escapeHtml(f.title)}</td>
      <td>${stateBadge(f.state)}</td>
      <td><code style="font-size:11px;color:#888">${escapeHtml(f.branch)}</code></td>
      <td style="font-size:11px;color:#777">${escapeHtml(f.openedAt)}</td>
      <td>${handoffIcons(f.handoffs)}</td>
      <td>${hasAnyRework(f.handoffs)
        ? '<span class="monitor-rework-yes">si</span>'
        : '<span class="monitor-rework-no">no</span>'}</td>
    </tr>
  `).join('');
}

// ──────────────────────────────────────────────
// Render de la tabla de bugs
// ──────────────────────────────────────────────

function renderBugsTable(bugs: BugRecordIPC[], filterState: string): string {
  const filtered = filterState === 'all'
    ? bugs
    : bugs.filter((b) => b.state === filterState);

  if (filtered.length === 0) {
    return `<tr><td colspan="4" class="monitor-table-empty">Sin bugs que mostrar.</td></tr>`;
  }

  return filtered.map((b) => `
    <tr>
      <td style="font-size:11px;color:#777">#${escapeHtml(b.id)}</td>
      <td title="${escapeHtml(b.slug)}">${escapeHtml(b.title)}</td>
      <td>${stateBadge(b.state)}</td>
      <td>${b.hasSecurityImplication
        ? '<span class="monitor-security-badge">SI</span>'
        : '<span style="color:#555;font-size:11px">no</span>'}</td>
    </tr>
  `).join('');
}

// ──────────────────────────────────────────────
// Render de cards de agentes
// ──────────────────────────────────────────────

function confidenceLabel(avg: number): string {
  if (avg === 0) return '--';
  if (avg >= 2.7) return 'alta';
  if (avg >= 1.7) return 'media';
  return 'baja';
}

function confidenceClass(avg: number): string {
  if (avg === 0) return '';
  if (avg >= 2.7) return 'confidence-alta';
  if (avg >= 1.7) return 'confidence-media';
  return 'confidence-baja';
}

function trendLabel(trend: AgentTrendIPC['reworkTrend']): string {
  switch (trend) {
    case 'mejorando':   return 'mejorando';
    case 'empeorando':  return 'empeorando';
    case 'estable':     return 'estable';
    case 'sin_datos':   return 'sin datos';
  }
}

function renderAgentCard(s: AgentSummaryIPC, trend?: AgentTrendIPC): string {
  const reworkPct = s.totalFeatures > 0
    ? Math.round(s.reworkRate * 100) + '%'
    : '--';
  const reworkCls = s.reworkRate > 0.3 ? 'rework-high' : '';
  const confLabel = confidenceLabel(s.avgConfidence);
  const confCls = confidenceClass(s.avgConfidence);

  const trendBlock = trend
    ? `
      <div class="monitor-agent-card-row">
        <span class="monitor-agent-card-label">Tendencia rework</span>
        <span class="monitor-agent-card-value monitor-trend-${trend.reworkTrend}">${trendLabel(trend.reworkTrend)}</span>
      </div>`
    : '';

  return `
    <div class="monitor-agent-card" data-agent="${s.agentId}">
      <div class="monitor-agent-card-name">${s.agentId}</div>
      <div class="monitor-agent-card-row">
        <span class="monitor-agent-card-label">Features con datos</span>
        <span class="monitor-agent-card-value">${s.totalFeatures > 0 ? s.totalFeatures : '--'}</span>
      </div>
      <div class="monitor-agent-card-row">
        <span class="monitor-agent-card-label">Rework rate</span>
        <span class="monitor-agent-card-value ${reworkCls}">${reworkPct}</span>
      </div>
      <div class="monitor-agent-card-row">
        <span class="monitor-agent-card-label">Avg iteraciones</span>
        <span class="monitor-agent-card-value">${s.totalFeatures > 0 ? s.avgIterations : '--'}</span>
      </div>
      <div class="monitor-agent-card-row">
        <span class="monitor-agent-card-label">Avg confianza</span>
        <span class="monitor-agent-card-value ${confCls}">${confLabel}</span>
      </div>
      <div class="monitor-agent-card-row">
        <span class="monitor-agent-card-label">Gaps declarados</span>
        <span class="monitor-agent-card-value">${s.totalFeatures > 0 ? s.totalGapsDeclared : '--'}</span>
      </div>
      <div class="monitor-agent-card-row">
        <span class="monitor-agent-card-label">Handoffs completados</span>
        <span class="monitor-agent-card-value">${s.totalFeatures > 0 ? s.completedHandoffs : '--'}</span>
      </div>
      ${trendBlock}
    </div>
  `;
}

// ──────────────────────────────────────────────
// Escape HTML (seguridad — datos del filesystem)
// ──────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────
// Colecta todos los estados unicos para el filtro
// ──────────────────────────────────────────────

function collectFeatureStates(features: FeatureRecordIPC[]): string[] {
  return [...new Set(features.map((f) => f.state))].sort();
}

function collectBugStates(bugs: BugRecordIPC[]): string[] {
  return [...new Set(bugs.map((b) => b.state))].sort();
}

function buildFilterOptions(states: string[], current: string): string {
  const all = `<option value="all"${current === 'all' ? ' selected' : ''}>Todos</option>`;
  return all + states.map((s) =>
    `<option value="${s}"${current === s ? ' selected' : ''}>${s.replace(/_/g, ' ')}</option>`
  ).join('');
}

// ──────────────────────────────────────────────
// Render de la tabla del historial
// ──────────────────────────────────────────────

function eventTypeLabel(t: HistoryEventIPC['eventType']): string {
  switch (t) {
    case 'feature_state_changed': return 'Estado feature';
    case 'bug_state_changed':     return 'Estado bug';
    case 'handoff_completed':     return 'Handoff';
    case 'metrics_updated':       return 'Metricas';
  }
}

function renderHistoryRows(events: HistoryEventIPC[]): string {
  if (events.length === 0) {
    return `<tr><td colspan="7" class="monitor-table-empty">Sin eventos historicos.</td></tr>`;
  }
  return events.map((e) => `
    <tr>
      <td style="font-size:11px;color:#777;white-space:nowrap">${escapeHtml(e.recordedAt.slice(0, 16).replace('T', ' '))}</td>
      <td><span class="monitor-state monitor-state-${escapeHtml(e.itemType)}">${escapeHtml(e.itemType)}</span></td>
      <td title="${escapeHtml(e.itemSlug)}">${escapeHtml(e.itemTitle)}</td>
      <td style="font-size:11px;color:#aaa">${eventTypeLabel(e.eventType)}</td>
      <td style="font-size:11px;color:#777">${e.fromValue !== null ? escapeHtml(e.fromValue) : '<span style="color:#444">-</span>'}</td>
      <td style="font-size:11px;color:#ccc">${escapeHtml(e.toValue)}</td>
      <td style="font-size:11px;color:#888">${e.agentId !== null ? escapeHtml(e.agentId) : '-'}</td>
    </tr>
  `).join('');
}

// ──────────────────────────────────────────────
// Entry point principal
// ──────────────────────────────────────────────

export function renderMonitor(
  container: HTMLElement,
  initialSnapshot: PipelineSnapshotIPC,
  onRefresh: () => void,
  onGetHistory: (params: GetHistoryParams) => Promise<GetHistoryResult>,
  onGetAgentTrends: () => Promise<GetAgentTrendsResult>
): MonitorViewHandle {
  // Estado local de la vista
  let currentSnapshot = initialSnapshot;
  let activeTab: 'pipeline' | 'agents' | 'errors' | 'history' = 'pipeline';
  let featureFilter = 'all';
  let bugFilter = 'all';

  // Estado del historial
  let historyOffset = 0;
  let historyTypeFilter = 'all';
  let historyAgentFilter = 'all';
  let historyTotalCount = 0;
  const HISTORY_PAGE_SIZE = 100;

  // Mapa de tendencias: agentId -> AgentTrendIPC
  let trendsMap = new Map<string, AgentTrendIPC>();

  // ── Render inicial del esqueleto HTML ──
  container.innerHTML = `
    <div class="monitor-view">
      <div class="monitor-header">
        <span class="monitor-header-title">Monitor de Pipeline</span>
        <div class="monitor-header-meta">
          <span class="monitor-timestamp" id="mon-timestamp">Cargando...</span>
          <button class="monitor-btn-refresh" id="mon-btn-refresh">Actualizar</button>
        </div>
      </div>

      <div class="monitor-tabs">
        <button class="monitor-tab active" data-tab="pipeline" id="mon-tab-pipeline">Pipeline</button>
        <button class="monitor-tab" data-tab="agents" id="mon-tab-agents">Agentes</button>
        <button class="monitor-tab" data-tab="errors" id="mon-tab-errors">Errores</button>
        <button class="monitor-tab" data-tab="history" id="mon-tab-history">Historial</button>
      </div>

      <!-- Panel: Pipeline -->
      <div class="monitor-panel active" id="mon-panel-pipeline">
        <p class="monitor-section-title">Features</p>
        <div class="monitor-filter-row">
          <label for="mon-feature-filter">Estado:</label>
          <select id="mon-feature-filter" class="monitor-filter-select">
            <option value="all">Todos</option>
          </select>
        </div>
        <table class="monitor-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Estado</th>
              <th>Rama</th>
              <th>Abierta</th>
              <th>Handoffs</th>
              <th>Rework</th>
            </tr>
          </thead>
          <tbody id="mon-features-body">
            <tr><td colspan="6" class="monitor-table-empty">Cargando...</td></tr>
          </tbody>
        </table>

        <p class="monitor-section-title">Bugs</p>
        <div class="monitor-filter-row">
          <label for="mon-bug-filter">Estado:</label>
          <select id="mon-bug-filter" class="monitor-filter-select">
            <option value="all">Todos</option>
          </select>
        </div>
        <table class="monitor-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nombre</th>
              <th>Estado</th>
              <th>Seguridad</th>
            </tr>
          </thead>
          <tbody id="mon-bugs-body">
            <tr><td colspan="4" class="monitor-table-empty">Cargando...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Panel: Agentes -->
      <div class="monitor-panel" id="mon-panel-agents">
        <div class="monitor-agents-grid" id="mon-agents-grid">
          <p class="monitor-empty-state">Cargando datos de agentes...</p>
        </div>
      </div>

      <!-- Panel: Errores -->
      <div class="monitor-panel" id="mon-panel-errors">
        <div class="monitor-errors-list" id="mon-errors-list">
          <p class="monitor-empty-state">Cargando...</p>
        </div>
      </div>

      <!-- Panel: Historial -->
      <div class="monitor-panel" id="mon-panel-history">
        <div class="monitor-filter-row">
          <label for="mon-history-type-filter">Tipo:</label>
          <select id="mon-history-type-filter" class="monitor-filter-select">
            <option value="all">Todos</option>
            <option value="feature">Features</option>
            <option value="bug">Bugs</option>
          </select>
          <label for="mon-history-agent-filter">Agente:</label>
          <select id="mon-history-agent-filter" class="monitor-filter-select">
            <option value="all">Todos</option>
            <option value="leo">leo</option>
            <option value="cloe">cloe</option>
            <option value="max">max</option>
            <option value="ada">ada</option>
            <option value="cipher">cipher</option>
          </select>
        </div>
        <table class="monitor-table">
          <thead>
            <tr>
              <th>Cuando</th>
              <th>Tipo</th>
              <th>Item</th>
              <th>Evento</th>
              <th>Antes</th>
              <th>Despues</th>
              <th>Agente</th>
            </tr>
          </thead>
          <tbody id="mon-history-body">
            <tr><td colspan="7" class="monitor-table-empty">Selecciona el tab para cargar.</td></tr>
          </tbody>
        </table>
        <div class="monitor-history-pagination" id="mon-history-pagination"></div>
      </div>
    </div>
  `;

  // ── Refs a elementos del DOM ──
  const timestampEl = container.querySelector<HTMLElement>('#mon-timestamp')!;
  const refreshBtn = container.querySelector<HTMLButtonElement>('#mon-btn-refresh')!;
  const tabButtons = container.querySelectorAll<HTMLButtonElement>('.monitor-tab');
  const featureFilter_El = container.querySelector<HTMLSelectElement>('#mon-feature-filter')!;
  const bugFilter_El = container.querySelector<HTMLSelectElement>('#mon-bug-filter')!;
  const featuresBodyEl = container.querySelector<HTMLElement>('#mon-features-body')!;
  const bugsBodyEl = container.querySelector<HTMLElement>('#mon-bugs-body')!;
  const agentsGridEl = container.querySelector<HTMLElement>('#mon-agents-grid')!;
  const errorsListEl = container.querySelector<HTMLElement>('#mon-errors-list')!;
  const historyBodyEl = container.querySelector<HTMLElement>('#mon-history-body')!;
  const historyPaginationEl = container.querySelector<HTMLElement>('#mon-history-pagination')!;
  const historyTypeFilterEl = container.querySelector<HTMLSelectElement>('#mon-history-type-filter')!;
  const historyAgentFilterEl = container.querySelector<HTMLSelectElement>('#mon-history-agent-filter')!;

  // ── Activar/desactivar tabs ──
  function activateTab(tab: 'pipeline' | 'agents' | 'errors' | 'history') {
    activeTab = tab;
    tabButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset['tab'] === tab);
    });
    const panels = container.querySelectorAll<HTMLElement>('.monitor-panel');
    panels.forEach((p) => p.classList.remove('active'));
    const active = container.querySelector<HTMLElement>(`#mon-panel-${tab}`);
    if (active) active.classList.add('active');

    // Al activar Historial: cargar datos si aun no se han cargado
    if (tab === 'history') {
      loadHistory(0);
    }
    // Al activar Agentes: cargar trends
    if (tab === 'agents') {
      loadAgentTrends();
    }
  }

  // ── Cargar historial (on-demand) ──
  function loadHistory(newOffset: number) {
    historyOffset = newOffset;
    historyBodyEl.innerHTML = `<tr><td colspan="7" class="monitor-table-empty">Cargando...</td></tr>`;
    historyPaginationEl.innerHTML = '';

    const params: GetHistoryParams = {
      limit: HISTORY_PAGE_SIZE,
      offset: historyOffset,
    };
    if (historyTypeFilter !== 'all') {
      params.itemType = historyTypeFilter as 'feature' | 'bug';
    }
    if (historyAgentFilter !== 'all') {
      params.agentId = historyAgentFilter;
    }

    onGetHistory(params)
      .then((result) => {
        historyTotalCount = result.totalCount;
        historyBodyEl.innerHTML = renderHistoryRows(result.events);
        renderHistoryPagination();
      })
      .catch((err) => {
        console.error('[monitor-view] loadHistory error:', err);
        historyBodyEl.innerHTML = `<tr><td colspan="7" class="monitor-table-empty">Error al cargar historial.</td></tr>`;
      });
  }

  function renderHistoryPagination() {
    const hasMore = historyOffset + HISTORY_PAGE_SIZE < historyTotalCount;
    const hasPrev = historyOffset > 0;
    if (!hasMore && !hasPrev) {
      historyPaginationEl.innerHTML = `<span class="monitor-history-count">${historyTotalCount} evento${historyTotalCount !== 1 ? 's' : ''}</span>`;
      return;
    }
    const prevBtn = hasPrev
      ? `<button class="monitor-btn-page" id="mon-hist-prev">Anterior</button>`
      : '';
    const nextBtn = hasMore
      ? `<button class="monitor-btn-page" id="mon-hist-next">Siguiente</button>`
      : '';
    historyPaginationEl.innerHTML = `
      <span class="monitor-history-count">${historyTotalCount} evento${historyTotalCount !== 1 ? 's' : ''} — pagina ${Math.floor(historyOffset / HISTORY_PAGE_SIZE) + 1}</span>
      ${prevBtn}${nextBtn}
    `;
    historyPaginationEl.querySelector<HTMLButtonElement>('#mon-hist-prev')
      ?.addEventListener('click', () => loadHistory(historyOffset - HISTORY_PAGE_SIZE));
    historyPaginationEl.querySelector<HTMLButtonElement>('#mon-hist-next')
      ?.addEventListener('click', () => loadHistory(historyOffset + HISTORY_PAGE_SIZE));
  }

  // ── Cargar tendencias de agentes (on-demand) ──
  function loadAgentTrends() {
    onGetAgentTrends()
      .then((result) => {
        trendsMap = new Map(result.trends.map((t) => [t.agentId, t]));
        // Re-renderizar cards de agentes con los trends cargados
        if (currentSnapshot.agentSummaries.length > 0) {
          agentsGridEl.innerHTML = currentSnapshot.agentSummaries
            .map((s) => renderAgentCard(s, trendsMap.get(s.agentId)))
            .join('');
        }
      })
      .catch((err) => {
        console.error('[monitor-view] loadAgentTrends error:', err);
      });
  }

  // ── Actualizar solo las partes del DOM que cambian (INCREMENTAL) ──
  function updateSnapshot(snapshot: PipelineSnapshotIPC) {
    currentSnapshot = snapshot;

    // Timestamp
    timestampEl.textContent = snapshot.lastUpdatedAt
      ? `Actualizado: ${formatTimestamp(snapshot.lastUpdatedAt)}`
      : 'Sin datos';

    // Rebuild filter options (preserving current selection)
    const fStates = collectFeatureStates(snapshot.features);
    featureFilter_El.innerHTML = buildFilterOptions(fStates, featureFilter);
    const bStates = collectBugStates(snapshot.bugs);
    bugFilter_El.innerHTML = buildFilterOptions(bStates, bugFilter);

    // Tabla features
    featuresBodyEl.innerHTML = renderFeaturesTable(snapshot.features, featureFilter);

    // Tabla bugs
    bugsBodyEl.innerHTML = renderBugsTable(snapshot.bugs, bugFilter);

    // Cards de agentes
    if (snapshot.agentSummaries.length === 0) {
      agentsGridEl.innerHTML = '<p class="monitor-empty-state">Sin datos de agentes disponibles.</p>';
    } else {
      agentsGridEl.innerHTML = snapshot.agentSummaries
        .map((s) => renderAgentCard(s, trendsMap.get(s.agentId)))
        .join('');
    }

    // Lista de errores
    if (snapshot.parseErrors.length === 0) {
      errorsListEl.innerHTML = '<p class="monitor-no-errors">Sin errores de parseo.</p>';
    } else {
      errorsListEl.innerHTML = `<div class="monitor-errors-list">` +
        snapshot.parseErrors.map((e) =>
          `<div class="monitor-error-item">${escapeHtml(e)}</div>`
        ).join('') +
        `</div>`;
    }
  }

  // ── Event listeners ──

  refreshBtn.addEventListener('click', onRefresh);

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset['tab'] as 'pipeline' | 'agents' | 'errors' | 'history';
      if (tab) activateTab(tab);
    });
  });

  featureFilter_El.addEventListener('change', () => {
    featureFilter = featureFilter_El.value;
    featuresBodyEl.innerHTML = renderFeaturesTable(currentSnapshot.features, featureFilter);
  });

  bugFilter_El.addEventListener('change', () => {
    bugFilter = bugFilter_El.value;
    bugsBodyEl.innerHTML = renderBugsTable(currentSnapshot.bugs, bugFilter);
  });

  // Listeners del historial
  function onHistoryTypeChange() {
    historyTypeFilter = historyTypeFilterEl.value;
    loadHistory(0);
  }
  function onHistoryAgentChange() {
    historyAgentFilter = historyAgentFilterEl.value;
    loadHistory(0);
  }
  historyTypeFilterEl.addEventListener('change', onHistoryTypeChange);
  historyAgentFilterEl.addEventListener('change', onHistoryAgentChange);

  // Listener del evento push del poller (registrado aqui, limpiado en cleanup)
  function onMonitorSnapshot(e: Event) {
    const snapshot = (e as CustomEvent<PipelineSnapshotIPC>).detail;
    updateSnapshot(snapshot);
  }
  document.addEventListener('monitor:snapshot', onMonitorSnapshot);

  // Render inicial
  if (initialSnapshot.lastUpdatedAt || initialSnapshot.features.length > 0) {
    updateSnapshot(initialSnapshot);
  }

  return {
    cleanup() {
      document.removeEventListener('monitor:snapshot', onMonitorSnapshot);
      refreshBtn.removeEventListener('click', onRefresh);
      historyTypeFilterEl.removeEventListener('change', onHistoryTypeChange);
      historyAgentFilterEl.removeEventListener('change', onHistoryAgentChange);
    },
    updateSnapshot,
  };
}
