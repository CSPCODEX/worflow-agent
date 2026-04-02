# Data Flows — compliance-tracking-diff-rework

## Flujo A — Script compliance-check.ts (Opcion A: Diff vs Plan)

```
CLI: bun run compliance-check <feature-slug> [--base main] [--json]
         |
         v
1. Busca docs/features/<slug>/status.md
         |
         v
2. parseLeoContract(content)
   -> { create: string[], modify: string[], no_touch: string[] }
   -> null si no hay "### Leo Contract" (retrocompatible)
         |
         v
3. git diff <base>..<branch> --name-only
   -> Set<string> de archivos modificados
         |
         v
4. Calcula score:
   files_spec = create.length + modify.length
   files_ok   = [create + modify].filter(f => diffSet.has(f)).length
   files_viol = no_touch.filter(f => diffSet.has(f)).length
   raw_score  = files_spec > 0 ? files_ok / files_spec : 1.0
   penalized  = Math.max(0, raw_score - files_viol * 0.1)
         |
         v
5. Imprimir tabla ASCII a stdout
   (si --json: imprimir JSON a stdout para integracion con CI)
         |
         v
6. (Opcional futuro) POST a endpoint o insertar en compliance_scores via IPC
   -- En v1, la insercion es manual o via monitor poller (via complianceParser)
```

## Flujo B — Monitor poller detecta compliance scores (deteccion automatica)

```
PipelinePoller.scan()
         |
         v
aggregator.buildSnapshot(docsDir, repoRoot)
  -> parseFeatureStatus(content, slug, filePath, repoRoot)
    -> complianceParser.parseLeoContract(content)  [NUEVO]
       -> extrae LeoContract si el bloque existe, null si no
    -> complianceParser.parseRejectionRecords(content)  [NUEVO]
       -> extrae RejectionRecord[] del status.md
         |
         v
FeatureRecord.leoContract: LeoContract | null         [NUEVO campo]
FeatureRecord.rejectionRecords: RejectionRecord[]     [NUEVO campo]
         |
         v
detectChanges(prev, curr)
  -> para features nuevas o con leoContract cambiado:
       emitir ComplianceScoreEntry si hay score calculable
  -> para features con rejectionRecords nuevos:
       emitir RejectionRecordEntry
         |
         v
persistChanges(db, changes)
  -> INSERT INTO compliance_scores
  -> INSERT INTO rejection_records
```

NOTA: El compliance score via poller es una APROXIMACION (no corre git diff real).
El script compliance-check.ts es el unico que corre git diff real. El poller solo
persiste los rejection records y detecta si hay contrato definido.

## Flujo C — Max rechaza un handoff (Opcion C: Causa raiz)

```
Max detecta que el handoff de Cloe/Ada/etc no cumple instrucciones
         |
         v
Max escribe en su seccion del status.md:

    ### Rejection Record
    ```yaml
    instruction_violated: "descripcion de la instruccion"
    instruction_source: "CLAUDE.md"
    failure_type: "patron_conocido"
    agent_at_fault: "cloe"
    ```
         |
         v
Monitor poller detecta el bloque nuevo en el siguiente scan (30s)
         |
         v
complianceParser.parseRejectionRecords(content)
  -> RejectionRecord[]
         |
         v
changeDetector.ts: newRejections: RejectionRecord[]
         |
         v
historyRepository.persistChanges(db, changes)
  -> INSERT INTO rejection_records
         |
         v
getRejectionPatterns handler -> renderer tab Compliance
```

## Flujo D — Visualizacion en renderer

```
renderer tab Compliance
         |
         v
rpc.request.getComplianceScores({ limit: 50 })
  -> ComplianceScoreIPC[]
  -> tabla: Feature | Score | OK/Total | Violaciones | Rama | Fecha
         |
rpc.request.getRejectionPatterns({})
  -> RejectionRecordIPC[] + RejectionPatternAggregate[]
  -> tabla: Feature | Agente | Instruccion | Fuente | Tipo
  -> cards: por agente — total rechazos, patron mas frecuente
```
