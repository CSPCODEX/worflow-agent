# Feature — Graficas de evolucion de metricas de agentes

Estado: APROBADO
Rama: feature/graficas-evolucion-metricas-agentes
Fecha apertura: 2026-03-15

---

## Info de la feature

**Descripcion:** En el tab Agentes del monitor, debajo de las cards actuales (que muestran metricas agregadas), añadir una seccion colapsable por agente con 3 graficas SVG inline que muestren la evolucion de rework, iteraciones y confianza a lo largo de las features registradas en la DB.

**Objetivo:** Dar visibilidad de tendencia temporal por agente — no solo el promedio actual, sino como ha variado feature a feature para detectar si un agente mejora o empeora con el tiempo.

**Restricciones:** Sin librerias de graficas externas. SVG inline generado desde TypeScript como string.

---

## Handoff Leo → Cloe

### Contexto rapido

La DB `monitor-history.db` ya tiene la tabla `agent_metrics_history` con columnas:
`id, agent_id, item_type, item_slug, rework (0/1/null), iteraciones (int/null), confianza ('alta'/'media'/'baja'/null), gaps_declarados (int/null), recorded_at (ISO8601 TEXT)`

La funcion `queryAgentTrends` en `historyRepository.ts` NO sirve para graficas — devuelve promedios, no series temporales. Hay que crear `queryAgentTimeline` en un archivo nuevo.

El canal IPC `getAgentTrends` ya existe. Hay que añadir un canal NUEVO `getAgentTimeline`.

La funcion `renderMonitor()` en `monitor-view.ts` recibe 4 callbacks. Hay que añadir un quinto.

### Archivos a crear/modificar en orden

**1. CREAR `src/monitor/core/timelineRepository.ts`**

```typescript
import type { Database } from 'bun:sqlite';
import type { AgentTimelinePoint } from '../../types/ipc';

interface TimelineRow {
  agent_id: string;
  item_slug: string;
  item_type: string;
  rework: number | null;
  iteraciones: number | null;
  confianza: string | null;
  recorded_at: string;
}

const CONF_MAP: Record<string, number> = { alta: 3, media: 2, baja: 1 };

export function queryAgentTimeline(db: Database, agentId: string): AgentTimelinePoint[] {
  const stmt = db.prepare<TimelineRow, [string]>(`
    SELECT agent_id, item_slug, item_type,
           rework, iteraciones, confianza, recorded_at
    FROM agent_metrics_history
    WHERE agent_id = ?
    ORDER BY recorded_at ASC
  `);

  const rows = stmt.all(agentId);

  return rows.map((row) => ({
    itemSlug: row.item_slug,
    itemType: row.item_type as 'feature' | 'bug',
    rework: row.rework !== null ? (row.rework === 1 ? 1 : 0) : null,
    iteraciones: row.iteraciones,
    confianza: row.confianza !== null ? (CONF_MAP[row.confianza] ?? null) : null,
    recordedAt: row.recorded_at,
  }));
}
```

NOTA: Prepared statement con `?` — nunca interpolar `agentId` directamente.

---

**2. MODIFICAR `src/monitor/index.ts`**

Añadir re-export de `queryAgentTimeline`:

```typescript
export { queryAgentTimeline } from './core/timelineRepository';
```

La linea va junto a los otros exports de core. No tocar nada mas de este archivo.

---

**3. MODIFICAR `src/types/ipc.ts`**

Añadir TRES tipos nuevos despues de `GetAgentTrendsResult` (antes de la seccion de Settings):

```typescript
// --- Monitor Timeline types ---

export interface AgentTimelinePoint {
  itemSlug: string;
  itemType: 'feature' | 'bug';
  rework: number | null;        // 0 o 1, null = sin dato
  iteraciones: number | null;
  confianza: number | null;     // 1=baja, 2=media, 3=alta, null = sin dato
  recordedAt: string;           // ISO 8601
}

export interface GetAgentTimelineParams {
  agentId: string;
}

export interface GetAgentTimelineResult {
  agentId: string;
  points: AgentTimelinePoint[];
}
```

Añadir el canal al tipo `AppRPC` dentro de `bun.requests`, despues de `getAgentTrends`:

```typescript
getAgentTimeline: { params: GetAgentTimelineParams; response: GetAgentTimelineResult };
```

---

**4. MODIFICAR `src/ipc/handlers.ts`**

a) Añadir los tipos al import desde `'../types/ipc'`:
```typescript
import type { ..., GetAgentTimelineParams, GetAgentTimelineResult } from '../types/ipc';
```

b) Añadir `queryAgentTimeline` al import desde `'../monitor/index'`:
```typescript
import { PipelinePoller, getHistoryDb, queryHistory, queryAgentTrends, queryAgentTimeline } from '../monitor/index';
```

c) Añadir el handler dentro de `handlers.requests`, despues del handler `getAgentTrends`:

