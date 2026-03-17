# Plan — Metricas de comportamiento de agentes en tab Agentes

## Problema

El sistema actual mide *resultados del proyecto* (rework, iteraciones, confianza, gaps) extraidos
del bloque "Metricas de X" de cada status.md — todos auto-reportados por el agente.

Las 4 preguntas que esta feature debe poder responder son:

1. **Checklist adherence**: en el checklist del handoff Leo, cuantos items estan marcados [x]
   vs cuantos existen en total. La diferencia entre items declarados [x] y los realmente ejecutables
   (que tienen evidencia verificable) es una medida de adherencia real.

2. **Determinismo estructural**: dado un mismo tipo de output (ej: handoff Leo->Cloe), la estructura
   del texto producido es consistente entre features? Se mide via presencia/ausencia de secciones
   obligatorias (Checklist Leo, Gaps y dudas de Leo, Metricas de Leo).

3. **Hallucination rate**: cuantos file:line references declarados en el status.md (pattern
   `src/path/file.ts` o `src/path/file.ts:N`) realmente existen en el filesystem al momento del scan.

4. **Memory read flag**: el agente declaro explicitamente haber leido su archivo de memoria
   (pattern `.claude/agent-memory/<agente>/MEMORY.md` o `MEMORY.md` mencionado en el status.md
   de la feature antes del handoff completado).

## Fuente de datos

**Todas las metricas de comportamiento son calculadas en el main process durante el scan del poller**,
no auto-reportadas. El parser extrae o verifica evidencia del filesystem:

| Metrica | Fuente | Verificacion externa |
|---|---|---|
| checklist_items_total | status.md parsing | Conteo de `- [ ]` y `- [x]` en la seccion Checklist del handoff |
| checklist_items_checked | status.md parsing | Conteo de `- [x]` en la misma seccion |
| checklist_adherence_rate | calculado | checked / total (0.0-1.0) |
| structure_score | status.md parsing | Presencia de N secciones obligatorias (0-4 para Leo) |
| hallucination_rate | filesystem verification | file refs declaradas vs existentes en disco |
| memory_read | status.md parsing | Mencion de `MEMORY.md` o `agent-memory` antes del handoff |

## Arquitectura — donde vive cada pieza

### Capa de extraccion (main process — monitor core)

Nuevo archivo: `src/monitor/core/behaviorParser.ts`
- Funcion pura, no imports externos al modulo
- Recibe `content: string` (contenido del status.md) y `agentId: AgentId`
- Recibe `repoRoot: string` para verificar file refs en el filesystem
- Retorna `AgentBehaviorMetrics`

Modificacion: `src/monitor/core/types.ts`
- Añadir interfaz `AgentBehaviorMetrics`
- Añadir campo `behaviorMetrics: Partial<Record<AgentId, AgentBehaviorMetrics>>` a `FeatureRecord`

Modificacion: `src/monitor/core/statusParser.ts`
- `parseFeatureStatus()` recibe parametro adicional `repoRoot: string`
- Llama a `behaviorParser.ts` para calcular el comportamiento por agente

Modificacion: `src/monitor/core/aggregator.ts`
- `buildSnapshot()` recibe `repoRoot` y lo propaga a `parseFeatureStatus()`
- `computeAgentSummaries()` incluye promedios de comportamiento en `AgentSummary`

Modificacion: `src/monitor/core/poller.ts`
- `MonitorConfig` ya tiene `docsDir` — añadir `repoRoot?: string`
- En `scan()`, propagar `repoRoot` a `buildSnapshot()`

### Capa de persistencia (monitor core — historyDb)

Modificacion: `src/monitor/core/historyDb.ts`
- Migration v2: nueva tabla `agent_behavior_history`
- Campos: `id, agent_id, item_type, item_slug, checklist_total, checklist_checked,
  structure_score, hallucination_refs_total, hallucination_refs_valid,
  memory_read (0/1/null), recorded_at`

Modificacion: `src/monitor/core/changeDetector.ts`
- `DetectedChanges` añade `newBehavior: AgentBehaviorEntry[]`
- Detecta cuando aparecen comportamiento datos nuevos (igual logica que newMetrics)

Modificacion: `src/monitor/core/historyRepository.ts`
- `persistChanges()` tambien inserta en `agent_behavior_history`
- Nueva funcion `queryAgentBehaviorTimeline(db, agentId): AgentBehaviorPoint[]`

### Capa IPC

Modificacion: `src/types/ipc.ts`
- Nuevos tipos: `AgentBehaviorMetricsIPC`, `AgentBehaviorPointIPC`
- `FeatureRecordIPC` añade `behaviorMetrics: Partial<Record<string, AgentBehaviorMetricsIPC>>`
- `AgentSummaryIPC` añade campos de comportamiento agregados
- Nuevo canal: `getAgentBehaviorTimeline: { params: { agentId: string }; response: { points: AgentBehaviorPointIPC[] } }`

