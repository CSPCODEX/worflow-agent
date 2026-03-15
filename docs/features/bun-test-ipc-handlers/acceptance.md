# Criterios de aceptacion — bun-test-ipc-handlers

## tests/helpers/testHistoryDb.ts

- [ ] Exporta `setupHistoryTestDb(): Database` que crea DB `:memory:` con el schema del monitor (tablas `pipeline_events`, `agent_metrics_history`, `schema_version`)
- [ ] Exporta `teardownHistoryTestDb(): void` que cierra la DB en memoria
- [ ] Las migraciones son identicas a las de `src/monitor/core/historyDb.ts` (mismas tablas, mismos indices)
- [ ] La funcion es idempotente — llamar `setupHistoryTestDb()` dos veces no falla

## tests/unit/monitor/detectChanges.test.ts

- [ ] prev=null, curr con feature nueva: genera evento `feature_state_changed` con fromValue=null
- [ ] prev con feature en estado A, curr con mismo feature en estado B: genera evento con fromValue=A, toValue=B
- [ ] prev con feature, curr con misma feature sin cambios: NO genera eventos
- [ ] handoff false→true: genera evento `handoff_completed`
- [ ] metricas aparecen por primera vez (hadData=false, hasData=true): genera `metrics_updated` y entrada en newMetrics
- [ ] metricas ya existentes (hadData=true): NO genera nuevas entradas
- [ ] bug nuevo: genera `bug_state_changed`
- [ ] bugs sin cambios: NO genera eventos

## tests/unit/monitor/queryAgentTimeline.test.ts

- [ ] DB vacia: retorna array vacio para cualquier agentId
- [ ] 2 filas para 'leo': retorna 2 puntos en orden ASC por recorded_at
- [ ] confianza 'alta' se mapea a 3, 'media' a 2, 'baja' a 1
- [ ] confianza NULL se mapea a null en el punto
- [ ] rework NULL se mapea a null en el punto
- [ ] rework=1 se mapea a 1, rework=0 se mapea a 0
- [ ] filas de otro agente ('cloe') no aparecen en la query de 'leo'
- [ ] itemType 'bug' se mapea correctamente como 'bug'

## tests/unit/monitor/queryHistory.test.ts

- [ ] DB vacia: retorna events=[], totalCount=0
- [ ] Sin filtros: retorna todos los eventos, totalCount coincide
- [ ] Filtro itemType='feature': retorna solo eventos de feature
- [ ] Filtro agentId='leo': retorna solo eventos con agent_id='leo'
- [ ] Filtro eventType='handoff_completed': retorna solo handoffs
- [ ] Paginacion: limit=2, offset=0 retorna primeros 2; limit=2, offset=2 retorna siguientes 2
- [ ] totalCount no se ve afectado por limit/offset
- [ ] Orden: los eventos se retornan en orden DESC por recorded_at

## tests/unit/monitor/queryAgentTrends.test.ts

- [ ] currentSummaries vacio: retorna array vacio
- [ ] agente sin datos en DB: reworkTrend='sin_datos', totalHistoricSamples=0
- [ ] agente con < 3 muestras: reworkTrend='sin_datos'
- [ ] agente con >= 3 muestras, reworkRate actual > historico+5%: reworkTrend='empeorando'
- [ ] agente con >= 3 muestras, reworkRate actual < historico-5%: reworkTrend='mejorando'
- [ ] agente con >= 3 muestras, diferencia < 5%: reworkTrend='estable'
- [ ] confianza 'alta'=3, 'media'=2, 'baja'=1 en el calculo de historicAvgConfidence

## tests/async/handlers.async.test.ts

- [ ] `handleGenerateAgent` retorna en < 50ms aunque `installAgentDeps` tenga delay de 20ms (fire-and-forget no bloquea)
- [ ] `handleGenerateAgent` retorna { success: true } antes de que `onInstallDone` sea llamado
- [ ] `onInstallDone` es eventualmente llamado (despues de awaitar el delay)
- [ ] `handleGenerateAgent` retorna { success: true } antes de que `onEnhanceDone` sea llamado
- [ ] `onEnhanceDone` es eventualmente llamado
- [ ] `handleCreateSession` retorna el sessionId del stub aunque el stub tenga un await interno

## package.json

- [ ] Script `test:async` ejecuta `bun test tests/async/`
- [ ] Script `test:monitor` ejecuta `bun test tests/unit/monitor/`
- [ ] Script `test` existente sigue ejecutando todos los tests (sin cambio de comportamiento)

## Requisitos transversales

- [ ] `bun test` (todos los tests) pasa en 0 con 0 errores en el estado final
- [ ] Ningun test importa `src/ipc/handlers.ts` ni `src/main.ts` ni `src/desktop/index.ts`
- [ ] Ningun test requiere LM Studio corriendo
- [ ] Ningun test requiere Electrobun corriendo
- [ ] Ningun test escribe a disco (todo en memoria o en /tmp si aplica)
