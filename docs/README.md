# Documentación del proyecto

Documentación de producto, arquitectura, agentes y seguimiento de bugs para **FlowTeam** (repo: worflow-agent).

**Nuevo en el equipo?** Lee primero [AGENTS.md](./AGENTS.md) — explica como funciona el sistema de agentes, el flujo de trabajo y como iniciar una feature.

## Documentación de producto

Los docs de producto viven en `docs/product/` y describen el pivot a orquestacion multi-agente:

| Documento | Contenido |
|---|---|
| [VISION.md](./product/VISION.md) | Misión, público objetivo, diferenciadores, modelo de negocio |
| [ROADMAP.md](./product/ROADMAP.md) | Fases: Prep → MVP → V1 → V2 con estimaciones y dependencias |
| [SPECIFICATIONS.md](./product/SPECIFICATIONS.md) | Specs funcionales, pipelines predefinidos, UI flows, contratos IPC |
| [ARCHITECTURE.md](./product/ARCHITECTURE.md) | Qué reutilizar/modificar/añadir, schema DB, decisiones de arquitectura |

## Estructura

```
docs/
├── product/                  # Documentación de producto (pivot a FlowTeam)
│   ├── VISION.md
│   ├── ROADMAP.md
│   ├── SPECIFICATIONS.md
│   └── ARCHITECTURE.md
├── bugs/
│   └── <id>-<slug>/
│       └── status.md         # Creado por /bug skill, gestionado por Max y Cloe
├── features/
│   └── <slug>/
│       └── status.md         # Creado por /feature skill, gestionado por Leo, Cloe, Max, Ada, Cipher
├── AGENTS.md                 # Como funciona el equipo de agentes
└── README.md                 # Este archivo
```

## Bugs activos

| Bug | Estado |
|---|---|
| [001-validacion-encoding-caracteres](./bugs/001-validacion-encoding-caracteres/) | — |
| [002-agente-error-sin-modelo-lmstudio](./bugs/002-agente-error-sin-modelo-lmstudio/) | — |
| [003-crear-agente-rpc-timeout](./bugs/003-crear-agente-rpc-timeout/) | — |
| [004-rpc-timeout-crear-agente](./bugs/004-rpc-timeout-crear-agente/) | — |
| [005-rpc-timeout-channel-tags](./bugs/005-rpc-timeout-channel-tags/) | — |
| [006-crear-agente-timeout-primera-vez](./bugs/006-crear-agente-timeout-primera-vez/) | — |
| [007-delete-agent-ui-broken](./bugs/007-delete-agent-ui-broken/) | — |
| [008-boton-ajustes-fuera-viewport](./bugs/008-boton-ajustes-fuera-viewport/) | — |
| [009-duplicados-db-restart](./bugs/009-duplicados-db-restart/) | — |
| [010-parser-estado-desconocido](./bugs/010-parser-estado-desconocido/) | — |
| [011-features-desconocido-pipeline](./bugs/011-features-desconocido-pipeline/) | — |
| [012-cipher-falta-columna-handoffs](./bugs/012-cipher-falta-columna-handoffs/) | — |
| [013-boton-actualizar-no-funciona](./bugs/013-boton-actualizar-no-funciona/) | — |
| [014-bundle-failed-desktop-app](./bugs/014-bundle-failed-desktop-app/) | — |

## Features activas

| Feature | Estado |
|---|---|
| [demo-agents-en-pipelines-ejemplo](./features/demo-agents-en-pipelines-ejemplo/) | EN PLANIFICACION |