```typescript
getAgentTimeline: async (params: GetAgentTimelineParams): Promise<GetAgentTimelineResult> => {
  const VALID_AGENTS = ['leo', 'cloe', 'max', 'ada', 'cipher'];
  const agentId = params?.agentId ?? '';
  if (!VALID_AGENTS.includes(agentId)) {
    return { agentId, points: [] };
  }
  const db = getHistoryDb();
  if (!db) return { agentId, points: [] };
  try {
    const points = queryAgentTimeline(db, agentId);
    return { agentId, points };
  } catch (e: any) {
    console.error('[handlers] getAgentTimeline error:', e.message);
    return { agentId, points: [] };
  }
},
```

NOTA: No es fire-and-forget — SQLite bun:sqlite es I/O sincrono. Patron establecido: handlers de consulta SQLite son `async` pero retornan directamente, sin `.catch()` aparte.

---

**5. MODIFICAR `src/renderer/app.ts`**

Localizar la llamada a `renderMonitor(...)` en `app.ts`. Actualmente tiene 4 argumentos:
```
renderMonitor(container, snapshot, onRefresh, onGetHistory, onGetAgentTrends)
```

Añadir el quinto argumento `onGetAgentTimeline`:
```typescript
(params) => rpc.bun.getAgentTimeline(params)
```

Buscar la declaracion `renderMonitor(` en app.ts y anadir al final del call:
```typescript
(params) => (rpc as any).bun.getAgentTimeline(params),
```

NOTA: Puede requerir `(rpc as any)` por la limitacion de type inference de Electrobun — ver patron establecido en memoria de Cloe.

---

**6. MODIFICAR `src/monitor/ui/monitor-view.ts`**

**6a. Actualizar la firma de `renderMonitor()`**

Importar los tipos nuevos:
```typescript
import type {
  // ...tipos existentes...
  GetAgentTimelineParams,
  GetAgentTimelineResult,
  AgentTimelinePoint,
} from '../../types/ipc';
```

Nuevo parametro en la firma:
```typescript
export function renderMonitor(
  container: HTMLElement,
  initialSnapshot: PipelineSnapshotIPC,
  onRefresh: () => void,
  onGetHistory: (params: GetHistoryParams) => Promise<GetHistoryResult>,
  onGetAgentTrends: () => Promise<GetAgentTrendsResult>,
  onGetAgentTimeline: (params: GetAgentTimelineParams) => Promise<GetAgentTimelineResult>,
): MonitorViewHandle {
```

**6b. Variables de estado locales (añadir al inicio del closure, junto a trendsMap)**

```typescript
const chartsCache = new Map<string, AgentTimelinePoint[]>();
const expandedAgents = new Set<string>();
```

**6c. Funcion `renderLineChart(points, metric, color)` — NUEVA funcion auxiliar pura**

Añadir antes de `renderAgentCard`:

```typescript
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

function renderAgentCharts(points: AgentTimelinePoint[]): string {
  if (points.length === 0) {
    return `<p class="monitor-chart-empty">Sin datos historicos para este agente.</p>`;
  }
  const reworkSvg  = renderLineChart(points, 'rework',     '#e57373');
  const iterSvg    = renderLineChart(points, 'iteraciones', '#4a9eff');
  const confSvg    = renderLineChart(points, 'confianza',   '#66bb6a');
  return `<div class="monitor-chart-row">${reworkSvg}${iterSvg}${confSvg}</div>`;
}
```

**6d. Modificar `renderAgentCard()` para añadir el boton toggle**

Al final del HTML de la card, dentro del `<div class="monitor-agent-card">`, añadir:

```typescript
  return `
    <div class="monitor-agent-card" data-agent="${s.agentId}">
      <!-- ... filas existentes sin cambios ... -->
      ${trendBlock}
      <button class="monitor-btn-chart-toggle" data-agent-toggle="${s.agentId}">
        Ver graficas
      </button>
      <div class="monitor-agent-charts" id="mon-charts-${s.agentId}" style="display:none">
        <p class="monitor-chart-loading">Cargando...</p>
      </div>
    </div>
  `;
```

**6e. Funcion `loadAgentCharts(agentId)` — NUEVA**

Añadir dentro del closure de `renderMonitor`, junto a `loadHistory` y `loadAgentTrends`:

```typescript
function loadAgentCharts(agentId: string) {
  const chartsEl = container.querySelector<HTMLElement>(`#mon-charts-${agentId}`);
  if (!chartsEl) return;
  chartsEl.style.display = 'block';

  if (chartsCache.has(agentId)) {
    chartsEl.innerHTML = renderAgentCharts(chartsCache.get(agentId)!);
    return;
  }

  chartsEl.innerHTML = '<p class="monitor-chart-loading">Cargando...</p>';
  onGetAgentTimeline({ agentId })
    .then((result) => {
      chartsCache.set(agentId, result.points);
      chartsEl.innerHTML = renderAgentCharts(result.points);
    })
    .catch((err) => {
      console.error('[monitor-view] loadAgentCharts error:', err);
      chartsEl.innerHTML = '<p class="monitor-chart-empty">Error al cargar datos.</p>';
    });
}

