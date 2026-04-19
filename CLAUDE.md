# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
Be critical and constructive with your opinions and suggestions; if the user is mistaken, kindly correct them by explaining why and proposing the best solution.

## Project Overview

**FlowTeam** (working title; repo name "worflow-agent") is a **multi-agent orchestration desktop platform** for non-technical users. The core concept: define a team of AI agents with specialized roles, arrange them into pipelines (sequential workflows), and execute tasks collaboratively — all from a visual UI with local models (no API keys required).

The product documentation lives in `docs/product/`:
- `docs/product/VISION.md` — Mission, target audience, differentiators, business model
- `docs/product/ROADMAP.md` — Phased roadmap (Prep → MVP → V1 → V2)
- `docs/product/SPECIFICATIONS.md` — Functional specs, UI flows, IPC contracts, pipeline templates
- `docs/product/ARCHITECTURE.md` — What to reuse, modify, add; data model; architecture decisions

## Commands

This project uses **Bun** as the runtime and package manager. Do not use npm or pnpm.

```bash
# Install dependencies
bun install

# Run the CLI generator (interactive)
bun run dev

# Chat with a generated agent via ACP client
bun run chat <agent-name>

# Run the desktop app (Electrobun) — dev mode
bun run desktop

# Run a generated agent (e.g., the "cloe" agent)
# NOTE: agents communicate via ACP (NDJSON over stdin/stdout), not plain text.
# They must be launched by an ACP-compatible client (bun run chat), not run directly.
cd cloe && bun run start
```

There are no tests or lint scripts configured.

## Agent Workflow — How to develop features

This project uses a team of specialized Claude Code agents. **Always follow this flow for any new feature or change:**

```
@leo → @cloe → @max → @ada → @cipher
```

| Agent | Role | When to invoke |
|---|---|---|
| `@leo` | Architect & PM | Before any implementation. Writes plans to `docs/features/<name>/` |
| `@cloe` | Software Engineer | After Leo delivers the plan. Implements following the docs |
| `@max` | QA & SDET | After Cloe finishes. Verifies, audits accessibility and ACP integration |
| `@ada` | Optimizer | After Max approves. Refactors, reduces bundle size, clean code |
| `@cipher` | DevSecOps | Before every release. Audits security, secrets, OWASP |

### Starting a new feature

**Trigger automático:** Cuando el usuario describa una nueva feature, funcionalidad, mejora o cambio — ejecuta el flujo de features automáticamente sin esperar que el usuario escriba `/feature`.

El flujo es:

```
(usuario describe feature) → /feature skill → @leo → @cloe → @max → @ada → @cipher
```

**Pasos que Claude ejecuta al detectar una nueva feature:**
1. Genera el slug desde la descripción (lowercase, guiones, máx 5 palabras)
2. Crea la rama: `git switch -c feature/<slug>`
3. Crea `docs/features/<slug>/status.md` con la estructura definida en `.claude/skills/feature/SKILL.md`
4. Confirma al usuario con el siguiente paso: `@leo <descripcion>...`

### Bug flow (lightweight)

**Trigger automático:** Cuando el usuario reporte un bug, error, o pida un fix — ya sea pegando un stack trace, describiendo un fallo, o usando palabras como "bug", "error", "falla", "no funciona", "fix" — ejecuta el flujo de bugs automáticamente sin esperar que el usuario escriba `/bug`.

El flujo es:

```
(usuario reporta bug) → /bug skill → @max → @cloe → @max
```

**Pasos que Claude ejecuta al detectar un bug:**
1. Genera el ID (`ls docs/bugs/ | wc -l` + 1, formato `001`)
2. Genera el slug desde la descripción (lowercase, guiones, máx 5 palabras)
3. Crea la rama: `git switch -c bug/<id>-<slug>`
4. Crea `docs/bugs/<id>-<slug>/status.md` con la estructura definida en `.claude/skills/bug/SKILL.md`
5. Confirma al usuario con el siguiente paso: `@max Diagnostica el bug #<id>...`

Leo y Ada no participan en bugs. Cipher solo entra si Max marca implicaciones de seguridad. Ver `docs/AGENTS.md` para documentación completa.

### Custom skills (invoke with `/skill-name`)

| Skill | Used by | Purpose |
|---|---|---|
| `/feature` | Anyone | Open a new feature — creates branch, folder, and status.md |
| `/bug` | Anyone | Open a bug report — creates branch, folder, and status.md |
| `/validate-handoff` | Anyone | Validate a handoff before invoking the next agent |
| `/metrics-dashboard` | Anyone | Aggregate metrics dashboard across all features and bugs |
| `/electrobun-ipc` | Cloe | Step-by-step for creating typed RPC channels |
| `/acp-debug` | Max | Diagnose ACP agent connection issues |
| `/bundle-check` | Ada | Analyze and audit Electrobun bundle size |
| `/scan-secrets` | Cipher | Scan codebase for exposed secrets |
| `/commit` | **Solo Max** | Commit tras aprobacion del pipeline — Conventional Commits con co-author devlitus |
| `/create-pr` | **Solo Max** | Crear PR solo cuando el usuario lo pida explicitamente |

