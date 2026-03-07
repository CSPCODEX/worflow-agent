# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This project uses **Bun** as the runtime and package manager. Do not use npm or pnpm.

```bash
# Install dependencies
bun install

# Run the CLI generator (interactive)
bun run src/index.ts

# Run a generated agent (e.g., the "max" agent)
# NOTE: agents communicate via ACP (NDJSON over stdin/stdout), not plain text.
# They must be launched by an ACP-compatible client (e.g., Claude Desktop), not run directly.
cd max && bun run start
```

There are no tests or lint scripts configured.

## Architecture

This repo has two distinct concerns:

### 1. Agent Generator CLI (`src/`)

An interactive CLI tool that scaffolds new AI agents via a step-by-step interview. The flow is:

1. `src/index.ts` — Entry point. Calls `runInterview()` then `generateAgent()`.
2. `src/cli/prompts.ts` — Collects user config (`AgentConfig`: name, description, role/system-prompt, workspace flag) using `@clack/prompts`.
3. `src/cli/validations.ts` — Input validation functions used by the prompts.
4. `src/generators/agentGenerator.ts` — Creates the agent directory, writes `package.json`, `.env`, optionally a `workspace/` folder, and the main `index.ts` by injecting config into templates.
5. `src/generators/fileSystem.ts` — Low-level fs helpers; `copyTemplateAndInject()` replaces `{{KEY}}` placeholders in `.tpl` files.
6. `src/templates/basic-agent/` — Templates (`index.ts.tpl`, `package.json.tpl`) for generated agents. Placeholders: `{{AGENT_NAME}}`, `{{AGENT_DESCRIPTION}}`, `{{AGENT_CLASS}}`, `{{SYSTEM_ROLE}}`.
7. `src/utils/logger.ts` — Styled terminal output via `@clack/prompts` and `picocolors`.

Generated agents use `@agentclientprotocol/sdk` (ACP standard) and `@lmstudio/sdk` (LM Studio). They communicate via **stdin/stdout** using `ndJsonStream` — not HTTP. LM Studio must be running locally at `localhost:1234` with a model loaded. The optional `LM_STUDIO_MODEL` env var selects a specific model; if omitted, the first available model is used.

### 2. Multi-Agent Workflow System (`.agents/`)

A configuration layer for a separate AI agent team, framework-agnostic (Astro, Next.js, React, Vue). Not executed by this codebase — it's a set of workflow definitions and shared memory files for use with an external AI agent orchestration tool.

- `.agents/workflows/` — Markdown files defining each specialized agent's role, invoked via commands like `/1-agente-arquitecto`.
- `.agents/memory/` — Shared knowledge files agents read/write: `architecture.md`, `ui_and_styling.md`, `performance.md`, `rules.md`, `security.md`.
- `.agents/skills/scan-secrets/` — A skill definition.

The agent team includes: Leo (Architect/PM), Cloe (Frontend Dev), Max (QA), Felix (Bug Fixer), Ada (Optimizer), and Cipher (Security).

### 3. `max/` — Example Generated Agent

A concrete agent created by the generator. Demonstrates the expected output structure: `index.ts`, `package.json`, `.env`, `workspace/`. Optionally set `LM_STUDIO_MODEL` in its `.env` to target a specific LM Studio model.

## Key Notes

- Template injection uses `{{KEY}}` syntax (not `${}` or other formats).
- Generated agents use `bun.lock` and Bun as their runtime as well.
- The `.env` at the repo root is for the generator itself; each generated agent has its own `.env` with `LM_STUDIO_MODEL` (optional).
- Windows symlink issue: building Vercel-adapted Astro projects with pnpm on Windows requires Developer Mode enabled (see `.agents/memory/architecture.md`).
