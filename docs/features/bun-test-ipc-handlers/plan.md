# Plan — Tests de runtime para IPC handlers (bun-test-ipc-handlers)

## Objetivo

Añadir una capa de tests que detecte bugs **de comportamiento async** que el analisis estatico no puede atrapar:

1. **Await bloqueante en handlers IPC** — un handler que hace `await proc.exited` o `await` a subproceso externo bloquea el event loop de Electrobun. El test debe probar que el handler retorna en < N ms aunque la tarea de fondo tarde mucho.
2. **Fire-and-forget roto** — que `installAgentDeps` y `enhanceAndPersist` se disparan sin bloquear el retorno del handler, y que `onInstallDone` / `onEnhanceDone` son llamados eventualmente.
3. **Streaming IPC** — que `acpManager.setMessageCallback` despacha chunks al callback registrado. El ACP real requiere LM Studio; el test usa un stub que emite chunks sinteticos.
4. **Handlers de consulta SQLite** — que `getHistory`, `getAgentTrends`, `getAgentTimeline` retornan resultados correctos desde una DB en memoria con datos sembrados, sin timeout.

## Alcance

Esta feature NO añade nuevos handlers ni cambia comportamiento de produccion. Solo añade archivos en `tests/`. Un cambio opcional a `package.json` puede añadir un script `test:async` para correr solo estos tests.

## Arquitectura de los tests

### Patron de aislamiento

Los tests async NO pueden importar `handlers.ts` directamente porque este importa `defineElectrobunRPC`, que require el entorno Electrobun. Los tests ya existentes (suite-tests-ipc-db) resuelven esto importando `handlerLogic.ts` — las funciones puras sin deps de Electrobun.

Para los bugs async el patron es el mismo: testear `handlerLogic.ts`, no `handlers.ts`.

Para los handlers que si estan en `handlers.ts` (el poller, `snapshotToIPC`, queries directas a la DB del monitor) se usa un helper que instancia la DB en memoria y llama las funciones importadas directamente.

### Helpers necesarios

- `tests/helpers/testHistoryDb.ts` — DB en memoria con el schema del monitor (historyDb migrations). Analogo a `testDb.ts` pero para `monitor-history.db`.

### Archivos de test nuevos

```
tests/
  helpers/
    testHistoryDb.ts            # NUEVO — DB en memoria con schema monitor
  async/
    handlers.async.test.ts      # NUEVO — fire-and-forget, timing, streaming stub
  unit/
    monitor/
      queryAgentTimeline.test.ts  # NUEVO — queryAgentTimeline con DB en memoria
      queryHistory.test.ts        # NUEVO — queryHistory con filtros
      queryAgentTrends.test.ts    # NUEVO — queryAgentTrends con datos sembrados
      detectChanges.test.ts       # NUEVO — funcion pura changeDetector
```

### No se tocan

- `src/ipc/handlers.ts` — ningun cambio de produccion
- `src/ipc/handlerLogic.ts` — ningun cambio de produccion
- `tests/` existentes — no se modifican, no se rompen

## Detalle por categoria de test

### 1. Tests async (handlers.async.test.ts)

Objetivo: probar que los handlers fire-and-forget no bloquean.

Tecnica: medir el tiempo de resolucion de la Promise que retorna el handler vs el tiempo que tarda la tarea de fondo simulada.

```
[handler retorna] -----> t0 (< 50ms)
[onInstallDone callback] -----> t1 (> 0ms, eventual)
```

El test falla si t0 > 50ms (el handler bloqueo).

Para `handleGenerateAgent`:
- `scaffoldAgent` retorna inmediatamente
- `installAgentDeps` callback se llama despues de un delay simulado (`setTimeout(cb, 20)`)
- El handler debe retornar antes de que `onInstallDone` sea llamado

Para `handleCreateSession`:
- `acpManager.createSession` retorna despues de delay
- El handler retorna el resultado directamente (no es fire-and-forget, es await correcto)

### 2. Tests de monitor (unit/monitor/)

Objetivo: probar las funciones de query del monitor con datos reales en SQLite :memory:.

- `queryAgentTimeline` — sembrar 3 filas para 'leo', consultar, verificar conversion confianza
- `queryHistory` — sembrar eventos, filtrar por itemType/agentId/eventType, verificar paginacion
- `queryAgentTrends` — sembrar metricas, verificar calculo de reworkTrend
- `detectChanges` — funcion pura, no necesita DB

### 3. Integracion en flujo Max

Max ejecuta `bun test` como parte de la verificacion. Los nuevos tests se ejecutan automaticamente. Si alguno falla, Max lo reporta como bug critico.

Añadir a `package.json`:
```json
"test:async": "bun test tests/async/"
"test:monitor": "bun test tests/unit/monitor/"
```

## Orden de implementacion (prioridad)

1. `tests/helpers/testHistoryDb.ts` — sin esto, los tests de monitor no arrancan
2. `tests/unit/monitor/detectChanges.test.ts` — funcion pura, no necesita DB, rapido de implementar
3. `tests/unit/monitor/queryAgentTimeline.test.ts` — el mas nuevo, el que mas falta hace
4. `tests/unit/monitor/queryHistory.test.ts`
5. `tests/unit/monitor/queryAgentTrends.test.ts`
6. `tests/async/handlers.async.test.ts`
7. `package.json` — añadir scripts opcionales