### Reglas de commits, push y PR (OBLIGATORIAS)

```
1. COMMITS — Solo Max, solo tras aprobacion del ultimo agente del pipeline
   - Features: despues de que Cipher apruebe (APROBADO / APROBADO_CON_RIESGOS)
   - Bugs sin seguridad: despues del "QA aprobado" final de Max
   - Bugs con seguridad: despues de que Cipher apruebe

2. PUSH — Solo despues de tener commits en la rama, cuando el usuario lo pida

3. PR — Solo cuando el usuario lo pida explicitamente. Nunca de forma proactiva.

4. MERGE — NINGUN agente puede hacer merge de ninguna rama, nunca.
   Si el usuario pide merge, responder: "El merge debe hacerlo el usuario en GitHub."
```

**Ningun agente excepto Max puede invocar `/commit` o `/create-pr`.**
**Ningun agente puede ejecutar `git merge`, `gh pr merge`, ni ningun equivalente.**

### Sincronizacion de docs post-merge

Despues de cada merge en GitHub, ejecutar:

```bash
bun run sync-docs
```

Este comando actualiza los `status.md` de `docs/features/` y `docs/bugs/` cuyas ramas ya
estan mergeadas en main, cambiando el estado a `MERGEADO` o `ARCHIVADO`. Los agentes leen
estos archivos — si no se sincronizan, pueden dar diagnosticos incorrectos sobre el estado
del proyecto.

### Sistema de tareas MVP

Las tareas del MVP viven en `docs/tasks/`. Son el punto de entrada para saber qué implementar y en qué orden.

```
docs/tasks/
  INDEX.md          ← board completo con todas las tareas, estados y dependencias
  T-001-*.md        ← cada tarea con descripción, solución técnica y criterios de aceptación
  T-002-*.md
  ...
```

**Reglas para los agentes:**

1. **Antes de implementar** — leer la tarea correspondiente (`T-XXX`). Contiene la solución técnica detallada, archivos afectados y criterios de aceptación.

2. **Al empezar una tarea** — cambiar el `**Status:**` de `TODO` a `IN PROGRESS` en el archivo de la tarea y en `INDEX.md`.

3. **Al terminar una tarea** — cambiar el `**Status:**` a `DONE` y marcar las subtareas completadas (`[x]`). Actualizar también `INDEX.md`.

4. **Si hay un bloqueo** — cambiar a `BLOCKED` y añadir la razón en la sección "Notas" de la tarea.

5. **Respetar dependencias** — no implementar una tarea si sus dependencias no están en `DONE`. Las dependencias están en `INDEX.md` y en cada tarea.

**Orden de implementación recomendado:**
```
T-001 → T-002 → T-003 → T-004 → T-005 (Fase 0, secuencial)
T-006 + T-007 + T-008 (en paralelo, dependen de Fase 0)
T-009 + T-011 + T-013 (en paralelo)
T-010 → T-012 (últimas)
```

### Agent memory

Each agent maintains persistent memory across sessions. **This is mandatory — not optional.**

Memory files live at:
```
.claude/agent-memory/
  ├── leo/MEMORY.md
  ├── cloe/MEMORY.md
  ├── max/MEMORY.md
  ├── ada/MEMORY.md
  └── cipher/MEMORY.md
```

**Rules for every agent:**

1. **On demand** — Read your memory file when any of these apply:
   - You are about to make an architectural or convention decision
   - You encounter a bug or pattern that may have been solved before
   - The user references previous work or sessions
   - You are unsure whether a pattern/approach has already been established

   Memory file paths (relative to repo root):
   - Leo: `.claude/agent-memory/leo/MEMORY.md`
   - Cloe: `.claude/agent-memory/cloe/MEMORY.md`
   - Max: `.claude/agent-memory/max/MEMORY.md`
   - Ada: `.claude/agent-memory/ada/MEMORY.md`
   - Cipher: `.claude/agent-memory/cipher/MEMORY.md`

   > The critical patterns from all agents are already summarized in `MEMORY.md` (always loaded). Use individual files only when deeper historical context is needed.

2. **END of session** — Update your memory file with any new decisions, patterns, bugs, or API quirks discovered. Overwrite stale entries. Keep it concise.

3. **What to save**: architectural decisions, recurring bug patterns, API quirks, conventions established. Do NOT save ephemeral task state.

## Architecture

### Current state (pre-pivot)

The codebase is a CLI + desktop app for generating and chatting with individual AI agents. The pivot adds multi-agent orchestration (pipelines) while reusing the existing agent infrastructure.

### 1. Agent Generator CLI (`src/`)

An interactive CLI tool that scaffolds new AI agents via a step-by-step interview. The flow is:

