# Criterios de Aceptacion — compliance-tracking-diff-rework

## complianceParser.ts

- [ ] `parseLeoContract(content)` retorna `null` para status.md sin bloque "### Leo Contract"
- [ ] `parseLeoContract(content)` retorna objeto con arrays `create`, `modify`, `no_touch` correctos
- [ ] `parseLeoContract(content)` con YAML malformado retorna `null` sin lanzar excepcion
- [ ] `parseRejectionRecords(content)` retorna `[]` para status.md sin bloques "### Rejection Record"
- [ ] `parseRejectionRecords(content)` extrae multiples records si hay mas de uno
- [ ] `parseRejectionRecords(content)` con YAML malformado omite ese record silenciosamente

## compliance-check.ts (script CLI)

- [ ] Sin argumento imprime uso y sale con codigo 1
- [ ] Feature slug invalido (no encontrado) imprime error y sale con codigo 1
- [ ] Feature sin "### Leo Contract" imprime "Sin contrato definido" y sale con codigo 0
- [ ] Contrato valido + diff correcto calcula score entre 0.0 y 1.0
- [ ] `--json` emite JSON valido a stdout con campos `score`, `filesSpec`, `filesOk`, `filesViol`
- [ ] `--base <ref>` usa esa ref en git diff (no solo main)
- [ ] Si `git diff` falla, imprime error descriptivo y sale con codigo 1

## Migration v4 (historyDb.ts)

- [ ] `compliance_scores` creada con columnas correctas e indice idx_cs_feature
- [ ] `rejection_records` creada con columnas correctas e indices idx_rr_agent, idx_rr_feature
- [ ] Migration v4 es idempotente (ejecutar 2 veces no falla ni duplica)
- [ ] Schema version = 4 despues de correr migrations

## complianceRepository.ts

- [ ] `insertComplianceScore()` usa prepared statement, no interpolacion
- [ ] `insertRejectionRecord()` valida instructionSource y failureType contra whitelist
- [ ] `queryComplianceScores(db, params)` acepta filtro opcional featureSlug
- [ ] `queryRejectionPatterns(db, params)` retorna records + agregados por agente
- [ ] `buildRejectionAggregates(records)` calcula mostFrequentViolation correctamente

## changeDetector.ts y historyRepository.ts

- [ ] `DetectedChanges` tiene campos `newRejections: RejectionRecordEntry[]`
- [ ] `persistChanges()` inserta en `rejection_records` los nuevos records
- [ ] No se duplican rejection records si se parsea el mismo archivo dos veces (UNIQUE o INSERT OR IGNORE)

## IPC handlers

- [ ] `getComplianceScores` valida featureSlug con regex `/^[a-z0-9-]+$/` si presente
- [ ] `getComplianceScores` valida limit (entero positivo <= 500) y offset (entero >= 0)
- [ ] `getRejectionPatterns` valida agentId contra VALID_AGENTS whitelist
- [ ] Ambos handlers son query SQLite sincronas (no fire-and-forget)
- [ ] Ambos handlers retornan objeto vacio `{ scores: [], totalCount: 0 }` si historyDb es null

## UI tab Compliance

- [ ] Tab "Compliance" visible en el monitor (5to tab, despues de "Historial")
- [ ] Tabla de compliance scores con columnas: Feature, Score (barra visual), OK/Total, Violaciones, Fecha
- [ ] Score con color: verde >= 0.9, amarillo >= 0.7, rojo < 0.7
- [ ] Tabla de rejection records con columnas: Feature, Agente, Instruccion, Fuente, Tipo
- [ ] Cards de agregados por agente: nombre, total rejections, patron mas frecuente
- [ ] Con 0 datos: mensaje "Sin datos de compliance. Ejecuta bun run compliance-check..."
- [ ] Sin filtros de estado (no son features en progreso, son registros historicos)
- [ ] CSS con prefijo `.monitor-compliance-` (no colision con clases existentes)

## Retrocompatibilidad

- [ ] Features existentes sin "### Leo Contract" no rompen parseo ni el monitor
- [ ] Features existentes sin "### Rejection Record" no rompen parseo ni el monitor
- [ ] El tab Pipeline y tab Agentes siguen funcionando identicos
- [ ] CLI `bun run dev` y `bun run chat` no son afectados

## Script en package.json

- [ ] `"compliance-check": "bun run scripts/compliance-check.ts"` añadido a scripts
