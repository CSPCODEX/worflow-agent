# Data Flows — bun-test-ipc-handlers

## Flujo 1: Test fire-and-forget de handleGenerateAgent

```
bun test
  |
  └─> handlers.async.test.ts
        |
        ├─ t_start = performance.now()
        |
        ├─ await handleGenerateAgent(config, dir, deps)
        |     |
        |     ├─ validateAgentName()  [sincrono]
        |     ├─ agentRepository.findByName()  [DB :memory:]
        |     ├─ scaffoldAgent()  [stub: retorna inmediatamente]
        |     ├─ agentRepository.insert()  [DB :memory:]
        |     ├─ installAgentDeps(dir, cb)  [stub: setTimeout(cb, 20ms)]  <-- FIRE AND FORGET
        |     ├─ enhanceAndPersist(...)  [stub: Promise.resolve()]  <-- FIRE AND FORGET
        |     └─ return { success: true }  <-- retorna ANTES de que cb sea llamado
        |
        ├─ t_return = performance.now()
        |
        ├─ ASSERT: (t_return - t_start) < 50ms
        |
        └─ await new Promise(resolve => setTimeout(resolve, 50ms))
              |
              └─ ASSERT: onInstallDone fue llamado (flag booleano)
```

## Flujo 2: Test streaming stub de acpManager

```
bun test
  |
  └─> handlers.async.test.ts
        |
        ├─ acpManager stub con setMessageCallback
        |
        ├─ registrar callback: (type, sessionId, data) => { chunks.push(data) }
        |
        ├─ stub emite: chunk('hola'), chunk(' mundo'), end()
        |
        └─ ASSERT: chunks === ['hola', ' mundo']
           ASSERT: end fue emitido
```

## Flujo 3: Test queryAgentTimeline con DB en memoria

```
bun test
  |
  └─> queryAgentTimeline.test.ts
        |
        ├─ db = new Database(':memory:')
        ├─ applyHistoryMigrations(db)  [inline desde historyDb.ts]
        |
        ├─ INSERT INTO agent_metrics_history ...
        |     agente 'leo', feature 'test-feature-1', rework=0, iteraciones=2, confianza='alta'
        |     agente 'leo', feature 'test-feature-2', rework=1, iteraciones=3, confianza='media'
        |     agente 'cloe', feature 'test-feature-1', rework=0, iteraciones=1, confianza='baja'
        |
        ├─ points = queryAgentTimeline(db, 'leo')
        |
        ├─ ASSERT: points.length === 2
        ├─ ASSERT: points[0].rework === 0
        ├─ ASSERT: points[0].confianza === 3  (alta=3)
        ├─ ASSERT: points[1].rework === 1
        ├─ ASSERT: points[1].confianza === 2  (media=2)
        └─ ASSERT: orden ASC por recorded_at
```

## Flujo 4: Test detectChanges (funcion pura)

```
bun test
  |
  └─> detectChanges.test.ts
        |
        ├─ prev = null  (primer scan)
        ├─ curr = { features: [{ slug: 'test', state: 'EN PLANIFICACION', ... }], bugs: [] }
        |
        ├─ changes = detectChanges(prev, curr)
        |
        ├─ ASSERT: changes.events[0].eventType === 'feature_state_changed'
        ├─ ASSERT: changes.events[0].fromValue === null
        └─ ASSERT: changes.events[0].toValue === 'EN PLANIFICACION'
```

## Flujo 5: Ejecucion en CI / Max

```
Max ejecuta: bun test
  |
  ├─ tests/unit/validations.test.ts          [existente]
  ├─ tests/unit/db/migrations.test.ts        [existente]
  ├─ tests/unit/db/agentRepository.test.ts   [existente]
  ├─ tests/unit/db/conversationRepository.test.ts [existente]
  ├─ tests/integration/handlers/*.test.ts    [existentes]
  ├─ tests/unit/monitor/detectChanges.test.ts     [NUEVO]
  ├─ tests/unit/monitor/queryAgentTimeline.test.ts [NUEVO]
  ├─ tests/unit/monitor/queryHistory.test.ts       [NUEVO]
  ├─ tests/unit/monitor/queryAgentTrends.test.ts   [NUEVO]
  └─ tests/async/handlers.async.test.ts            [NUEVO]
        |
        Si alguno falla → Max reporta bug critico con el nombre del test fallido
```
