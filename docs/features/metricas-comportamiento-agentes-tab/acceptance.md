# Criterios de aceptacion — metricas-comportamiento-agentes-tab

## behaviorParser.ts

- [ ] `parseBehaviorMetrics(content, agentId, repoRoot)` retorna `AgentBehaviorMetrics` con todos los campos nulables
- [ ] Si `repoRoot` es undefined/falsy, hallucinationRefsTotal/Valid son null (no crashea)
- [ ] Checklist items contados correctamente: `- [x]` vs `- [ ]` (case insensitive para X)
- [ ] Secciones obligatorias correctas por agente: Leo 2, Cloe 2, Max 2, Ada 2, Cipher 2
- [ ] File refs deduplicadas antes de verificar existencia
- [ ] Solo se verifican refs en el bloque del handoff del agente especifico (no en todo el status.md)
- [ ] Memory read detecta `MEMORY.md` y `agent-memory` en el bloque del handoff
- [ ] Handoff incompleto (isPlaceholder=true) -> memoryRead = null
- [ ] Funcion pura: no tiene efectos secundarios, no modifica el FS

## historyDb.ts migration v2

- [ ] Migration v2 CREATE TABLE IF NOT EXISTS agent_behavior_history con todos los campos
- [ ] Tres indices creados (agent_id, item_type+item_slug)
- [ ] Idempotente: ejecutar dos veces no crashea

## changeDetector.ts

- [ ] `DetectedChanges.newBehavior` contiene entradas cuando aparecen datos de comportamiento por primera vez
- [ ] No genera entradas duplicadas si el comportamiento ya estaba en el snapshot previo
- [ ] Logica de deteccion: comportamiento tiene "datos" si alguno de los campos no es null

## historyRepository.ts

- [ ] `persistChanges()` inserta en `agent_behavior_history` cuando `changes.newBehavior.length > 0`
- [ ] Transaccion atomica: behavior se inserta junto con events y metrics
- [ ] `queryAgentBehaviorTimeline(db, agentId)` retorna filas ordenadas ASC por recorded_at

## types.ts (monitor core)

- [ ] `AgentBehaviorMetrics` tiene todos los campos definidos en el plan
- [ ] `FeatureRecord.behaviorMetrics` es `Partial<Record<AgentId, AgentBehaviorMetrics>>`
- [ ] `AgentSummary` tiene los 4 campos de comportamiento agregados

## statusParser.ts

- [ ] `parseFeatureStatus()` acepta cuarto parametro `repoRoot: string`
- [ ] Llama a `parseBehaviorMetrics()` para cada agente y agrega al FeatureRecord
- [ ] Backward compat: si repoRoot es '' o undefined, refs verification devuelve null

## aggregator.ts

- [ ] `buildSnapshot()` acepta segundo parametro `repoRoot: string`
- [ ] `computeAgentSummaries()` calcula avgChecklistRate, avgStructureScore, avgHallucinationRate, memoryReadRate
- [ ] Campos con null cuando no hay datos suficientes (sin division por cero)

## poller.ts

- [ ] `MonitorConfig` tiene campo `repoRoot?: string`
- [ ] `scan()` propaga `repoRoot` a `buildSnapshot()`

## src/types/ipc.ts

- [ ] `AgentBehaviorMetricsIPC` tipado correctamente con todos los campos
- [ ] `AgentBehaviorPointIPC` tiene todos los campos para graficas
- [ ] `FeatureRecordIPC.behaviorMetrics` presente
- [ ] `AgentSummaryIPC` tiene los 4 campos de comportamiento
- [ ] Canal `getAgentBehaviorTimeline` registrado en AppRPC.bun.requests

## src/ipc/handlers.ts

- [ ] Handler `getAgentBehaviorTimeline` implementado con whitelist de agentId
- [ ] `snapshotToIPC()` propaga behaviorMetrics sin exponer filePath
- [ ] `snapshotToIPC()` sanitiza strings de comportamiento a ASCII
- [ ] `repoRoot = path.dirname(docsDir)` calculado a partir de docsDir existente
- [ ] `repoRoot` pasado en la construccion del PipelinePoller

## monitor-view.ts

- [ ] `renderMonitor()` acepta 7mo parametro `onGetAgentBehaviorTimeline`
- [ ] `renderAgentCard()` muestra las 4 metricas de comportamiento (con '--' si null)
- [ ] Seccion "Comportamiento" colapsable por agente en el panel agents
- [ ] Cache `behaviorCache: Map<agentId, AgentBehaviorPointIPC[]>`
- [ ] Datos de comportamiento no se pierden al re-renderizar las cards (mismo patron que chartsCache)
- [ ] Todos los strings de comportamiento pasados por `escapeHtml()` antes de insertar en innerHTML

## src/renderer/app.ts

- [ ] `showMonitor()` pasa el 7mo callback a `renderMonitor()`
- [ ] El callback hace `rpc.request.getAgentBehaviorTimeline(params)`

## Integracion global

- [ ] `bun run desktop` arranca sin errores de TypeScript
- [ ] Tab "Agentes" en el Monitor muestra las nuevas metricas de comportamiento
- [ ] Sin regresiones en los tabs Pipeline, Errores e Historial existentes
- [ ] El flujo CLI (`bun run dev`, `bun run chat`) no se ve afectado
- [ ] Strings ASCII-safe en todo lo que viaja por IPC (no se rompe en Windows)