function collapseAgentCharts(agentId: string) {
  const chartsEl = container.querySelector<HTMLElement>(`#mon-charts-${agentId}`);
  if (chartsEl) chartsEl.style.display = 'none';
}
```

**6f. Registrar listeners para los botones toggle — en la funcion que renderiza las cards**

El problema: cada vez que se re-renderizan las cards (en `updateSnapshot`), se pierde la delegacion de eventos. Solución: usar **event delegation** en `agentsGridEl`.

Añadir UNA VEZ, despues de obtener la ref a `agentsGridEl`, el listener delegado:

```typescript
function onAgentGridClick(e: Event) {
  const target = e.target as HTMLElement;
  const agentToggle = target.closest<HTMLElement>('[data-agent-toggle]')?.dataset['agentToggle'];
  if (!agentToggle) return;

  if (expandedAgents.has(agentToggle)) {
    expandedAgents.delete(agentToggle);
    collapseAgentCharts(agentToggle);
    // Actualizar texto del boton
    const btn = container.querySelector<HTMLButtonElement>(`[data-agent-toggle="${agentToggle}"]`);
    if (btn) btn.textContent = 'Ver graficas';
  } else {
    expandedAgents.add(agentToggle);
    loadAgentCharts(agentToggle);
    const btn = container.querySelector<HTMLButtonElement>(`[data-agent-toggle="${agentToggle}"]`);
    if (btn) btn.textContent = 'Ocultar graficas';
  }
}

agentsGridEl.addEventListener('click', onAgentGridClick);
```

IMPORTANTE: añadir `agentsGridEl.removeEventListener('click', onAgentGridClick)` en `cleanup()`.

**6g. Manejar el re-render de cards en `updateSnapshot` preservando estado expandido**

En la funcion `updateSnapshot`, donde se hace `agentsGridEl.innerHTML = ...`, DESPUES de inyectar el HTML, re-aplicar el estado de expansion desde `expandedAgents` y `chartsCache`:

```typescript
// Restaurar graficas expandidas tras re-render de cards
for (const agentId of expandedAgents) {
  const chartsEl = container.querySelector<HTMLElement>(`#mon-charts-${agentId}`);
  const btn = container.querySelector<HTMLButtonElement>(`[data-agent-toggle="${agentId}"]`);
  if (chartsEl) {
    chartsEl.style.display = 'block';
    if (chartsCache.has(agentId)) {
      chartsEl.innerHTML = renderAgentCharts(chartsCache.get(agentId)!);
    }
  }
  if (btn) btn.textContent = 'Ocultar graficas';
}
```

---

**7. MODIFICAR `src/monitor/ui/monitor-styles.css`**

Añadir al final del archivo:

```css
/* Agent charts section */
.monitor-btn-chart-toggle {
  width: 100%;
  margin-top: 12px;
  padding: 6px 0;
  background: #1e1e1e;
  color: #666;
  border: 1px solid #2a2a2a;
  border-radius: 5px;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  text-align: center;
}

.monitor-btn-chart-toggle:hover {
  background: #252525;
  color: #aaa;
}

.monitor-agent-charts {
  margin-top: 10px;
  border-top: 1px solid #222;
  padding-top: 10px;
}

.monitor-chart-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}

.monitor-chart-svg {
  overflow: visible;
  display: block;
}

.monitor-chart-loading {
  font-size: 11px;
  color: #555;
  font-style: italic;
  text-align: center;
  padding: 8px 0;
}

