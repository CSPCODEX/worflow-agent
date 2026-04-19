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
  GetAgentTimelineParams,
  GetAgentTimelineResult,
  AgentTimelinePoint,
  AgentBehaviorPointIPC,
  GetAgentBehaviorTimelineParams,
  GetAgentBehaviorTimelineResult,
  ComplianceScoreIPC,
  RejectionRecordIPC,
  RejectionPatternAggregate,
  GetComplianceScoresResult,
  GetRejectionPatternsResult,
  GetComplianceScoresParams,
  GetRejectionPatternsParams,
} from '../../../types/ipc';

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
  // Pairs: L->C, C->M, M->A, A->Ci  (4 pairs, 5 agents)
  const labels = ['L', 'C', 'M', 'A', 'Ci'];
  const arrow = '<span class="monitor-handoff-arrow">></span>';

  if (handoffs.length === 0) {
    // Edge case: no handoff data — render only Ci with pending state
    return `<div class="monitor-handoffs"><span class="monitor-handoff-icon pending" title="Ci: destino final del pipeline">Ci</span></div>`;
  }

  const icons = handoffs.map((h, i) => {
    const label = labels[i] ?? '?';
    const cls = h.hasRework ? 'rework' : h.completed ? 'done' : 'pending';
    const title = `${h.from}->${h.to}: ${h.completed ? 'completo' : 'pendiente'}${h.hasRework ? ' (rework)' : ''}`;
    // Arrow always present — Ci node always follows
    return `<span class="monitor-handoff-icon ${cls}" title="${title}">${label}</span>${arrow}`;
  });

  // Fifth node: Cipher — destination agent, not origin of any handoff
  const last = handoffs[handoffs.length - 1];
  const lastCls = last ? (last.hasRework ? 'rework' : last.completed ? 'done' : 'pending') : 'pending';
  icons.push(`<span class="monitor-handoff-icon ${lastCls}" title="Ci: destino final del pipeline">Ci</span>`);

  return `<div class="monitor-handoffs">${icons.join('')}</div>`;
}

function hasAnyRework(handoffs: HandoffStatusIPC[]): boolean {
  return handoffs.some((h) => h.hasRework);
}

// ──────────────────────────────────────────────
// Render de la tabla de features
// ──────────────────────────────────────────────

