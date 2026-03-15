# Documentación del proyecto

Planes de arquitectura y especificaciones tecnicas generadas por Leo.
Cada feature tiene su propia carpeta con los documentos correspondientes.

**Nuevo en el equipo?** Lee primero [AGENTS.md](./AGENTS.md) — explica como funciona el sistema de agentes, el flujo de trabajo y como iniciar una feature.

Para ver que viene a continuacion, consulta el [ROADMAP.md](./ROADMAP.md).

## Estructura

```
docs/
└── features/
    └── <nombre-feature>/
        ├── plan.md              # Plan general y arquitectura
        ├── ipc-contracts.md     # Contratos IPC tipados (si aplica)
        ├── data-flows.md        # Flujos de datos
        └── acceptance.md        # Criterios de aceptación
```

## Features

| Feature | Estado | Responsable |
|---|---|---|
| [electrobun-migration](./features/electrobun-migration/) | En progreso | Cloe |
| [persistence](./features/persistence/) | Listo para implementacion | Cloe |
| [prompt-enhancement](./features/prompt-enhancement/) | Listo para implementacion | Cloe |
| [multi-provider-support](./features/multi-provider-support/) | Listo para implementacion | Cloe |
| [delete-agent](./features/delete-agent/) | Listo para implementacion | Cloe |
| [suite-tests-ipc-db](./features/suite-tests-ipc-db/) | En implementacion | Cloe |
| [devtools-csp-produccion](./features/devtools-csp-produccion/) | En implementacion | Cloe |
| [settings-panel](./features/settings-panel/) | Listo para implementacion | Cloe |
| [monitor-pipeline-agentes](./features/monitor-pipeline-agentes/) | En implementacion | Cloe |
| [monitor-historial-metricas](./features/monitor-historial-metricas/) | En implementacion | Cloe |
| [graficas-evolucion-metricas-agentes](./features/graficas-evolucion-metricas-agentes/) | APROBADO | Cipher |
| [bun-test-ipc-handlers](./features/bun-test-ipc-handlers/) | Listo para implementacion | Cloe |
