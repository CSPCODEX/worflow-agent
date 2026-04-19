# Tasks — FlowTeam MVP

Objetivo: tener un MVP funcional donde un usuario pueda crear un pipeline, ejecutarlo y ver los resultados con modelos locales.

**Fecha objetivo MVP:** 2026-06-15

## Estados

`TODO` → `IN PROGRESS` → `DONE` | `BLOCKED`

---

## Fase 0 — Preparación y Refactorización

| ID | Tarea | Status | Responsable | Depende de |
|---|---|---|---|---|
| [T-001](./T-001-migraciones-db-pipelines.md) | Migraciones DB v4 — tablas de pipelines | DONE | Cloe | — |
| [T-002](./T-002-repositorios-crud-pipelines.md) | Repositorios CRUD para tablas de pipelines | DONE | Cloe | T-001 |
| [T-003](./T-003-refactor-agentes-roles.md) | Refactor agentes como roles reutilizables | DONE | Cloe | T-001 |
| [T-004](./T-004-pipeline-runner.md) | PipelineRunner — motor de ejecución | DONE | Cloe | T-002, T-003 |
| [T-005](./T-005-limpiar-codigo-obsoleto.md) | Limpiar código obsoleto y mover monitor | DONE | Cloe | T-004 |

## Fase 1 — MVP

| ID | Tarea | Status | Responsable | Depende de |
|---|---|---|---|---|
| [T-006](./T-006-ipc-contratos-pipelines.md) | Contratos IPC para pipelines | DONE | Cloe | T-002 |
| [T-007](./T-007-templates-pipelines.md) | Templates predefinidos de pipelines | DONE | Cloe | T-001 |
| [T-008](./T-008-agentes-por-defecto.md) | Agentes por defecto pre-instalados | DONE | Cloe | T-003 |
| [T-009](./T-009-ui-pipeline-list-builder.md) | UI — Pipeline list y pipeline builder | TODO | Cloe | T-006, T-007 |
| [T-010](./T-010-ui-pipeline-ejecucion.md) | UI — Vista de ejecución en tiempo real | TODO | Cloe | T-009, T-004 |
| [T-011](./T-011-ui-gestion-agentes.md) | UI — Gestión de agentes (roles) | TODO | Cloe | T-006, T-008 |
| [T-012](./T-012-onboarding-providers.md) | Onboarding y detección de providers locales | TODO | Cloe | T-011, T-007 |
| [T-013](./T-013-settings-simplificado.md) | Settings simplificado | TODO | Cloe | T-006 |

---

## Dependencias (grafo)

```
T-001 (DB)
  ├── T-002 (Repos) ──── T-004 (Runner) ──── T-005 (Limpieza)
  │       └── T-006 (IPC) ──── T-009 (UI Builder) ──── T-010 (UI Ejecución)
  │                └── T-013 (Settings)
  ├── T-003 (Roles) ──── T-004
  │       └── T-008 (Seed agentes) ──── T-011 (UI Agentes)
  └── T-007 (Templates) ──── T-009
                                └── T-012 (Onboarding)
```