.monitor-chart-empty {
  font-size: 11px;
  color: #555;
  font-style: italic;
  text-align: center;
  padding: 8px 0;
}
```

NOTA: Las graficas se muestran en columna (`flex-direction: column`) dentro de la card porque el ancho minimo de la card es 200px y el SVG tiene 280px — es mas ancho que la card. En pantallas grandes las cards crecen, pero en la columna el SVG siempre cabe. Alternativa: reducir el SVG a 200px de ancho. Leo deja esta decision a Cloe segun lo que se vea mejor en el browser real.

---

### Reglas que Cloe debe respetar

1. **Prepared statements obligatorios** — `db.prepare<RowType, [string]>(sql).all(agentId)` — nunca template literal con el agentId dentro del SQL.
2. **No fire-and-forget** en `getAgentTimeline` — SQLite es sincrono, el handler puede retornar directamente.
3. **Handler nunca lanza** — siempre `try/catch` retornando el resultado vacio en el catch.
4. **Prefijo `.monitor-`** en todos los selectores CSS nuevos.
5. **Event delegation** en `agentsGridEl` — no registrar listeners en cada card (se re-renderizan).
6. **No importar Node.js** en `monitor-view.ts` — solo tipos de `src/types/ipc.ts`.
7. **escapeHtml()** para slug en etiquetas SVG — aunque improbable, los slugs vienen del filesystem.
8. **ASCII-only en IPC** — los campos de `AgentTimelinePoint` son numeros o strings con caracteres ASCII (slugs y fechas ISO). No se necesita sanitizacion adicional mas alla de `escapeHtml` en la UI.
9. **`(rpc as any)`** para el nuevo canal en `app.ts` si el tipo no infiere correctamente — patron establecido.
10. **No tocar** `src/index.ts`, `src/client.ts`, ni ningun agente generado.

---

### Checklist Leo

- [x] Cada archivo a crear/modificar tiene ruta absoluta desde repo root
- [x] Contratos IPC escritos con tipos TypeScript completos inline
- [x] Tipos de retorno de funciones nuevas especificados con tipos TypeScript concretos (no any)
- [x] Lista de archivos ordenada por prioridad de implementacion
- [x] Sin "ver plan.md" ni "ver acceptance.md" — todo el contexto inline en status.md
- [x] Limitaciones de Electrobun verificadas: getAgentTimeline NO es fire-and-forget (SQLite sincrono)
- [x] Decisiones de arquitectura con justificacion explicita (canal nuevo vs extender trends, colapsable vs siempre visible, column layout SVG)

---

### Gaps y dudas de Leo

- **Gap 1:** El ancho del SVG (280px) puede exceder el ancho de la card en la grid (minimo 200px). Verificar en el browser si se recorta. Si hay recorte, reducir `SVG_W` a 200 y ajustar `DRAW_X1` a 180. `overflow: visible` en el SVG deberia prevenir el recorte del svg en si, pero el contenedor padre puede tener `overflow: hidden`.
- **Gap 2:** `app.ts` — no he visto el archivo completo. La llamada a `renderMonitor()` puede estar envuelta en un closure o condicion. Cloe debe verificar la firma exacta y el lugar correcto para añadir el quinto argumento.
- **Gap 3:** Electrobun type inference en `(rpc as any).bun.getAgentTimeline` — puede que el canal tipado funcione directamente sin `(rpc as any)` si el `AppRPC` se actualiza correctamente. Verificar y usar la forma tipada si funciona.

**Confianza general del plan: alta**

Los unicos gaps son de presentacion visual (ancho SVG) y de integracion exacta con app.ts — ninguno afecta la arquitectura core.

---

## Metricas de Leo

- archivos_leidos: 7
- archivos_creados: 4 (plan.md, ipc-contracts.md, data-flows.md, acceptance.md — status.md ya existia)
- archivos_modificados: 1 (status.md)
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 3

---

## Handoff Cloe → Max

### Checklist Cloe
- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Leo (tipos exactos, sin any)
- [x] bun run tsc --noEmit ejecutado — 0 errores nuevos en src/monitor/, src/types/ipc.ts, src/ipc/handlers.ts, src/renderer/app.ts
- [x] Strings que viajan por IPC son ASCII puro (slugs, ISO dates, numeros — verificado)
- [x] No fire-and-forget en getAgentTimeline (SQLite sincrono — patron correcto, retorna directamente)
- [x] Input validation en getAgentTimeline: VALID_AGENTS whitelist antes de cualquier operacion DB
- [x] Handler nunca lanza: try/catch con retorno vacio en el catch
- [x] Sin `any` sin justificacion (solo `(rpc as any)` en app.ts — patron establecido por limitacion Electrobun)
- [x] Event delegation en agentsGridEl — un solo listener para todos los botones toggle
- [x] Listener limpiado en cleanup(): agentsGridEl.removeEventListener('click', onAgentGridClick)
- [x] escapeHtml() en etiquetas SVG para los slugs de eje X
- [x] Todas las clases CSS nuevas existen en monitor-styles.css (check #4 ejecutado: 0 clases faltantes)

### Manifiesto de archivos
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| src/monitor/core/timelineRepository.ts | creado | 1-37 |
| src/monitor/index.ts | modificado | 8 (linea nueva) |
| src/types/ipc.ts | modificado | 272-292 (tipos nuevos), 313 (canal en AppRPC) |
| src/ipc/handlers.ts | modificado | 4 (import tipos), 20 (import funcion), 260-278 (handler nuevo) |
| src/renderer/app.ts | modificado | 2 (import tipos), 101-103 (quinto argumento renderMonitor) |
| src/monitor/ui/monitor-view.ts | modificado | 11-14 (imports), 120-228 (funciones SVG), 248-268 (renderAgentCard), 396-423 (firma+estado), 649-690 (loadAgentCharts/collapse/restore), 720 (restoreExpandedCharts en updateSnapshot), 637-641 (restoreExpandedCharts en loadAgentTrends), 737-756 (event delegation), 807 (cleanup) |
| src/monitor/ui/monitor-styles.css | modificado | 386-435 (6 selectores nuevos) |

### Descripcion de lo implementado

1. `timelineRepository.ts` — consulta `agent_metrics_history` con prepared statement, mapea filas a `AgentTimelinePoint[]` convirtiendo `confianza` string a numero (1/2/3) via `CONF_MAP`.

2. Canal IPC `getAgentTimeline` — handler con whitelist VALID_AGENTS, try/catch, retorno vacio en todos los paths de error. SQLite sincrono, no fire-and-forget.

3. Graficas SVG inline — `renderLineChart()` genera SVG 280x110 con polilineas segmentadas (gaps en null), circulos en puntos, etiquetas eje X (slug truncado a 8 chars con escapeHtml) y etiquetas eje Y dinamicas. `renderAgentCharts()` compone 3 graficas (rework rojo, iteraciones azul, confianza verde) en columna.

4. Toggle colapsable — boton `monitor-btn-chart-toggle` en cada card con `data-agent-toggle` attribute. Event delegation en `agentsGridEl` (un listener, no uno por card). Estado persistido en `expandedAgents: Set<string>` y datos en `chartsCache: Map<string, AgentTimelinePoint[]>` — ambos sobreviven re-renders de cards.

5. Restauracion de estado — `restoreExpandedCharts()` llamada despues de cada `innerHTML` de `agentsGridEl` (en `updateSnapshot` y en `loadAgentTrends`) para que el estado expandido/colapsado no se pierda con los polls del poller.

### Casos borde considerados

- **Agente sin datos en DB**: `queryAgentTimeline` retorna `[]`, `renderAgentCharts` muestra "Sin datos historicos".
- **Punto con valor null en la serie**: `renderLineChart` omite el punto del poliline (segmenta en el gap) pero mantiene el eje X con todos los slugs.
- **Un solo punto en la serie**: `step = 0`, el punto se dibuja en el centro horizontal del SVG.
- **Maximo de iteraciones dinamico**: `Math.max(5, ...validValues)` — escala el eje segun los datos reales.
- **Division por cero en maxY**: guard `if (maxY === 0) maxY = 1` para el caso `rework` con todos los puntos en 0.
- **agentId invalido enviado desde renderer**: VALID_AGENTS whitelist retorna `{ agentId, points: [] }` sin llegar a la DB.
- **DB no inicializada**: `getHistoryDb()` retorna null, handler retorna `{ agentId, points: [] }`.
- **Re-render de cards con graficas abiertas**: `restoreExpandedCharts()` restaura display:block y HTML del cache, el boton queda con texto "Ocultar graficas".

### Advertencias para Max

- El ancho del SVG es 280px mientras el ancho minimo de card es ~200px. El CSS usa `overflow: visible` en `.monitor-chart-svg` para que el SVG no se recorte, pero el contenedor padre `.monitor-agent-card` puede tener `overflow: hidden` si el CSS del host lo impone. Verificar en el browser si los SVGs se recortan.
- Los datos de graficas se cargan on-demand (solo al hacer click en "Ver graficas") — si la DB esta vacia, el spinner "Cargando..." aparece y luego muestra "Sin datos historicos".
- El cache `chartsCache` no se invalida con los polls del poller — si llega un nuevo snapshot con nuevos datos de metricas, las graficas ya abiertas no se actualizan hasta que el usuario colapse y vuelva a abrir. Este es el comportamiento esperado para esta version.

### Gaps y dudas de Cloe

- Gap 1: No pude verificar visualmente el ancho del SVG (280px) vs el ancho real de la card en el browser. El gap de Leo aplica — si hay recorte, reducir SVG_W a 200 y DRAW_X1 a 180.
- Gap 2: La funcion `restoreExpandedCharts` en el caso de grafica expandida sin cache aun (spinner "Cargando...") restaura `display:block` pero no relanza la peticion IPC — el usuario veria el spinner congelado hasta que colapse y vuelva a abrir. Este caso es poco probable (el re-render ocurre mientras el IPC esta en vuelo), pero existe.

Confianza en la implementacion: alta

→ Siguiente: @max Verifica la feature. El handoff de Cloe esta en docs/features/graficas-evolucion-metricas-agentes/status.md seccion "Handoff Cloe → Max".

## Metricas de Cloe
- archivos_leidos: 8
- archivos_creados: 1
- archivos_modificados: 6
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 2

---

## Handoff Max → Ada

### Checklist Max — [bloques activos: ESTATICO | IPC | RENDERER]

## ESTATICO
- [x] Cada archivo del manifiesto verificado con file:line — evidencia: timelineRepository.ts:1-35, monitor/index.ts:8, types/ipc.ts:272-334, handlers.ts:4+20+260-275, app.ts:2+103-104, monitor-view.ts:1-811, monitor-styles.css:385-437
- [x] bun run tsc --noEmit — 0 errores nuevos — evidencia: baseline tenia TS2305 sobre AgentTimelinePoint (error en timelineRepository al faltarle el tipo en ipc.ts). Con los cambios de Cloe ese error desaparece. Todos los demas errores son preexistentes en node_modules/, scripts/, src/client.ts, src/db/, src/ipc/acpManager.ts, src/renderer/components/agent-list.ts.
- [x] Sin logica de negocio rota en los archivos modificados — evidencia: prepared statement correcto, handler con whitelist + try/catch, event delegation correcta, cleanup completo

## IPC
- [x] Strings IPC son ASCII puro — evidencia: AgentTimelinePoint.itemSlug (slug a-z0-9-), itemType ('feature'|'bug'), rework/iteraciones/confianza (numeros), recordedAt (ISO 8601 — solo digitos y -T:.Z). Sin chars > 0x7E en ningun campo.
- [x] Inputs validados antes de filesystem ops o spawn — evidencia: handlers.ts:261-263 VALID_AGENTS whitelist antes de cualquier operacion DB

## RENDERER
- [x] Labels HTML: todos los inputs tienen for+id matching — evidencia: for="mon-feature-filter" / id="mon-feature-filter" (lineas 446/447), for="mon-bug-filter" / id="mon-bug-filter" (lineas 469/470), for="mon-history-type-filter" / id="mon-history-type-filter" (lineas 506/507), for="mon-history-agent-filter" / id="mon-history-agent-filter" (lineas 512/513). Boton toggle no requiere label (es button con texto visible).
- [x] Archivos CSS referenciados en el manifiesto revisados — evidencia: 6 selectores nuevos en monitor-styles.css:385-437 (.monitor-btn-chart-toggle, .monitor-btn-chart-toggle:hover, .monitor-agent-charts, .monitor-chart-row, .monitor-chart-svg, .monitor-chart-loading, .monitor-chart-empty). Todas las clases usadas en monitor-view.ts tienen definicion en CSS. No hay clases huerfanas.
- [x] User input usa textContent o escapeHtml, no innerHTML — evidencia: escapeHtml() en etiquetas SVG (monitor-view.ts:220). Slugs vienen del filesystem, no de input de usuario. Datos numericos se renderizan como literales JS, no como strings de usuario.
- [x] Estados de carga y error manejados en UI — evidencia: loadAgentCharts muestra "Cargando..." antes del IPC y "Error al cargar datos." en el catch (monitor-view.ts:660-668). Estado vacio muestra "Sin datos historicos para este agente." (monitor-view.ts:242).

### No verificado por Max
- Overflow visual SVG 280px en cards de 200px minimo: no verificable sin runtime browser. Se confirma que no hay overflow:hidden en ningun contenedor padre en el CSS auditado, y .monitor-chart-svg tiene overflow:visible explicito. El recorte dependeria de estilos del host (style.css) que no fueron modificados en esta feature.
- Spinner congelado (Gap 2 de Cloe): verificado como problema real pero de probabilidad muy baja. Ver issue #1 a continuacion.
Confianza en la verificacion: alta

**Resultado de la verificacion:** APROBADO con gaps conocidos

**Casos probados:**
- prepared statement con ? — agentId nunca interpolado en SQL (timelineRepository.ts:17-23)
- VALID_AGENTS whitelist en handler — retorna {agentId, points:[]} para ids invalidos (handlers.ts:261-264)
- try/catch en handler — retorna resultado vacio sin lanzar (handlers.ts:266-274)
- event delegation en agentsGridEl — un listener para todos los toggles, no uno por card (monitor-view.ts:756)
- removeEventListener en cleanup() — agentsGridEl, refreshBtn, historyTypeFilter, historyAgentFilter, monitor:snapshot (monitor-view.ts:802-807)
- escapeHtml en etiquetas SVG — slugs escapados antes de emitir en texto SVG (monitor-view.ts:220)
- 0 errores TSC nuevos — confirmado con baseline git stash
- todas las clases CSS nuevas existen en monitor-styles.css — confirmado por inspeccion exhaustiva
- labels for+id matching — 4 pares verificados, todos correctos
- restoreExpandedCharts — no introduce listeners nuevos, no hay memory leaks detectados

**Issues encontrados:**

### Issue #1 — Spinner congelado si re-render ocurre mid-IPC (Gap 2 de Cloe confirmado)
- Severidad: medio
- Componente: src/monitor/ui/monitor-view.ts, funcion restoreExpandedCharts (lineas 678-690)
- Descripcion: cuando llega un poll del poller (cada 30s) mientras el IPC getAgentTimeline esta en vuelo, agentsGridEl.innerHTML destruye el chartsEl original. La Promise del IPC completa y escribe en el chartsEl stale (fuera del DOM). restoreExpandedCharts restaura display:block pero sin cache no relanza el IPC — el usuario ve el spinner congelado permanentemente hasta colapsar y reabrir.
- Probabilidad real: muy baja. El IPC es SQLite local (<100ms) y el poll es cada 30s. Ventana de overlap estimada: <0.3% del tiempo con graficas abiertas.
- Resultado esperado: la grafica se recarga automaticamente tras el re-render si el IPC aun esta en vuelo.
- Resultado actual: spinner permanente visible. Recuperable por el usuario colapsando y reabriendo.
- Evidencia: monitor-view.ts:678-690 — rama "no cache" de restoreExpandedCharts no relanza IPC; monitor-view.ts:661-664 — Promise del IPC escribe en chartsEl que puede ser stale.
- Aceptacion: ACEPTADO como gap conocido para esta version. Ada puede resolverlo llamando loadAgentCharts(agentId) en la rama sin cache de restoreExpandedCharts, pero eso implica IPC adicional en cada poll para graficas abiertas.

**Tiene implicaciones de seguridad:** NO

→ Siguiente: @ada Optimiza la feature. Max aprobo con gaps conocidos — ver docs/features/graficas-evolucion-metricas-agentes/status.md seccion "Handoff Max → Ada".

## Metricas de Max
- archivos_leidos: 9
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 1
- items_checklist_verificados: 9/9
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 2

---

## Handoff Ada → Cipher

### Checklist Ada
- [x] bundle-check ejecutado ANTES — main: 11MB, renderer: 60KB
- [x] Named imports verificados: sin `import * as x` en archivos de la feature (solo src/client.ts que es fuera de scope)
- [x] Dependencias muertas verificadas con grep — todos los imports del monitor en handlers.ts se usan
- [x] Fire-and-forget preservado: getAgentTimeline no tiene await a subproceso externo (SQLite sincrono, patron correcto)
- [x] bundle-check ejecutado DESPUES — main: 11MB, renderer: 59KB
- [x] Sin cambios de comportamiento observable (no regresiones)

### No optimizado por Ada
- `timelineRepository.ts` — prepared statement se recompila en cada llamada porque `db.prepare()` se ejecuta dentro de la funcion. Podria cachearse como constante del modulo. No aplicado: el handler se invoca on-demand (click del usuario), no en bucle critico — el overhead es despreciable y requereria refactorizacion mayor del patron establecido en todos los repositories.
- `renderLineChart` — constantes SVG (`SVG_W`, `SVG_H`, etc.) declaradas dentro de la funcion. No extraidas: son parte de una funcion pura de render sin estado, la claridad del codigo vale mas que el micro-ahorro de no re-declarar constantes numericas en cada llamada.

Confianza en las optimizaciones: alta

## Optimizaciones aplicadas

- `src/monitor/ui/monitor-view.ts:677-686` — `restoreExpandedCharts()`: la rama sin cache ahora llama `loadAgentCharts(agentId)` en lugar de solo `display:block`. Fix del Issue #1 de Max — el spinner congelado tras re-render mid-IPC ya no es posible: `loadAgentCharts` relanza el IPC si el cache no existe, y lo sirve desde cache si la peticion anterior ya completo.
- `src/monitor/ui/monitor-view.ts:737-753` — `onAgentGridClick()`: se reutiliza la referencia del `closest<HTMLButtonElement>` en lugar de hacer un segundo `container.querySelector` para actualizar el texto del boton. Elimina 1 query DOM por click.
- `src/ipc/handlers.ts:23-25` — extraida constante de modulo `VALID_AGENTS` con tipo `as const`. Elimina la duplicacion entre el handler `getHistory` (literal inline en linea 210) y `getAgentTimeline` (const local en linea 261). Ahora ambos usan la misma fuente de verdad. Tipo derivado `ValidAgentId` generado desde la constante.
- `src/monitor/ui/monitor-styles.css:423-431` — `.monitor-chart-loading` y `.monitor-chart-empty` tenian exactamente los mismos 5 estilos. Colapsadas en selector combinado. Elimina 7 lineas de CSS duplicado.

## Metricas comparativas
- Bundle antes: main 11MB, renderer 60KB
- Bundle despues: main 11MB, renderer 59KB
- Delta renderer: -1KB (CSS colapsado + JS minificado mas compacto)
- Delta main: 0 (cambios en handlers.ts son refactor sin nuevas dependencias)

## Pendientes para futuras iteraciones
- `timelineRepository.ts` — `db.prepare()` dentro de la funcion: si se quiere un patron consistente con cache de prepared statements, refactorizar al patron factory (pasar `stmt` preparado al modulo). No urgente dado el uso on-demand.
- Gap 1 de Leo/Cloe (ancho SVG 280px vs card 200px): no verificable sin runtime browser. No es una optimizacion de Ada — es un ajuste visual pendiente de validacion manual.

## Archivos para auditoria de Cipher
| Archivo | Lineas relevantes | Razon |
|---------|-------------------|-------|
| src/monitor/core/timelineRepository.ts | 1-35 | nueva query SQLite con prepared statement |
| src/types/ipc.ts | 272-290 | tipos nuevos AgentTimelinePoint, GetAgentTimelineParams, GetAgentTimelineResult |
| src/ipc/handlers.ts | 23-25, 213-215, 263-278 | nueva constante VALID_AGENTS, handler getAgentTimeline con whitelist |
| src/renderer/app.ts | 103-104 | quinto argumento a renderMonitor con (rpc as any) |
| src/monitor/ui/monitor-view.ts | 120-248, 650-686, 737-753 | funciones SVG inline, loadAgentCharts, restoreExpandedCharts, onAgentGridClick |

→ Siguiente: @cipher Audita la feature antes del release. Ver docs/features/graficas-evolucion-metricas-agentes/status.md seccion "Handoff Ada → Cipher".

## Metricas de Ada
- archivos_leidos: 9
- archivos_modificados: 3
- bundle_antes_mb: main 11MB / renderer 60KB
- bundle_despues_mb: main 11MB / renderer 59KB
- optimizaciones_aplicadas: 4
- optimizaciones_descartadas: 2
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 2

---

## Resultado de Cipher

### Checklist Cipher
- [x] Sin secrets en codigo fuente — evidencia: scan limpio sobre timelineRepository.ts, ipc.ts, handlers.ts, monitor-view.ts, monitor-styles.css, app.ts
- [x] .env en .gitignore y no commiteado — evidencia: .gitignore:23 cubre .env; git log -- .env sin commits en esta rama
- [x] agentName validado con /^[a-z0-9-]+$/ antes de path.join — evidencia: no aplica en esta feature; agentId va exclusivamente a prepared statement SQL, nunca a path.join
- [x] Inputs del webview validados antes de filesystem ops — evidencia: handlers.ts:265-266 VALID_AGENTS whitelist sobre params?.agentId antes de cualquier operacion DB; esta feature no tiene filesystem ops
- [x] Spawn de agentes usa rutas absolutas, no interpolacion de user input — evidencia: no aplica; esta feature no incluye spawn
- [x] Sin innerHTML con user input sin sanitizar — evidencia: monitor-view.ts:220 escapeHtml(label) en etiqueta SVG eje X; monitor-view.ts:725 escapeHtml(e) en errores de parseo; datos numericos y enum no requieren escapeHtml; sin interpolacion de user input en template literals SVG
- [x] DevTools deshabilitados en build de produccion — evidencia: pre-existente, auditado en devtools-csp-produccion; no modificado por esta feature
- [x] CSP configurado en el webview — evidencia: pre-existente, auditado en devtools-csp-produccion; no modificado por esta feature
- [x] No se expone process.env completo al renderer via IPC — evidencia: grep limpio en todos los archivos de la feature; sin acceso a process.env en ninguno de ellos
- [x] Cierre limpio de subprocesos al cerrar la app — evidencia: no aplica; esta feature es exclusivamente IPC + SQLite sincrono + renderer DOM

### Puntos de atencion verificados

**1. Prepared statement con ? posicional (timelineRepository.ts:17-23)**
Evidencia: db.prepare usa el placeholder `?` como unico sustituto de agentId. El valor viaja como parametro de stmt.all(agentId), nunca dentro del string SQL. SQL injection no posible.

**2. VALID_AGENTS whitelist en handlers.ts:24,265-266**
Evidencia: constante de modulo `as const` en linea 24. Guard `(VALID_AGENTS as readonly string[]).includes(agentId)` en linea 266 — agotamiento completo antes de getHistoryDb(). Handler nunca lanza: try/catch en lineas 271-277 retorna `{ agentId, points: [] }` en todos los paths de error.

**3. escapeHtml() en SVG labels (monitor-view.ts:220)**
Evidencia: `escapeHtml(label)` sobre el slug truncado antes de emitir en el texto SVG. La implementacion en lineas 335-341 cubre &, <, >, " — suficiente para contexto de texto SVG inline en innerHTML.

**4. s.agentId en atributos HTML (monitor-view.ts:294,321,324)**
`data-agent`, `data-agent-toggle`, `id="mon-charts-..."` — agentId proviene de agentSummaries del PipelinePoller, que lee nombres de directorio del repo. Nunca es input del usuario externo. El mismo patron fue analizado y aceptado en monitor-pipeline-agentes para slug en title=. Aceptado con la misma justificacion: filesystem local controlado por el propio repo, en produccion docs/ no existe.

**5. Campos AgentTimelinePoint — ASCII puro en IPC**
Evidencia: itemSlug (a-z0-9-), itemType (literal 'feature'|'bug'), rework/iteraciones/confianza (numeros o null), recordedAt (ISO 8601 solo digitos y -T:.Z). Ningun campo puede contener chars fuera de 0x20-0x7E. El handler getHistory requiere sanitizacion adicional porque itemTitle/fromValue/toValue son texto libre — getAgentTimeline no tiene ese caso.

**6. Path traversal — no posible**
Evidencia: agentId solo se usa en stmt.all(agentId) (timelineRepository.ts:25) y como clave de respuesta IPC. No se construye ninguna ruta de filesystem con agentId en esta feature. La whitelist VALID_AGENTS es defensa adicional que garantiza que los 5 valores del pipeline son los unicos que alcanzan la DB.

**7. Sin nuevas dependencias externas**
Evidencia: timelineRepository.ts importa solo bun:sqlite y tipos de ipc.ts. monitor-view.ts importa solo tipos de ipc.ts. Ada confirmo bundle renderer -1KB tras la feature.

**Vulnerabilidades encontradas:** Ninguna.

### Riesgos aceptados por Cipher
- s.agentId sin escapeHtml en atributos data-agent, data-agent-toggle, id="mon-charts-..." en monitor-view.ts:294,321,324: agentId es string del filesystem del propio repo, nunca input del usuario externo. En produccion docs/ no existe y agentSummaries estara vacio. Mismo riesgo aceptado en monitor-pipeline-agentes para slug en title=. Impacto bajo.

Confianza en la auditoria: alta

**Decision:** APROBADO

## Metricas de Cipher
- archivos_leidos: 6
- vulnerabilidades_criticas: 0
- vulnerabilidades_altas: 0
- vulnerabilidades_medias: 0
- vulnerabilidades_bajas: 0
- riesgos_aceptados: 1
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0
- decision: APROBADO

---

Estado final: APROBADO
