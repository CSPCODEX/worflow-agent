# Documentación del proyecto

Planes de arquitectura y especificaciones tecnicas generadas por Leo.
Cada feature tiene su propia carpeta con los documentos correspondientes.

**Nuevo en el equipo?** Lee primero [AGENTS.md](./AGENTS.md) — explica como funciona el sistema de agentes, el flujo de trabajo y como iniciar una feature.

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
