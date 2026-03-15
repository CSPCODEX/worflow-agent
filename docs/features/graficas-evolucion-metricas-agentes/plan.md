# Plan — Graficas de evolucion de metricas de agentes

## Objetivo

Añadir graficas SVG inline debajo de las cards de agentes en el tab Agentes del monitor.
Cada agente tiene una grafica con 3 series: rework (0/1 por feature), iteraciones (numero), confianza (1/2/3).
Eje X = features ordenadas por recorded_at. Eje Y = escala fija por metrica.

## Diagnostico del estado actual

### Que ya existe y funciona

- `agent_metrics_history` (SQLite): `agent_id, item_type, item_slug, rework, iteraciones, confianza, gaps_declarados, recorded_at` — contiene exactamente los datos necesarios.
- `queryAgentTrends` en `historyRepository.ts`: devuelve PROMEDIOS historicos (no series temporales). NO sirve para graficar.
- IPC: canal `getAgentTrends` ya existe en `AppRPC`. Sus params son `undefined` y retorna `GetAgentTrendsResult { trends: AgentTrendIPC[] }`.
- UI: `renderMonitor()` en `monitor-view.ts` llama `onGetAgentTrends()` al activar el tab Agentes y guarda en `trendsMap`. Las cards ya tienen acceso a ese mapa.

### Que falta

1. Una query nueva `queryAgentTimeline(db, agentId)` que devuelva filas ordenadas por fecha — una por (agente, feature).
2. Un nuevo canal IPC `getAgentTimeline` que reciba `{ agentId: string }` y retorne la serie temporal.
3. Tipos IPC nuevos: `GetAgentTimelineParams`, `AgentTimelinePoint`, `GetAgentTimelineResult`.
4. Funcion SVG `renderAgentChart(points, metric)` en `monitor-view.ts` que genere SVG inline.
5. HTML/CSS debajo de las cards con la seccion de graficas.

### Decision arquitectonica: canal IPC nuevo vs extender getAgentTrends

Opcion A (extender getAgentTrends): anadir campo `timeline` al `AgentTrendIPC`. Problema: el payload creceria para todos los agentes al mismo tiempo, sin posibilidad de filtrar por agente.

Opcion B (canal nuevo `getAgentTimeline` con param `agentId`): el renderer pide la serie de UN agente a la vez, solo cuando el usuario abre su seccion de grafica. Mas eficiente, mas cohesivo con el patron on-demand ya establecido para historial y trends.

**Decision: Opcion B — canal `getAgentTimeline { agentId }`.** Las graficas se renderizan on-demand cuando el usuario expande la seccion de un agente.

### Layout — seccion de graficas colapsable vs siempre visible

Con 5 agentes y 3 graficas cada uno, mostrar todo siempre seria ruidoso y consumiria mucho espacio.
Decision: seccion colapsable por agente — un boton "Ver graficas" debajo de cada card. Al hacer click, se expande la seccion con las 3 graficas SVG. Se colapsa al volver a hacer click. El estado de expansion vive en una variable local del renderer (no persiste entre sesiones — no hay necesidad).

### Tipo de grafica — line chart SVG

- SVG inline generado desde TypeScript como string.
- Dimensiones fijas: 280px x 100px por grafica (caben en el layout de 200px min de la card grid).
- Sin Canvas, sin librerias externas.
- Eje X: indices 0..N-1, etiqueta = item_slug truncado a 8 chars.
- Eje Y: escala fija por metrica:
  - Rework: 0 a 1 (boolean normalizado)
  - Iteraciones: 0 a max(iteraciones) del agente, minimo 5
  - Confianza: 0 a 3 (baja=1, media=2, alta=3)
- Puntos: circulos de r=3. Linea de conexion con polyline.
- Sin frameworks ni librerías DOM — solo template literals de strings SVG.

## Estructura de archivos

### Archivos a crear
- `src/monitor/core/timelineRepository.ts` — nueva query `queryAgentTimeline`

### Archivos a modificar
- `src/types/ipc.ts` — 3 tipos nuevos + canal `getAgentTimeline` en `AppRPC`
- `src/ipc/handlers.ts` — handler `getAgentTimeline`
- `src/monitor/index.ts` — re-exportar `queryAgentTimeline`
- `src/monitor/ui/monitor-view.ts` — seccion de graficas con SVG
- `src/monitor/ui/monitor-styles.css` — estilos de graficas y seccion colapsable

## Orden de implementacion

1. `src/monitor/core/timelineRepository.ts`
2. `src/monitor/index.ts` (re-export)
3. `src/types/ipc.ts` (tipos + canal)
4. `src/ipc/handlers.ts` (handler)
5. `src/monitor/ui/monitor-view.ts` (UI + SVG)
6. `src/monitor/ui/monitor-styles.css` (estilos)
