# Criterios de aceptacion — graficas-evolucion-metricas-agentes

## Backend (timelineRepository.ts + handlers.ts)

- [ ] `queryAgentTimeline(db, agentId)` retorna filas de `agent_metrics_history` para ese agente ordenadas ASC por `recorded_at`
- [ ] Confianza mapeada: `'alta' -> 3, 'media' -> 2, 'baja' -> 1, null -> null`
- [ ] Rework mapeado: `1 -> 1, 0 -> 0, null -> null` (es numero 0/1, no boolean en SQLite)
- [ ] Handler `getAgentTimeline` valida `agentId` contra whitelist `['leo','cloe','max','ada','cipher']`
- [ ] Handler retorna `{ agentId, points: [] }` si DB no disponible o agentId invalido — no lanza
- [ ] Handler sanitiza strings con `/[^\x20-\x7E]/g` (no hay strings no-ASCII en estos campos, pero por consistencia)
- [ ] `queryAgentTimeline` usa prepared statement — no interpolacion de strings con el agentId
- [ ] Canal `getAgentTimeline` tipado en `AppRPC` con params y response correctos
- [ ] Re-exportado desde `src/monitor/index.ts`

## UI (monitor-view.ts)

- [ ] `renderMonitor()` recibe cuarto parametro `onGetAgentTimeline: (p: GetAgentTimelineParams) => Promise<GetAgentTimelineResult>`
- [ ] Boton "Ver graficas" aparece debajo de cada card de agente en el tab Agentes
- [ ] Click en boton alterna estado expandido/colapsado (Set `expandedAgents`)
- [ ] Primera expansion dispara IPC `getAgentTimeline` y guarda resultado en `chartsCache`
- [ ] Segunda expansion usa `chartsCache` directamente (sin IPC adicional)
- [ ] Si `points.length === 0`, muestra mensaje "Sin datos historicos para este agente"
- [ ] Si `points.length === 1`, se muestra punto sin linea (polyline de un punto es un punto)
- [ ] Si todos los valores de una metrica son null, el SVG muestra "Sin datos" centrado
- [ ] Tres graficas SVG por agente: Rework, Iteraciones, Confianza
- [ ] Eje Y correcto por metrica: Rework 0-1, Iteraciones 0-max(min 5), Confianza 0-3
- [ ] Puntos con null NO se conectan a la linea de la polyline
- [ ] Labels del eje X: slug truncado a 8 caracteres con "..." si es mas largo
- [ ] SVG generado solo con template literals de string — sin DOM APIs, sin canvas, sin librerias

## Consistencia con snapshot updates

- [ ] Cuando `updateSnapshot()` reconstruye las cards de agentes, los agentes que estaban en `expandedAgents` mantienen su estado expandido
- [ ] La reconstruccion de cards usa `chartsCache` si ya tiene datos (no re-hace IPC)
- [ ] El cleanup de `renderMonitor()` limpia `expandedAgents` y `chartsCache` (o simplemente el GC los recoge al salir del scope)

## Estilos (monitor-styles.css)

- [ ] Prefijo `.monitor-` en todos los selectores nuevos
- [ ] Seccion de graficas: fondo ligeramente diferenciado de la card (`#161616`)
- [ ] Boton "Ver graficas" visualmente consistente con `.monitor-btn-page`
- [ ] Las 3 graficas se muestran en fila horizontal (flexbox) — se adaptan al ancho de la card
- [ ] El SVG tiene `overflow: visible` para que las etiquetas del eje X no se corten

## Integracion con app.ts

- [ ] `app.ts` pasa el cuarto callback `onGetAgentTimeline` a `renderMonitor()` usando el canal IPC tipado
- [ ] La firma completa de `renderMonitor()` es compatible con el call site en `app.ts`
