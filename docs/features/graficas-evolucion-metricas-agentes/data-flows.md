# Flujos de datos — graficas-evolucion-metricas-agentes

## Flujo principal: usuario expande graficas de un agente

```
[Usuario hace click en "Ver graficas" en card de agente X]
    |
    v
[monitor-view.ts]
    expandedAgents.has(agentId) ? collapse : expand
    Si expand y NO tiene datos en chartsCache:
    |
    v
onGetAgentTimeline({ agentId })  <-- callback IPC del renderer
    |
    v [IPC: renderer -> main]
[handlers.ts :: getAgentTimeline]
    |-- validar agentId en whitelist VALID_AGENTS
    |-- getHistoryDb() -> db | null
    |-- si null: return { agentId, points: [] }
    |
    v
[timelineRepository.ts :: queryAgentTimeline(db, agentId)]
    |
    SELECT agent_id, item_slug, item_type,
           rework, iteraciones, confianza, recorded_at
    FROM agent_metrics_history
    WHERE agent_id = ?
    ORDER BY recorded_at ASC
    |
    mapear filas a AgentTimelinePoint[]
    (confianza: 'alta'->3, 'media'->2, 'baja'->1, null->null)
    (rework: 1->1, 0->0, null->null)
    |
    v [IPC: main -> renderer]
[monitor-view.ts]
    chartsCache.set(agentId, result.points)
    renderAgentCharts(container, agentId, points)
    |
    v
[renderAgentCharts()]
    Para cada metrica en ['rework', 'iteraciones', 'confianza']:
    |-- renderLineChart(points, metric) -> string SVG
    Inyectar en #mon-chart-<agentId> via innerHTML
```

## Flujo secundario: snapshot actualiza cards sin borrar graficas expandidas

```
[poller emite snapshot -> monitor:snapshot DOM event]
    |
    v
[updateSnapshot(snapshot)]
    agentsGridEl.innerHTML = ...  <-- PROBLEMA: borra el DOM de graficas

SOLUCION: updateSnapshot reconstruye cada card pero verifica si el agente
estaba expandido en expandedAgents (Set local), y si es asi,
adjunta el contenedor de graficas al nuevo card.

Alternativa mas simple: updateSnapshot NO re-renderiza las cards de agentes
si el tab de agentes no esta activo. Si esta activo, re-renderiza pero
reinyecta el SVG desde chartsCache (que ya tiene los datos en memoria).
```

## Estructura del SVG generado (por metrica)

```
<svg viewBox="0 0 280 100" width="280" height="100">
  <!-- Eje X -->
  <line x1="30" y1="80" x2="260" y2="80" stroke="#333" />
  <!-- Eje Y -->
  <line x1="30" y1="10" x2="30" y2="80" stroke="#333" />
  <!-- Etiquetas Y -->
  <text x="25" y="14" text-anchor="end" font-size="8" fill="#666">max</text>
  <text x="25" y="82" text-anchor="end" font-size="8" fill="#666">0</text>
  <!-- Linea de datos (polyline) -->
  <polyline points="x1,y1 x2,y2 ..." fill="none" stroke="#4a9eff" stroke-width="1.5" />
  <!-- Puntos -->
  <circle cx="x1" cy="y1" r="3" fill="#4a9eff" />
  <!-- Etiqueta X (slug truncado) -->
  <text x="x1" y="95" text-anchor="middle" font-size="7" fill="#555">slug...</text>
  <!-- Titulo de la grafica -->
  <text x="155" y="8" text-anchor="middle" font-size="9" fill="#888">Rework</text>
</svg>
```

## Coordenadas SVG

- Area util: x: 30..260 (230px), y: 15..80 (65px)
- N puntos equidistantes en el eje X
- Eje Y: valor normalizado (0..1 para rework, 0..maxY para iteraciones, 0..3 para confianza)
- Formula: y = 80 - ((valor / maxY) * 65)
- Puntos con null: se omiten de la polyline (no se conectan con una linea)
- Si todos los puntos son null: se muestra "Sin datos" centrado en el SVG

## Cache de series temporales

```
chartsCache: Map<agentId, AgentTimelinePoint[]>
expandedAgents: Set<agentId>
```

- Cache vive en el closure de renderMonitor() — se invalida al hacer cleanup().
- Se rellena on-demand (primera vez que se expande un agente).
- NO se invalida con snapshots nuevos — las graficas no cambian con cada poll de 30s.
  Solo cambiarian si se detectan nuevas metricas_updated. Para v1 esto es aceptable:
  el usuario puede cerrar y reabrir la seccion para refrescar (o usar el boton Actualizar).
