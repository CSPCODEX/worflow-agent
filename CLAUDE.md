# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

1. Invoke `@leo` with the feature description
2. Leo writes the plan to `docs/features/<feature-name>/` (plan.md, ipc-contracts.md, data-flows.md, acceptance.md)
3. Invoke `@cloe` pointing to the docs Leo wrote
4. After implementation, invoke `@max` to verify
5. After QA approval, invoke `@ada` to optimize
6. Before any push to main, invoke `@cipher` to audit

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
4. Crea `docs/bugs/<id>-<slug>/status.md` con la estructura definida en `.claude/skills/bug.md`
5. Confirma al usuario con el siguiente paso: `@max Diagnostica el bug #<id>...`

Leo y Ada no participan en bugs. Cipher solo entra si Max marca implicaciones de seguridad. Ver `docs/AGENTS.md` para documentación completa.

### Custom skills (invoke with `/skill-name`)

| Skill | Used by | Purpose |
|---|---|---|
| `/bug` | Anyone | Open a bug report — creates branch, folder, and status.md |
| `/electrobun-ipc` | Cloe | Step-by-step for creating typed RPC channels |
| `/acp-debug` | Max | Diagnose ACP agent connection issues |
| `/bundle-check` | Ada | Analyze and audit Electrobun bundle size |
| `/scan-secrets` | Cipher | Scan codebase for exposed secrets |
| `/commit` | Anyone | Commit siguiendo Conventional Commits con co-author devlitus |

### Agent memory

Each agent maintains persistent memory across sessions:

```
C:\Users\carle\.claude\projects\D--work-worflow-agent\memory\
  ├── leo-memory.md
  ├── cloe-memory.md
  ├── max-memory.md
  ├── ada-memory.md
  └── cipher-memory.md
```

## Architecture

### 1. Agent Generator CLI (`src/`)

An interactive CLI tool that scaffolds new AI agents via a step-by-step interview. The flow is:

1. `src/index.ts` — Entry point. Calls `runInterview()` then `generateAgent()`.
2. `src/cli/prompts.ts` — Collects user config (`AgentConfig`: name, description, role/system-prompt, workspace flag) using `@clack/prompts`.
3. `src/cli/validations.ts` — Input validation functions used by the prompts.
4. `src/generators/agentGenerator.ts` — Creates the agent directory, writes `package.json`, `.env`, optionally a `workspace/` folder, and the main `index.ts` by injecting config into templates. Exports `generateAgentCore()` (no terminal deps) for use by the Electrobun main process.
5. `src/generators/fileSystem.ts` — Low-level fs helpers; `copyTemplateAndInject()` replaces `{{KEY}}` placeholders in `.tpl` files.
6. `src/templates/basic-agent/` — Templates (`index.ts.tpl`, `package.json.tpl`) for generated agents. Placeholders: `{{AGENT_NAME}}`, `{{AGENT_DESCRIPTION}}`, `{{AGENT_CLASS}}`, `{{SYSTEM_ROLE}}`.
7. `src/utils/logger.ts` — Styled terminal output via `@clack/prompts` and `picocolors`.

Generated agents use `@agentclientprotocol/sdk` (ACP standard) and `@lmstudio/sdk` (LM Studio). They communicate via **stdin/stdout** using `ndJsonStream` — not HTTP. LM Studio must be running locally at `localhost:1234` with a model loaded. The optional `LM_STUDIO_MODEL` env var selects a specific model; if omitted, the first available model is used.

Generated agents support two modes automatically (detected via `process.stdin.isTTY`):
- **TTY mode** (terminal): interactive REPL with LM Studio directly
- **ACP mode** (subprocess): NDJSON protocol via stdin/stdout

### 2. Electrobun Desktop App (`src/main.ts`, `src/renderer/`)

A cross-platform desktop GUI built with Electrobun (Bun + TypeScript + system webview). **In progress — see `docs/features/electrobun-migration/`.**

- `src/main.ts` — Electrobun main process. Creates the window, registers IPC handlers.
- `src/ipc/handlers.ts` — RPC handlers: `generateAgent`, `listAgents`, `createSession`, `sendMessage`.
- `src/ipc/acpManager.ts` — Manages active ACP sessions (spawn, connect, stream, cleanup).
- `src/types/ipc.ts` — Typed contracts for all main ↔ renderer communication.
- `src/renderer/` — Webview UI: agent list sidebar, create-agent form, chat interface.
- `electrobun.config.ts` — Electrobun build configuration.

The desktop app reuses `src/generators/` and `src/cli/validations.ts` without modification. The terminal CLI (`bun run dev`, `bun run chat`) remains fully functional alongside the desktop app.

### 3. `cloe/` — Example Generated Agent

A concrete agent created by the generator. Demonstrates the expected output structure: `index.ts`, `package.json`, `.env`, `workspace/`. Optionally set `LM_STUDIO_MODEL` in its `.env` to target a specific LM Studio model.

### 4. Documentation (`docs/`)

Architecture plans and technical specifications written by Leo.

```
docs/
├── features/
│   └── <feature-name>/
│       ├── plan.md           # Architecture, folder structure, priority list
│       ├── ipc-contracts.md  # Typed IPC contracts
│       ├── data-flows.md     # End-to-end data flows
│       └── acceptance.md     # Acceptance criteria checklist
└── bugs/
    └── <id>-<slug>/
        └── status.md         # Created by /bug skill, filled by Max and Cloe
```

## Key Notes

- Template injection uses `{{KEY}}` syntax (not `${}` or other formats).
- Generated agents use `bun.lock` and Bun as their runtime as well.
- The `.env` at the repo root is for the generator itself; each generated agent has its own `.env` with `LM_STUDIO_MODEL` (optional).
- Do NOT modify `src/index.ts`, `src/client.ts`, or the TTY mode of generated agents — the terminal workflow must remain intact.
- Windows symlink issue: building Vercel-adapted Astro projects with pnpm on Windows requires Developer Mode enabled.