function renderFeaturesTable(features: FeatureRecordIPC[], filterState: string): string {
  const sorted = [...features].sort((a, b) =>
    new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()
  );
  const filtered = filterState === 'all'
    ? sorted
    : sorted.filter((f) => f.state === filterState);

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
// Graficas SVG de evolucion por agente
// ──────────────────────────────────────────────

type ChartMetric = 'rework' | 'iteraciones' | 'confianza';

function extractValues(points: AgentTimelinePoint[], metric: ChartMetric): (number | null)[] {
  return points.map((p) => {
    if (metric === 'rework') return p.rework;
    if (metric === 'iteraciones') return p.iteraciones;
    return p.confianza;
  });
}

function renderLineChart(
  points: AgentTimelinePoint[],
  metric: ChartMetric,
  color: string,
): string {
  const TITLE: Record<ChartMetric, string> = {
    rework: 'Rework',
    iteraciones: 'Iteraciones',
    confianza: 'Confianza',
  };
  const MAX_Y: Record<ChartMetric, number> = {
    rework: 1,
    iteraciones: 0, // calculado dinamicamente
    confianza: 3,
  };

  const values = extractValues(points, metric);
  const validValues = values.filter((v): v is number => v !== null);

  // Area SVG: viewBox 0 0 280 110
  // Area de dibujo: x 30..260 (230px), y 15..80 (65px)
  // Etiquetas eje X: y 95
  const SVG_W = 280;
  const SVG_H = 110;
  const DRAW_X0 = 30;
  const DRAW_X1 = 260;
  const DRAW_Y0 = 15; // arriba
  const DRAW_Y1 = 80; // abajo
  const DRAW_W = DRAW_X1 - DRAW_X0; // 230
  const DRAW_H = DRAW_Y1 - DRAW_Y0; // 65

  if (validValues.length === 0) {
    return `<svg viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}" height="${SVG_H}" class="monitor-chart-svg">
      <text x="${SVG_W / 2}" y="${SVG_H / 2}" text-anchor="middle" font-size="10" fill="#555">Sin datos</text>
      <text x="${SVG_W / 2}" y="8" text-anchor="middle" font-size="9" fill="#666">${TITLE[metric]}</text>
    </svg>`;
  }

  // Calcular maxY
  let maxY = MAX_Y[metric];
  if (metric === 'iteraciones') {
    maxY = Math.max(5, ...validValues);
  }
  if (maxY === 0) maxY = 1; // evitar division por cero

  const n = points.length;
  const step = n > 1 ? DRAW_W / (n - 1) : 0;

  // Calcular coordenadas SVG para cada punto (null -> null)
  const coords: ({ cx: number; cy: number } | null)[] = values.map((v, i) => {
    if (v === null) return null;
    const cx = n > 1 ? DRAW_X0 + i * step : DRAW_X0 + DRAW_W / 2;
    const cy = DRAW_Y1 - (v / maxY) * DRAW_H;
    return { cx: Math.round(cx), cy: Math.round(cy) };
  });

  // Construir segmentos de polyline — solo entre puntos consecutivos no-null
  const polylineSegments: string[] = [];
  let currentSegment: string[] = [];
  for (const c of coords) {
    if (c !== null) {
      currentSegment.push(`${c.cx},${c.cy}`);
    } else {
      if (currentSegment.length > 1) {
        polylineSegments.push(currentSegment.join(' '));
      }
      currentSegment = [];
    }
  }
  if (currentSegment.length > 1) polylineSegments.push(currentSegment.join(' '));

  const polylinesHtml = polylineSegments
    .map((pts) => `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>`)
    .join('');

  // Puntos (circulos) para cada coordenada no-null
  const circlesHtml = coords
    .filter((c): c is { cx: number; cy: number } => c !== null)
    .map((c) => `<circle cx="${c.cx}" cy="${c.cy}" r="3" fill="${color}"/>`)
    .join('');

  // Etiquetas eje X (slug truncado a 8 chars)
  const labelsHtml = points
    .map((p, i) => {
      const x = n > 1 ? DRAW_X0 + i * step : DRAW_X0 + DRAW_W / 2;
      const label = p.itemSlug.length > 8 ? p.itemSlug.slice(0, 8) + '.' : p.itemSlug;
      return `<text x="${Math.round(x)}" y="95" text-anchor="middle" font-size="7" fill="#555">${escapeHtml(label)}</text>`;
    })
    .join('');

  // Etiquetas eje Y
  const yMaxLabel = metric === 'rework' ? '1' : metric === 'confianza' ? 'alta' : String(maxY);
  const yMinLabel = '0';

  return `<svg viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}" height="${SVG_H}" class="monitor-chart-svg">
    <text x="${SVG_W / 2}" y="8" text-anchor="middle" font-size="9" fill="#666">${TITLE[metric]}</text>
    <line x1="${DRAW_X0}" y1="${DRAW_Y0}" x2="${DRAW_X0}" y2="${DRAW_Y1}" stroke="#2a2a2a" stroke-width="1"/>
    <line x1="${DRAW_X0}" y1="${DRAW_Y1}" x2="${DRAW_X1}" y2="${DRAW_Y1}" stroke="#2a2a2a" stroke-width="1"/>
    <text x="${DRAW_X0 - 3}" y="${DRAW_Y0 + 4}" text-anchor="end" font-size="7" fill="#555">${yMaxLabel}</text>
    <text x="${DRAW_X0 - 3}" y="${DRAW_Y1}" text-anchor="end" font-size="7" fill="#555">${yMinLabel}</text>
    ${polylinesHtml}
    ${circlesHtml}
    ${labelsHtml}
  </svg>`;
}

function renderCombinedChart(points: AgentTimelinePoint[]): string {
  if (points.length === 0) {
    return `<p class="monitor-chart-empty">Sin datos historicos para este agente.</p>`;
  }

  const VB_W = 900, VB_H = 175;
  const X0 = 55, X1 = 870, Y0 = 18, Y1 = 98;
  const DW = X1 - X0;
  const DH = Y1 - Y0;
  const n = points.length;
  const step = n > 1 ? DW / (n - 1) : 0;
  // Mostrar etiqueta cada N puntos segun densidad
  const labelEvery = n > 20 ? 3 : n > 10 ? 2 : 1;

  const iterVals = points.map(p => p.iteraciones).filter((v): v is number => v !== null);
  const maxIter = Math.max(5, ...iterVals);

  const COLORS: Record<ChartMetric, string> = {
    rework:      '#e57373',
    iteraciones: '#4a9eff',
    confianza:   '#66bb6a',
  };

  function toNorm(metric: ChartMetric, v: number | null): number | null {
    if (v === null) return null;
    if (metric === 'rework')      return v;
    if (metric === 'iteraciones') return v / maxIter;
    return (v - 1) / 2;
  }

  function buildPolyline(metric: ChartMetric): string {
    const coords: ({ cx: number; cy: number } | null)[] = points.map((p, i) => {
      const raw = metric === 'rework' ? p.rework : metric === 'iteraciones' ? p.iteraciones : p.confianza;
      const norm = toNorm(metric, raw);
      if (norm === null) return null;
      return {
        cx: Math.round(n > 1 ? X0 + i * step : X0 + DW / 2),
        cy: Math.round(Y1 - norm * DH),
      };
    });

    const segs: string[] = [];
    let seg: string[] = [];
    for (const c of coords) {
      if (c) { seg.push(`${c.cx},${c.cy}`); }
      else   { if (seg.length > 1) segs.push(seg.join(' ')); seg = []; }
    }
    if (seg.length > 1) segs.push(seg.join(' '));

    const color = COLORS[metric];
    return segs.map(pts =>
      `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" opacity="0.9"/>`
    ).join('') + coords.filter((c): c is {cx:number;cy:number} => c !== null)
      .map(c => `<circle cx="${c.cx}" cy="${c.cy}" r="3" fill="${color}"/>`)
      .join('');
  }

  const gridLines = [0.25, 0.5, 0.75].map(v =>
    `<line x1="${X0}" y1="${Math.round(Y1 - v * DH)}" x2="${X1}" y2="${Math.round(Y1 - v * DH)}" stroke="#222" stroke-width="1" stroke-dasharray="4,4"/>`
  ).join('');

  const xLabels = points.map((p, i) => {
    if (i % labelEvery !== 0) return '';
    const x = Math.round(n > 1 ? X0 + i * step : X0 + DW / 2);
    const label = p.itemSlug.length > 14 ? p.itemSlug.slice(0, 14) + '.' : p.itemSlug;
    return `<text x="${x}" y="${Y1 + 8}" text-anchor="end" font-size="8" fill="#666"
      transform="rotate(-40 ${x} ${Y1 + 8})">${escapeHtml(label)}</text>`;
  }).join('');

  const legend = (['rework', 'iteraciones', 'confianza'] as ChartMetric[]).map((m, i) => {
    const lx = VB_W - 200 + i * 68;
    return `<rect x="${lx}" y="6" width="8" height="8" fill="${COLORS[m]}" rx="1"/>
    <text x="${lx + 11}" y="14" font-size="9" fill="#888">${m.charAt(0).toUpperCase() + m.slice(1)}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${VB_W} ${VB_H}" width="100%" preserveAspectRatio="xMidYMid meet" class="monitor-chart-svg">
    ${legend}
    <line x1="${X0}" y1="${Y0}" x2="${X0}" y2="${Y1}" stroke="#333" stroke-width="1"/>
    <line x1="${X0}" y1="${Y1}" x2="${X1}" y2="${Y1}" stroke="#333" stroke-width="1"/>
    <text x="${X0 - 4}" y="${Y0 + 4}" text-anchor="end" font-size="8" fill="#555">1</text>
    <text x="${X0 - 4}" y="${Y1}" text-anchor="end" font-size="8" fill="#555">0</text>
    ${gridLines}
    ${buildPolyline('rework')}
    ${buildPolyline('iteraciones')}
    ${buildPolyline('confianza')}
    ${xLabels}
  </svg>`;
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
      ${renderBehaviorSummary(s)}
    </div>
  `;
}

function renderBehaviorSummary(s: AgentSummaryIPC): string {
  const fmt = (v: number | null): string => {
    if (v === null) return '--';
    return `${Math.round(v * 100)}%`;
  };
  return `
    <div class="monitor-agent-card-separator"></div>
    <div class="monitor-agent-card-row">
      <span class="monitor-agent-card-label">Checklist adherencia</span>
      <span class="monitor-agent-card-value">${fmt(s.avgChecklistRate)}</span>
    </div>
    <div class="monitor-agent-card-row">
      <span class="monitor-agent-card-label">Structure score</span>
      <span class="monitor-agent-card-value">${fmt(s.avgStructureScore)}</span>
    </div>
    <div class="monitor-agent-card-row">
      <span class="monitor-agent-card-label">Alucinacion rate</span>
      <span class="monitor-agent-card-value ${s.avgHallucinationRate !== null && s.avgHallucinationRate > 0.2 ? 'rework-high' : ''}">${fmt(s.avgHallucinationRate)}</span>
    </div>
    <div class="monitor-agent-card-row">
      <span class="monitor-agent-card-label">Memoria leida</span>
      <span class="monitor-agent-card-value">${fmt(s.memoryReadRate)}</span>
    </div>
  `;
}

// ──────────────────────────────────────────────
// Escape HTML (seguridad -- datos del filesystem)
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
// Render del tab Compliance
// ──────────────────────────────────────────────

function renderComplianceScoresTable(scores: ComplianceScoreIPC[]): string {
  if (scores.length === 0) return '<p class="monitor-empty-state">Sin compliance scores.</p>';
  const rows = scores.map(s => {
    const pct = Math.round(s.score * 100);
    const color = pct >= 90 ? '#4caf50' : pct >= 70 ? '#ff9800' : '#f44336';
    const bar = `<div class="monitor-compliance-bar" style="width:${pct}%;background:${color}"></div>`;
    return `<tr>
      <td title="${escapeHtml(s.featureSlug)}">${escapeHtml(s.featureSlug)}</td>
      <td><div class="monitor-compliance-bar-container">${bar}</div>${pct}%</td>
      <td>${s.filesOk}/${s.filesSpec}</td>
      <td>${s.filesViol > 0 ? `<span class="monitor-compliance-viol">${s.filesViol}</span>` : '0'}</td>
      <td><code style="font-size:11px">${escapeHtml(s.branch)}</code></td>
      <td style="font-size:11px;color:#777">${formatTimestamp(s.recordedAt)}</td>
    </tr>`;
  }).join('');
  return `
    <h3 class="monitor-section-title">Compliance Scores</h3>
    <table class="monitor-table">
      <thead><tr>
        <th>Feature</th><th>Score</th><th>OK/Total</th><th>Violaciones</th><th>Rama</th><th>Fecha</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderRejectionTable(records: RejectionRecordIPC[]): string {
  if (records.length === 0) return '<p class="monitor-empty-state">Sin rejection records.</p>';
  const FAILURE_LABELS: Record<string, string> = {
    patron_conocido: 'patron conocido',
    instruccion_ambigua: 'ambigua',
    instruccion_ausente: 'ausente',
  };
  const rows = records.map(r => `<tr>
    <td title="${escapeHtml(r.featureSlug)}">${escapeHtml(r.featureSlug)}</td>
    <td><span class="monitor-compliance-agent">${escapeHtml(r.agentAtFault)}</span></td>
    <td title="${escapeHtml(r.instructionViolated)}" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
      ${escapeHtml(r.instructionViolated)}
    </td>
    <td><code style="font-size:11px">${escapeHtml(r.instructionSource)}</code></td>
    <td>${escapeHtml(FAILURE_LABELS[r.failureType] ?? r.failureType)}</td>
  </tr>`).join('');
  return `
    <h3 class="monitor-section-title">Rejection Records</h3>
    <table class="monitor-table">
      <thead><tr>
        <th>Feature</th><th>Agente</th><th>Instruccion violada</th><th>Fuente</th><th>Tipo fallo</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderRejectionAggregates(aggregates: RejectionPatternAggregate[]): string {
  if (aggregates.length === 0) return '';
  const cards = aggregates.map(a => `
    <div class="monitor-compliance-agg-card">
      <div class="monitor-compliance-agg-agent">${escapeHtml(a.agentId)}</div>
      <div class="monitor-compliance-agg-total">${a.totalRejections} rechazo${a.totalRejections !== 1 ? 's' : ''}</div>
      ${a.mostFrequentViolation
        ? `<div class="monitor-compliance-agg-top" title="${escapeHtml(a.mostFrequentViolation)}">
            Patron frecuente: "${escapeHtml(a.mostFrequentViolation.slice(0, 40))}${a.mostFrequentViolation.length > 40 ? '...' : ''}"
           </div>`
        : ''}
    </div>
  `).join('');
  return `
    <h3 class="monitor-section-title">Patrones por Agente</h3>
    <div class="monitor-compliance-agg-grid">${cards}</div>`;
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
  onGetAgentTrends: () => Promise<GetAgentTrendsResult>,
  onGetAgentTimeline: (params: GetAgentTimelineParams) => Promise<GetAgentTimelineResult>,
  onGetAgentBehaviorTimeline: (params: GetAgentBehaviorTimelineParams) => Promise<GetAgentBehaviorTimelineResult>,
  onGetComplianceScores: (params: GetComplianceScoresParams) => Promise<GetComplianceScoresResult>,
  onGetRejectionPatterns: (params: GetRejectionPatternsParams) => Promise<GetRejectionPatternsResult>,
): MonitorViewHandle {
  // Estado local de la vista
  let currentSnapshot = initialSnapshot;
  let activeTab: 'pipeline' | 'agents' | 'errors' | 'history' | 'compliance' = 'pipeline';
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

  // Cache y estado expandido de graficas
  const chartsCache = new Map<string, AgentTimelinePoint[]>();
  let chartsInitialized = false;

  // Cache de behavior timelines por agente
  const behaviorCache = new Map<string, AgentBehaviorPointIPC[]>();
  // Agentes expandidos en el acordeon (permite multiples abiertos)
  const expandedAgents = new Set<string>();

  // Estado del tab Compliance (lazy load)
  let complianceData: GetComplianceScoresResult | null = null;
  let rejectionData: GetRejectionPatternsResult | null = null;

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
        <button class="monitor-tab" data-tab="compliance" id="mon-tab-compliance">Compliance</button>
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
        <div class="monitor-behavior-combined-section" id="mon-behavior-combined-section">
          <div class="monitor-behavior-label">Comportamiento por feature</div>
          <div id="mon-behavior-combined-content">
            <p class="monitor-chart-loading">Cargando...</p>
          </div>
        </div>
        <div class="monitor-agent-charts-section" id="mon-agent-charts-section"></div>
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

      <!-- Panel: Compliance -->
      <div class="monitor-panel" id="mon-panel-compliance">
        <div id="monitor-compliance-content">
          <p class="monitor-empty-state">Selecciona el tab para cargar.</p>
        </div>
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
  const agentChartsSectionEl = container.querySelector<HTMLElement>('#mon-agent-charts-section')!;
  const behaviorCombinedSectionEl = container.querySelector<HTMLElement>('#mon-behavior-combined-section')!;
  const errorsListEl = container.querySelector<HTMLElement>('#mon-errors-list')!;
  const historyBodyEl = container.querySelector<HTMLElement>('#mon-history-body')!;
  const historyPaginationEl = container.querySelector<HTMLElement>('#mon-history-pagination')!;
  const historyTypeFilterEl = container.querySelector<HTMLSelectElement>('#mon-history-type-filter')!;
  const historyAgentFilterEl = container.querySelector<HTMLSelectElement>('#mon-history-agent-filter')!;

  // ── Activar/desactivar tabs ──
  function activateTab(tab: 'pipeline' | 'agents' | 'errors' | 'history' | 'compliance') {
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
    // Al activar Compliance: cargar datos lazy
    if (tab === 'compliance' && !complianceData) {
      loadComplianceData();
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

  // ── Cargar y renderizar datos de Compliance (on-demand) ──
  function loadComplianceData() {
    const el = container.querySelector<HTMLElement>('#monitor-compliance-content');
    if (el) el.innerHTML = '<p class="monitor-empty-state">Cargando datos de compliance...</p>';

    Promise.all([
      onGetComplianceScores({ limit: 100 }),
      onGetRejectionPatterns({ limit: 100 }),
    ])
      .then(([scores, rejections]) => {
        complianceData = scores;
        rejectionData = rejections;
        renderComplianceTab();
      })
      .catch((err) => {
        console.error('[monitor-view] loadComplianceData error:', err);
        const elErr = container.querySelector<HTMLElement>('#monitor-compliance-content');
        if (elErr) elErr.innerHTML = '<p class="monitor-empty-state">Error al cargar datos de compliance.</p>';
      });
  }

  function renderComplianceTab(): void {
    const el = container.querySelector<HTMLElement>('#monitor-compliance-content');
    if (!el) return;

    if (!complianceData || !rejectionData) {
      el.innerHTML = '<p class="monitor-empty-state">Cargando datos de compliance...</p>';
      return;
    }

    if (complianceData.scores.length === 0 && rejectionData.records.length === 0) {
      el.innerHTML = `
        <p class="monitor-empty-state">
          Sin datos de compliance aun.<br>
          Para calcular compliance scores, ejecuta:<br>
          <code>bun run compliance-check &lt;feature-slug&gt;</code>
        </p>`;
      return;
    }

    el.innerHTML = `
      ${renderComplianceScoresTable(complianceData.scores)}
      ${renderRejectionTable(rejectionData.records)}
      ${renderRejectionAggregates(rejectionData.aggregates)}
    `;
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
        // Cargar behavior timelines para todos los agentes (on-demand con cache)
        loadBehaviorTimelines(currentSnapshot.agentSummaries.map(s => s.agentId));
      })
      .catch((err) => {
        console.error('[monitor-view] loadAgentTrends error:', err);
      });
  }

  // ── Tabla de comportamiento por feature ──
  function renderBehaviorTable(points: AgentBehaviorPointIPC[]): string {
    if (points.length === 0) {
      return '<p class="monitor-chart-empty">Sin datos de comportamiento.</p>';
    }
    const fmt = (v: number | null): string => {
      if (v === null) return '--';
      return `${Math.round(v * 100)}%`;
    };
    const rows = points.map(p => `
      <tr>
        <td style="font-size:10px;color:#888">${escapeHtml(p.itemSlug)}</td>
        <td>${fmt(p.checklistRate)}</td>
        <td>${fmt(p.structureScore)}</td>
        <td class="${p.hallucinationRate !== null && p.hallucinationRate > 0.2 ? 'rework-high' : ''}">${fmt(p.hallucinationRate)}</td>
        <td>${p.memoryRead === 1 ? '<span class="monitor-rework-no">si</span>' : p.memoryRead === 0 ? '<span class="monitor-rework-yes">no</span>' : '--'}</td>
      </tr>
    `).join('');
    return `
      <table class="monitor-table">
        <thead>
          <tr>
            <th>Feature</th>
            <th>Checklist</th>
            <th>Estructura</th>
            <th>Alucinacion</th>
            <th>Memoria</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  const AGENT_ORDER = ['leo', 'cloe', 'max', 'ada', 'cipher'];

  function renderBehaviorAccordion(): string {
    const fmt = (v: number | null): string =>
      v === null ? '--' : `${Math.round(v * 100)}%`;

    const items = AGENT_ORDER
      .filter(id => behaviorCache.has(id))
      .map(agentId => {
        const points = behaviorCache.get(agentId)!;
        const summary = currentSnapshot.agentSummaries.find(s => s.agentId === agentId);
        const isExpanded = expandedAgents.has(agentId);
        const name = agentId.charAt(0).toUpperCase() + agentId.slice(1);

        const chips = summary ? [
          `<span class="mon-behavior-chip">Checklist: ${fmt(summary.avgChecklistRate)}</span>`,
          `<span class="mon-behavior-chip ${summary.avgHallucinationRate !== null && summary.avgHallucinationRate > 0.2 ? 'mon-behavior-chip-warn' : ''}">Alucinacion: ${fmt(summary.avgHallucinationRate)}</span>`,
          `<span class="mon-behavior-chip">Estructura: ${fmt(summary.avgStructureScore)}</span>`,
          `<span class="mon-behavior-chip">Memoria: ${fmt(summary.memoryReadRate)}</span>`,
        ].join('') : '';

        return `<div class="mon-behavior-accordion-item">
          <div class="mon-behavior-accordion-header" data-agent="${escapeHtml(agentId)}">
            <span class="mon-behavior-accordion-arrow">${isExpanded ? '&#9660;' : '&#9654;'}</span>
            <span class="mon-behavior-accordion-name">${escapeHtml(name)}</span>
            <span class="mon-behavior-accordion-chips">${chips}</span>
          </div>
          <div class="mon-behavior-accordion-content" ${isExpanded ? '' : 'style="display:none"'}>
            ${renderBehaviorTable(points)}
          </div>
        </div>`;
      });

    return items.length > 0
      ? items.join('')
      : '<p class="monitor-chart-empty">Sin datos de comportamiento.</p>';
  }

  function updateBehaviorSection(_agentId: string) {
    const el = container.querySelector<HTMLElement>('#mon-behavior-combined-content');
    if (el) el.innerHTML = renderBehaviorAccordion();
  }

  function loadBehaviorTimelines(agentIds: string[]) {
    for (const agentId of agentIds) {
      if (behaviorCache.has(agentId)) continue;
      onGetAgentBehaviorTimeline({ agentId })
        .then((result) => {
          behaviorCache.set(agentId, result.points);
          // Auto-expandir el primer agente con datos
          if (expandedAgents.size === 0 && result.points.length > 0) {
            expandedAgents.add(agentId);
          }
          updateBehaviorSection(agentId);
        })
        .catch((err) => console.error(`[monitor-view] loadBehaviorTimelines ${agentId} error:`, err));
    }
  }

  // Event delegation para el acordeon — se registra una sola vez
  behaviorCombinedSectionEl.addEventListener('click', (e) => {
    const header = (e.target as Element).closest<HTMLElement>('.mon-behavior-accordion-header');
    if (!header) return;
    const agentId = header.dataset.agent;
    if (!agentId) return;
    if (expandedAgents.has(agentId)) {
      expandedAgents.delete(agentId);
    } else {
      expandedAgents.add(agentId);
    }
    updateBehaviorSection(agentId);
  });

  // ── Renderizar seccion de graficas (una fila por agente) ──
  function renderChartsSectionRows(agentIds: string[]) {
    agentChartsSectionEl.innerHTML = agentIds.map(id =>
      `<div class="monitor-chart-agent-row">
        <div class="monitor-chart-agent-label">${id.charAt(0).toUpperCase() + id.slice(1)}</div>
        <div class="monitor-chart-agent-content" id="mon-chart-content-${id}">
          <p class="monitor-chart-loading">Cargando...</p>
        </div>
      </div>`
    ).join('');

    for (const id of agentIds) {
      if (chartsCache.has(id)) {
        const el = agentChartsSectionEl.querySelector<HTMLElement>(`#mon-chart-content-${id}`);
        if (el) el.innerHTML = renderCombinedChart(chartsCache.get(id)!);
      } else {
        fetchAndRenderChart(id);
      }
      if (behaviorCache.has(id)) {
        updateBehaviorSection(id);
      }
    }
  }

  function fetchAndRenderChart(agentId: string) {
    onGetAgentTimeline({ agentId })
      .then((result) => {
        chartsCache.set(agentId, result.points);
        const el = agentChartsSectionEl.querySelector<HTMLElement>(`#mon-chart-content-${agentId}`);
        if (el) el.innerHTML = renderCombinedChart(result.points);
      })
      .catch((err) => {
        console.error('[monitor-view] fetchAndRenderChart error:', err);
        const el = agentChartsSectionEl.querySelector<HTMLElement>(`#mon-chart-content-${agentId}`);
        if (el) el.innerHTML = '<p class="monitor-chart-empty">Error al cargar datos.</p>';
      });
  }

  // ── Actualizar solo las partes del DOM que cambian (INCREMENTAL) ──
  function updateSnapshot(snapshot: PipelineSnapshotIPC) {
    currentSnapshot = snapshot;

    // Restaurar boton Actualizar si estaba en estado "cargando"
    if (refreshBtn.disabled) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Actualizar';
    }

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
      if (!chartsInitialized) {
        chartsInitialized = true;
        renderChartsSectionRows(snapshot.agentSummaries.map(s => s.agentId));
      }
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

  function onRefreshClick() {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Actualizando...';
    onRefresh();
  }
  refreshBtn.addEventListener('click', onRefreshClick);

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset['tab'] as 'pipeline' | 'agents' | 'errors' | 'history' | 'compliance';
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
      refreshBtn.removeEventListener('click', onRefreshClick);
      historyTypeFilterEl.removeEventListener('change', onHistoryTypeChange);
      historyAgentFilterEl.removeEventListener('change', onHistoryAgentChange);
    },
    updateSnapshot,
  };
}
