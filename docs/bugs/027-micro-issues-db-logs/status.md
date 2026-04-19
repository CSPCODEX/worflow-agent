# Bug #027 — Micro-issues en DB, logs y rendimiento menor — agrupado

Estado: RESUELTO
Rama: bug/027-micro-issues-db-logs
Fecha apertura: 2026-04-19
Diagnostico Max: 2026-04-19
Resuelto: 2026-04-19
Requiere auditoria de Cipher: NO

---

## Info del bug

**Descripcion:** Cuatro issues menores agrupados. (1) src/db/settingsRepository.ts linea 37: getAll() hace JSON.stringify(JSON.parse(...)) — double parse/stringify innecesario que puede alterar el orden de claves. (2) src/ipc/handlers.ts lineas 63-64: console.log('[monitor] docsDir:', docsDir) y console.log('[monitor] repoRoot:', repoRoot) se ejecutan en produccion, exponiendo rutas absolutas del sistema de archivos. (3) src/db/pipelineTemplateRepository.ts lineas 62-64: listTemplates hace JSON.parse(row.steps || '[]') dos veces por row. (4) src/db/migrations.ts lineas 56-121 (migracion v4): sin indice en pipeline_step_runs(step_id) ni pipeline_runs(status) para futuros filtrados.

**Severidad:** BAJA

**Tiene implicaciones de seguridad:** NO (issue #2 solo — duplicado en bug #029)

---

## Verificacion Max

### Issue #1: settingsRepository.ts:37 — FIX VERIFICADO
- **Evidencia:** Linea 37 ahora es `defaultProviderConfig: map.get('default_provider_config') ?? '{}',`
- Sin JSON.stringify(JSON.parse(...)) — fix confirmado.

### Issue #2: handlers.ts:63-65 — FIX VERIFICADO
- **Evidencia:** Lineas 63-66:
```typescript
if (process.env.NODE_ENV !== 'production') {
  console.log('[monitor] docsDir:', docsDir);
  console.log('[monitor] repoRoot:', repoRoot);
}
```
- Logs protegidos detras de NODE_ENV check — fix confirmado.

### Issue #3: pipelineTemplateRepository.ts:62-68 — FIX VERIFICADO
- **Evidencia:** Lineas 62-68:
```typescript
return rows.map((row) => {
  const record = rowToRecord(row);
  return {
    ...record,
    stepCount: record.steps.length,
  };
});
```
- Un solo JSON.parse por row via rowToRecord; stepCount reutiliza record.steps.length — fix confirmado.

### Issue #4: migrations.ts:131-136 (migracion v7) — FIX VERIFICADO
- **Evidencia:** Migracion v7 (version 7) contiene:
```typescript
{
  version: 7,
  up: `
    CREATE INDEX IF NOT EXISTS idx_runs_status ON pipeline_runs(status);
    CREATE INDEX IF NOT EXISTS idx_step_runs_step_id ON pipeline_step_runs(step_id);
  `,
},
```
- Ambos indices presentes — fix confirmado.

### TSC
- bun run tsc --noEmit: errores pre-existentes (scripts/metrics.ts, node_modules/electrobun, etc.)
- Ningun error nuevo en los 4 archivos modificados.

---

## Handoff Cloe → Max

### Checklist Cloe
- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Leo (o documentado por que difieren) — N/A
- [x] bun run tsc --noEmit ejecutado — 0 errores nuevos (errores pre-existentes)
- [x] Strings que viajan por IPC son ASCII puro (sin tildes, acentos ni chars > 0x7E) — solo comments
- [x] Fire-and-forget en todos los handlers IPC que lanzan subprocesos — N/A
- [x] Input validation en todos los IPC handlers que tocan filesystem o spawn — N/A
- [x] DB: si INSERT falla despues de scaffold, rollback del directorio creado (y viceversa) — N/A
- [x] initDatabase() en try/catch con process.exit(1) si lanza — N/A
- [x] Sin `any` sin justificacion escrita — N/A
- [x] Labels HTML: todos tienen for+id matching — N/A
- [x] Si creaste vistas nuevas: todas las clases CSS usadas en innerHTML existen — N/A

### Manifiesto de archivos
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| /home/carles/work/worflow-agent/src/db/settingsRepository.ts | modificado | 37 |
| /home/carles/work/worflow-agent/src/ipc/handlers.ts | modificado | 61-65 |
| /home/carles/work/worflow-agent/src/db/pipelineTemplateRepository.ts | modificado | 62-68 |
| /home/carles/work/worflow-agent/src/db/migrations.ts | modificado | 128-134 |

---

## Metricas de Max
- archivos_leidos: 5
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 0
- bugs_bajos: 4 (resueltos)
- items_checklist_verificados: 8/8
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0
