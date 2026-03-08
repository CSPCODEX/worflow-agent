# Feature: Electrobun Migration

**Estado:** En progreso
**Autor:** Leo
**Implementa:** Cloe
**QA:** Max

## Decisión principal

La terminal **no se toca**. `bun run dev` y `bun run chat` siguen funcionando igual.
Electrobun es una capa adicional sobre el mismo codebase, no un reemplazo.

El modo TTY interactivo de los agentes generados tampoco se modifica.

---

## Arquitectura — Estructura de carpetas

```
worflow-agent/
├── src/
│   ├── index.ts                  EXISTENTE — NO TOCAR (CLI entry)
│   ├── client.ts                 EXISTENTE — NO TOCAR (ACP CLI client)
│   ├── main.ts                   NUEVO — Electrobun main process
│   ├── cli/
│   │   ├── prompts.ts            EXISTENTE — NO TOCAR
│   │   └── validations.ts        EXISTENTE — NO TOCAR (reutilizado)
│   ├── generators/
│   │   ├── agentGenerator.ts     ADAPTAR — extraer generateAgentCore()
│   │   └── fileSystem.ts         EXISTENTE — NO TOCAR
│   ├── ipc/
│   │   ├── handlers.ts           NUEVO — registra todos los RPC handlers
│   │   └── acpManager.ts         NUEVO — gestiona sesiones ACP activas
│   ├── types/
│   │   └── ipc.ts                NUEVO — contratos tipados main <-> renderer
│   ├── templates/basic-agent/    EXISTENTE — NO TOCAR
│   ├── utils/logger.ts           EXISTENTE — NO TOCAR
│   └── renderer/
│       ├── index.html            NUEVO — webview entry
│       ├── style.css             NUEVO — estilos globales
│       ├── app.ts                NUEVO — router renderer
│       ├── views/
│       │   ├── create-agent.ts   NUEVO — formulario nuevo agente
│       │   └── chat.ts           NUEVO — interfaz de chat
│       └── components/
│           └── agent-list.ts     NUEVO — sidebar lista de agentes
├── electrobun.config.ts          NUEVO — config de build
└── package.json                  MODIFICAR — añadir electrobun + script desktop
```

---

## Lista priorizada de implementación

| Prioridad | Acción | Archivo |
|---|---|---|
| 1 | CREAR | `src/types/ipc.ts` |
| 2 | ADAPTAR | `src/generators/agentGenerator.ts` |
| 3 | CREAR | `src/ipc/acpManager.ts` |
| 4 | CREAR | `src/ipc/handlers.ts` |
| 5 | CREAR | `src/main.ts` |
| 6 | CREAR | `electrobun.config.ts` |
| 7 | MODIFICAR | `package.json` |
| 8 | CREAR | `src/renderer/index.html` |
| 9 | CREAR | `src/renderer/app.ts` |
| 10 | CREAR | `src/renderer/views/create-agent.ts` |
| 11 | CREAR | `src/renderer/views/chat.ts` |
| 12 | CREAR | `src/renderer/components/agent-list.ts` |
| 13 | CREAR | `src/renderer/style.css` |