1. `src/index.ts` — Entry point. Calls `runInterview()` then `generateAgent()`.
2. `src/cli/prompts.ts` — Collects user config (`AgentConfig`: name, description, role/system-prompt, workspace flag, provider, optional API key) using `@clack/prompts`.
3. `src/cli/validations.ts` — Input validation functions used by the prompts.
4. `src/generators/agentGenerator.ts` — Creates the agent directory, writes `package.json`, `.env`, optionally a `workspace/` folder, and the main `index.ts` by injecting config into templates. Exports `scaffoldAgent()` and `installAgentDeps()` for use by the Electrobun main process.
5. `src/generators/fileSystem.ts` — Low-level fs helpers; `copyTemplateAndInject()` replaces `{{KEY}}` placeholders in `.tpl` files.
6. `src/templates/basic-agent/` — Templates for generated agents: `index.ts.tpl`, `package.json.tpl`, and provider modules (lmstudio, ollama, openai, anthropic, gemini).
7. `src/utils/logger.ts` — Styled terminal output via `@clack/prompts` and `picocolors`.

Generated agents use `@agentclientprotocol/sdk` (ACP standard) and support 5 providers via a factory pattern (`providers/factory.ts.tpl`). They communicate via **stdin/stdout** using `ndJsonStream`. Generated agents support two modes (detected via `process.stdin.isTTY`):
- **TTY mode** (terminal): interactive REPL directly
- **ACP mode** (subprocess): NDJSON protocol via stdin/stdout

### 2. Electrobun Desktop App (`src/desktop/index.ts`, `src/renderer/`)

A cross-platform desktop GUI built with Electrobun (Bun + TypeScript + system webview).

- `src/desktop/index.ts` — Electrobun main process. Creates the window, registers IPC handlers.
- `src/ipc/handlers.ts` — RPC handlers: agent CRUD, sessions, conversations, messages, settings, monitor.
- `src/ipc/handlerLogic.ts` — Business logic extracted from handlers (dependency injection pattern).
- `src/ipc/acpManager.ts` — Manages active ACP sessions (spawn, connect, stream, cleanup).
- `src/types/ipc.ts` — Typed contracts for all main ↔ renderer communication (`AppRPC` type).
- `src/renderer/` — Webview UI: agent list sidebar, create-agent form, chat interface, settings, monitor.
- `electrobun.config.ts` — Electrobun build configuration.

The desktop app reuses `src/generators/` and `src/cli/validations.ts` without modification. The terminal CLI (`bun run dev`, `bun run chat`) remains fully functional alongside the desktop app.

### 3. Data Layer (`src/db/`)

- `src/db/database.ts` — SQLite initialization with WAL mode and migration system.
- `src/db/migrations.ts` — Incremental migrations (currently v1-v3).
- `src/db/agentRepository.ts` — CRUD for agents.
- `src/db/conversationRepository.ts` — CRUD for conversations and messages.
- `src/db/settingsRepository.ts` — Key-value settings store.

### 4. Monitor / Dev Tools (`src/monitor/`)

Internal monitoring system for the development pipeline (Leo→Cloe→Max→Ada→Cipher). Includes poller, history DB, behavior metrics, compliance tracking. **This is meta-tooling, not part of the end-user product.** Will be moved to `src/dev-tools/monitor/` during the pivot.

### 5. `cloe/` — Example Generated Agent

A concrete agent created by the generator. Demonstrates the expected output structure: `index.ts`, `package.json`, `.env`, `workspace/`.

### 6. Documentation (`docs/`)

```
docs/
├── product/                  # Product-level documentation (pivot direction)
│   ├── VISION.md             # Mission, audience, differentiators, business model
│   ├── ROADMAP.md            # Phased roadmap with effort estimates
│   ├── SPECIFICATIONS.md     # Functional specs, UI flows, IPC contracts
│   └── ARCHITECTURE.md       # Reuse/modify/add analysis, data model, decisions
├── tasks/                    # MVP task board
│   ├── INDEX.md              # All tasks with status and dependency graph
│   └── T-XXX-<slug>.md       # Individual tasks (description, tech solution, acceptance criteria)
└── bugs/
    └── <id>-<slug>/
        └── status.md         # Created by /bug skill, filled by Max and Cloe
```

## Key Notes

- Template injection uses `{{KEY}}` syntax (not `${}` or other formats).
- Generated agents use `bun.lock` and Bun as their runtime as well.
- The `.env` at the repo root is for the generator itself; each generated agent has its own `.env` with `LM_STUDIO_MODEL` (optional).
- Do NOT modify `src/index.ts`, `src/client.ts`, or the TTY mode of generated agents — the terminal workflow must remain intact.
- **Local models first:** LM Studio and Ollama are the default providers. Cloud APIs (OpenAI, Anthropic, Gemini) are optional. The product must work fully offline.
- **Pipeline execution is sequential:** one agent at a time per pipeline run. No concurrency in the MVP. Each step spawns and kills an agent process.
- **IPC types in `src/types/ipc.ts`:** All new pipeline-related IPC contracts must follow the same typed pattern. See `docs/product/SPECIFICATIONS.md` section 7 for the complete list of new handlers.
- **SQLite migrations are incremental:** New tables (pipelines, pipeline_steps, pipeline_runs, pipeline_step_runs, pipeline_templates) go in migration v4+. See `docs/product/ARCHITECTURE.md` section 2.1 for the complete schema.