Modificacion: `src/ipc/handlers.ts`
- Handler `getAgentBehaviorTimeline` (sync SQLite, no fire-and-forget)
- `snapshotToIPC()` propaga `behaviorMetrics`

### Capa UI

Modificacion: `src/monitor/ui/monitor-view.ts`
- `renderMonitor()` recibe un callback adicional `onGetAgentBehaviorTimeline`
- `renderAgentCard()` añade fila de comportamiento (checklist %, structure score, hallucination %)
- Nueva seccion colapsable "Comportamiento" debajo de las graficas SVG existentes
- Grafica adicional de comportamiento o tabla de datos por feature

Modificacion: `src/renderer/app.ts`
- Pasar el nuevo callback a `renderMonitor()`

### Capa CSS

Modificacion: `src/renderer/monitor-styles.css` (si existe separado) o nuevo archivo
- Clases para los indicadores de comportamiento

## Arquitectura de datos — que se verifica como

### 1. Checklist adherence

El bloque de checklist de Leo tiene esta estructura en status.md:
```
### Checklist Leo
- [x] Cada archivo a crear/modificar tiene ruta absoluta...
- [x] Contratos IPC escritos...
- [ ] tsconfig flags...
```

`behaviorParser.ts` busca la seccion `### Checklist <Agent>` dentro del bloque de handoff
del agente (entre `## Handoff X -> Y` y el siguiente `##`) y cuenta `- [x]` vs total items `- [ ]`.

Para agentes que no tienen checklist formal (Cloe, Max, Ada, Cipher no tienen `### Checklist X`
en su handoff), el campo es `null`.

### 2. Structure score

Cada agente tiene secciones obligatorias definidas en SKILL.md. El parser verifica presencia
de headers especificos en la seccion del handoff:

- Leo: `### Checklist Leo`, `### Gaps y dudas de Leo` — score 0-2
- Cloe: `**Archivos creados/modificados:**`, `**Descripcion de lo implementado:**` — score 0-2
- Max: `**Resultado de la verificacion:**`, `**Casos probados:**` — score 0-2
- Ada: `**Optimizaciones aplicadas:**`, `**Bundle size antes/despues:**` — score 0-2
- Cipher: `**Vulnerabilidades encontradas:**`, `**Decision:**` — score 0-2

Score normalizado a 0-1 (found_sections / expected_sections).

### 3. Hallucination rate

El parser extrae todas las menciones de paths que parecen referencias a archivos TypeScript/JS:
pattern: `\bsrc\/[a-zA-Z0-9/_-]+\.(ts|js|md)\b`

Para cada path encontrado en el handoff del agente, verifica si el archivo existe en
`repoRoot + path`. Resultado: `refsTotal` y `refsValid`.

`hallucinationRate = 1 - (refsValid / refsTotal)` si refsTotal > 0, else null.

Nota critica: solo se verifican refs dentro del bloque del handoff del agente especifico,
no en todo el status.md. Evita contaminar con refs de otros agentes.

### 4. Memory read flag

Busca en el bloque del handoff del agente (antes del `→ Siguiente:`) la mencion de:
- `MEMORY.md`
- `.claude/agent-memory/`
- `agent-memory`

Si encuentra cualquiera de estos patrones: `memoryRead = true`. Si el handoff esta completo
pero no hay mencion: `memoryRead = false`. Si el handoff no esta completo: `memoryRead = null`.

## Donde aparece en la UI

El tab "Agentes" dentro del Monitor ya muestra:
1. Cards por agente (metricas agregadas actuales)
2. Seccion de graficas SVG (rework, iteraciones, confianza por feature)

Esta feature AÑADE una tercera subseccion: "Comportamiento por feature" — una tabla
por agente con las 4 metricas de comportamiento por feature, colapsable.

No se crean tabs nuevos. No se rompe la estructura existente del monitor.

## Persistencia — decision

- Las metricas de comportamiento se calculan en cada scan (igual que las otras metricas)
- Se persisten en `agent_behavior_history` (nueva tabla en migration v2 de historyDb)
- El trigger de persistencia es la misma logica del changeDetector: solo cuando aparecen datos nuevos
- `getAgentBehaviorTimeline` retorna la serie temporal para graficas/tablas on-demand
- El snapshot actual incluye solo el ultimo valor por agente (para las cards)

## Limitaciones del diseno

- Las file refs se verifican en el momento del scan — no en el momento en que el agente escribio el status.md
  Si un archivo fue borrado despues, se contaria como alucinacion retroactiva. Aceptable para v1.
- La verificacion de memory read es heuristica (busca patrones de texto). Un agente puede mencionar
  MEMORY.md sin haberlo leido. Mas preciso que nada, pero no es prueba definitiva.
- El determinismo estructural se mide por presencia de headers, no por calidad del contenido.
  Un header vacio cuenta como "presente". Tambien aceptable para v1.
