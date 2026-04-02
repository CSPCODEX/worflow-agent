# Plan — Compliance Tracking: Diff vs Plan y Causa Raiz del Rework

## Objetivo

Implementar dos mecanismos de medicion de cumplimiento de instrucciones:

**Opcion A — Diff vs Plan (Leo → Cloe)**
Leo incluye un bloque de contrato estructurado en su handoff. Un script externo compara el
`git diff` de la rama contra ese contrato y calcula un compliance score.

**Opcion C — Causa raiz del rework**
Cuando Max rechaza un handoff, registra en el status.md el motivo exacto: que instruccion
no se siguio, de donde venia esa instruccion, y que tipo de fallo fue.

## Arquitectura general

```
scripts/
  compliance-check.ts      # Script CLI: lee contrato del status.md, corre git diff, produce score

src/monitor/core/
  complianceParser.ts      # (NUEVO) Funcion pura: parsea contrato Leo + rejection records de Max
  complianceRepository.ts  # (NUEVO) Queries SQLite para compliance_scores y rejection_records

src/monitor/
  index.ts                 # (MODIFICAR) Exportar nuevas funciones publicas de compliance

src/monitor/core/
  historyDb.ts             # (MODIFICAR) Migration v4: tablas compliance_scores + rejection_records
  changeDetector.ts        # (MODIFICAR) Detectar compliance scores y rejection records nuevos
  historyRepository.ts     # (MODIFICAR) persistChanges() acepta complianceScores + rejectionRecords

src/types/
  ipc.ts                   # (MODIFICAR) Tipos IPC nuevos: compliance

src/ipc/
  handlers.ts              # (MODIFICAR) Handlers: getComplianceScores, getRejectionPatterns
```

## Formato del contrato de Leo (Opcion A)

Se escribe en la seccion "### Checklist Leo" del handoff, dentro de un bloque fenced YAML
bajo la clave `contract:`. Es retrocompatible porque el bloque es optativo.

Ejemplo en un status.md:

```markdown
### Leo Contract
```yaml
create:
  - src/monitor/core/complianceParser.ts
  - src/monitor/core/complianceRepository.ts
modify:
  - src/monitor/core/historyDb.ts
  - src/monitor/core/changeDetector.ts
  - src/monitor/core/historyRepository.ts
  - src/monitor/index.ts
  - src/types/ipc.ts
  - src/ipc/handlers.ts
  - docs/README.md
no_touch:
  - src/index.ts
  - src/client.ts
  - src/db/database.ts
```
```

## Formato del registro de causa raiz (Opcion C)

Max escribe esto en su seccion al rechazar, dentro de "### Rejection Record":

```markdown
### Rejection Record
```yaml
instruction_violated: "fire-and-forget obligatorio para subprocesos externos"
instruction_source: "CLAUDE.md"
failure_type: "patron_conocido"
agent_at_fault: "cloe"
```
```

Los valores posibles:
- `instruction_source`: `CLAUDE.md` | `agent_system_prompt` | `handoff_anterior`
- `failure_type`: `patron_conocido` | `instruccion_ambigua` | `instruccion_ausente`

## Persistencia — Migration v4

Nueva migration v4 en `historyDb.ts`:

```sql
CREATE TABLE IF NOT EXISTS compliance_scores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_slug TEXT NOT NULL,
  score        REAL NOT NULL,          -- 0.0 a 1.0
  files_spec   INTEGER NOT NULL,       -- total archivos especificados
  files_ok     INTEGER NOT NULL,       -- archivos cumplidos
  files_viol   INTEGER NOT NULL,       -- archivos en no_touch que aparecen en diff (violaciones)
  branch       TEXT NOT NULL,
  base_ref     TEXT NOT NULL,          -- rama base contra la que se comparó (ej: main)
  recorded_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cs_feature ON compliance_scores(feature_slug);

CREATE TABLE IF NOT EXISTS rejection_records (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_slug        TEXT NOT NULL,
  agent_at_fault      TEXT NOT NULL,
  instruction_violated TEXT NOT NULL,
  instruction_source  TEXT NOT NULL,   -- CLAUDE.md | agent_system_prompt | handoff_anterior
  failure_type        TEXT NOT NULL,   -- patron_conocido | instruccion_ambigua | instruccion_ausente
  recorded_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rr_agent ON rejection_records(agent_at_fault);
CREATE INDEX IF NOT EXISTS idx_rr_feature ON rejection_records(feature_slug);
```

## Flujo del script compliance-check.ts

```
1. Leer status.md de la feature (path por arg o busqueda)
2. Parsear bloque "### Leo Contract" -> { create[], modify[], no_touch[] }
3. Correr: git diff <base>..<branch> --name-only
4. Calcular score:
   - files_spec = create.length + modify.length
   - files_ok   = count de create[] + modify[] que aparecen en diff
   - files_viol = count de no_touch[] que aparecen en diff
   - raw_score  = files_ok / files_spec  (0.0-1.0)
   - penalized  = max(0, raw_score - files_viol * 0.1)  [penalizacion por violacion]
5. Imprimir tabla ASCII con resultado
6. Escribir JSON a stdout si --json flag
```

## Visualizacion — nuevo tab Compliance

Nuevo tab "Compliance" en el Monitor (quinto tab). Contiene:

1. **Tabla de compliance scores** (por feature, columnas: Feature, Score, Archivos OK/Total, Violaciones, Rama, Fecha)
2. **Tabla de rejection records** (por agente, columnas: Feature, Agente, Instruccion violada, Fuente, Tipo)
3. **Agregado por agente** (cards resumidos): total rejections, patron mas frecuente

## Diagrama de datos

```
status.md
  "### Leo Contract\n```yaml..."
        |
        v
complianceParser.ts::parseLeoContract()
        |
        v (o via script)
compliance_scores table (SQLite)
        |
        v
getComplianceScores handler
        |
        v
ComplianceTabIPC -> renderer tab Compliance

status.md
  "### Rejection Record\n```yaml..."
        |
        v
complianceParser.ts::parseRejectionRecords()
        |
        v
rejection_records table (SQLite)
        |
        v
getRejectionPatterns handler
        |
        v
RejectionPatternsIPC -> renderer tab Compliance
```
