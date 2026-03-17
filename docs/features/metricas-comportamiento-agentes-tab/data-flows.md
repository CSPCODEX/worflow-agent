# Flujos de datos — metricas-comportamiento-agentes-tab

## Flujo 1: Scan del poller con verificacion de comportamiento

```
PipelinePoller.scan()
  |
  v
buildSnapshot(docsDir, repoRoot)   [aggregator.ts — NEW param]
  |
  +-> readdirSync(docs/features/)
  |     para cada slug:
  |       parseFeatureStatus(content, slug, filePath, repoRoot)  [NEW param]
  |         |
  |         +-> parseHandoffs(content)              [sin cambios]
  |         +-> parseAgentMetrics(content, agentId) [sin cambios]
  |         +-> parseBehaviorMetrics(content, agentId, repoRoot)  [NEW — behaviorParser.ts]
  |               |
  |               +-> extractHandoffSection(content, agentId)
  |               |     -> substring entre "## Handoff X ->" y siguiente "##"
  |               |
  |               +-> countChecklistItems(section)
  |               |     -> regex /- \[[ x]\]/gi
  |               |
  |               +-> scoreStructure(section, agentId)
  |               |     -> check presence of required headers per agent
  |               |
  |               +-> extractFileRefs(section)
  |               |     -> regex /\bsrc\/[a-zA-Z0-9\/_.-]+\.(ts|js|md)\b/g
  |               |     -> para cada ref: existsSync(path.join(repoRoot, ref))
  |               |
  |               +-> detectMemoryRead(section, agentId)
  |                     -> regex /MEMORY\.md|agent-memory/i
  |
  +-> computeAgentSummaries(features, bugs)  [modificado — promedia behavior]
  |
  v
PipelineSnapshot (con behaviorMetrics en cada FeatureRecord)
  |
  v
detectChanges(prev, curr)  [changeDetector.ts — modificado]
  |
  +-> newBehavior: AgentBehaviorEntry[]  [NEW — similar a newMetrics]
  |
  v
persistChanges(db, changes)  [historyRepository.ts — modificado]
  |
  +-> INSERT INTO agent_behavior_history (migration v2)
```

## Flujo 2: Snapshot al IPC

```
handlers.ts :: getPipelineSnapshot
  |
  v
poller.getSnapshot()
  |
  v
snapshotToIPC(snapshot)   [modificado]
  |
  +-> features.map() incluye behaviorMetrics (omite filePath como ya hace)
  |   behaviorMetrics sanitizado con sanitizeForIpc() en strings
  |
  +-> agentSummaries.map() incluye avgChecklistRate, avgStructureScore, etc.
  |
  v
PipelineSnapshotIPC  -->  rpc.send.pipelineSnapshotUpdated()
                              o retorno de getPipelineSnapshot
```

## Flujo 3: Grafica de comportamiento on-demand

```
Renderer: activateTab('agents')
  |
  v
loadAgentBehaviorTimelines(agentIds)
  para cada agentId:
    onGetAgentBehaviorTimeline({ agentId })
      |
      v [IPC]
    handlers.ts :: getAgentBehaviorTimeline
      |
      v
    queryAgentBehaviorTimeline(db, agentId)  [NEW — behaviorTimelineRepository.ts]
      |
      v
    SELECT * FROM agent_behavior_history WHERE agent_id = ?
    ORDER BY recorded_at ASC
      |
      v
    AgentBehaviorPointIPC[]
      |
      v [IPC response]
    renderer :: behaviorCache.set(agentId, points)
    renderBehaviorSection(agentId, points)  [en monitor-view.ts]
```

## Flujo 4: Config del poller — como llega repoRoot

```
src/ipc/handlers.ts (top-level scope)
  |
  findDocsDir()  [ya existe, sube hasta 6 niveles]
  |
  docsDir = "D:/work/worflow-agent/docs"
  |
  repoRoot = path.dirname(docsDir)   [NEW — simple derivacion]
  |
  new PipelinePoller({
    docsDir,
    pollIntervalMs: 30_000,
    historyDbPath,
    repoRoot,   // NEW — opcional en MonitorConfig
  })
  |
  en poller.scan():
    buildSnapshot(this.docsDir, this.repoRoot)
```

## Flujo 5: DB schema — migration v2

```
agent_behavior_history (nueva tabla)
  id                     INTEGER PRIMARY KEY AUTOINCREMENT
  agent_id               TEXT NOT NULL
  item_type              TEXT NOT NULL   -- 'feature' | 'bug'
  item_slug              TEXT NOT NULL
  checklist_total        INTEGER         -- null si no aplica (agente sin checklist formal)
  checklist_checked      INTEGER         -- null si no aplica
  structure_score_num    INTEGER         -- numerador (secciones encontradas)
  structure_score_den    INTEGER         -- denominador (secciones esperadas)
  refs_total             INTEGER         -- file refs declaradas
  refs_valid             INTEGER         -- file refs que existen
  memory_read            INTEGER         -- 0/1/null
  recorded_at            TEXT NOT NULL   -- ISO 8601

Indices:
  CREATE INDEX IF NOT EXISTS idx_abh_agent ON agent_behavior_history(agent_id);
  CREATE INDEX IF NOT EXISTS idx_abh_item  ON agent_behavior_history(item_type, item_slug);
```

Nota sobre numerador/denominador: se almacenan los valores raw para permitir calculos
derivados en el futuro. El rate (num/den) se calcula al leer, no al escribir.

## Flujo 6: Verificacion de file refs

```
extractHandoffSection(content, agentId):
  busca la seccion entre "## Handoff <From> ->" y el proximo "##"
  (ejemplo para leo: seccion entre "## Handoff Leo → Cloe" y "## Metricas de Leo")

extractFileRefs(section):
  regex: /\bsrc\/[a-zA-Z0-9\/_.-]+\.(ts|js|md)\b/g
  deduplica antes de verificar (un mismo path mencionado varias veces cuenta una sola vez)

Para cada ref:
  existsSync(path.join(repoRoot, ref))

Resultado: { refsTotal: number, refsValid: number }

Caso repoRoot vacio o undefined:
  -> refsTotal = null, refsValid = null (no verificacion sin repoRoot)
```
