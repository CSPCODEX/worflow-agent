# Workflow Agent — Generador de Agentes ACP

CLI interactivo y app de escritorio que generan agentes de IA locales basados en el protocolo [ACP (Agent Client Protocol)](https://agentclientprotocol.org/). Los agentes generados soportan multiples proveedores de LLM (LM Studio, Anthropic, OpenAI, Gemini, Ollama) y se comunican via NDJSON sobre stdin/stdout.

## Requisitos

- [Bun](https://bun.sh/) >= 1.0
- Al menos uno de los siguientes proveedores:
  - [LM Studio](https://lmstudio.ai/) corriendo en `localhost:1234` (local, sin API key)
  - API key de Anthropic, OpenAI o Google Gemini
  - [Ollama](https://ollama.ai/) corriendo localmente

## Instalacion

```bash
bun install
```

## Uso

### 1. Generar un agente nuevo (CLI)

```bash
bun run dev
```

El CLI hace una entrevista interactiva y genera el agente:

| Campo | Descripcion |
|---|---|
| Nombre | Identificador del agente (ej: `mi-agente`) |
| Descripcion | Breve descripcion del proposito |
| System Prompt | Rol e instrucciones que definen el comportamiento |
| Proveedor | LM Studio, Anthropic, OpenAI, Gemini, Ollama |
| Workspace | Si el agente va a manipular archivos locales |

Al finalizar, se crea la carpeta `<nombre-agente>/` con todo configurado y las dependencias instaladas.

### 2. Generar un agente (App de escritorio)

```bash
bun run desktop
```

Abre la app Electrobun con interfaz grafica para crear, listar, chatear y eliminar agentes. Los agentes creados desde la app se persisten en SQLite.

### 3. Chatear con un agente (CLI)

```bash
bun run chat <nombre-agente>
```

Lanza el agente como subproceso, establece una sesion ACP y abre un REPL interactivo:

```
Conectando con el agente "max"...
Conectado. Sesion: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
Escribe tu mensaje (Ctrl+C para salir)

Tu: explica que hace esta funcion
Agente: ...
```

## Estructura del proyecto

```
worflow-agent/
├── src/
│   ├── index.ts                  # Entry point del generador CLI (bun run dev)
│   ├── client.ts                 # Cliente ACP interactivo (bun run chat)
│   ├── cli/
│   │   ├── prompts.ts            # Entrevista interactiva con @clack/prompts
│   │   └── validations.ts        # Validaciones de los inputs
│   ├── db/
│   │   ├── database.ts           # Inicializacion SQLite (bun:sqlite)
│   │   ├── migrations.ts         # Migraciones append-only
│   │   ├── agentRepository.ts    # CRUD de agentes
│   │   ├── conversationRepository.ts  # CRUD de mensajes
│   │   └── userDataDir.ts        # Ruta cross-platform de datos de usuario
│   ├── enhancer/
│   │   ├── promptEnhancer.ts     # Orquestador: LM Studio → fallback estatico
│   │   ├── lmStudioEnhancer.ts   # Mejora de prompts via LM Studio
│   │   ├── staticEnhancer.ts     # Mejora de prompts sin LLM
│   │   └── metaPrompt.ts         # Meta-prompt para el enhancer
│   ├── generators/
│   │   ├── agentGenerator.ts     # Orquesta la creacion del agente
│   │   └── fileSystem.ts         # Helpers de fs e inyeccion de templates
│   ├── ipc/
│   │   ├── handlers.ts           # Handlers RPC (generateAgent, listAgents, chat...)
│   │   └── acpManager.ts         # Gestiona sesiones ACP activas
│   ├── renderer/
│   │   ├── app.ts                # Entry point del webview
│   │   ├── style.css             # Estilos globales
│   │   ├── components/
│   │   │   ├── agent-list.ts     # Sidebar con lista de agentes
│   │   │   └── confirm-dialog.ts # Dialog de confirmacion reutilizable
│   │   └── views/
│   │       ├── create-agent.ts   # Formulario de creacion
│   │       └── chat.ts           # Interfaz de chat
│   ├── templates/basic-agent/
│   │   ├── index.ts.tpl          # Codigo principal del agente generado
│   │   ├── package.json.tpl      # package.json del agente generado
│   │   └── providers/            # Un .tpl por proveedor de LLM
│   │       ├── lmstudio.ts.tpl
│   │       ├── anthropic.ts.tpl
│   │       ├── openai.ts.tpl
│   │       ├── gemini.ts.tpl
│   │       ├── ollama.ts.tpl
│   │       ├── crypto.ts.tpl
│   │       ├── factory.ts.tpl
│   │       └── types.ts.tpl
│   ├── types/
│   │   └── ipc.ts                # Contratos tipados main ↔ renderer
│   └── utils/
│       ├── crypto.ts             # Cifrado de API keys en SQLite
│       └── logger.ts             # Output estilizado con picocolors
│
├── <nombre-agente>/              # Agente generado (ej: max/)
│   ├── index.ts                  # Logica del agente (ACP + proveedor LLM)
│   ├── package.json
│   ├── .env                      # Variables de entorno del agente
│   └── workspace/                # Carpeta de archivos (si se habilito)
│
└── docs/                         # Planes y specs escritos por los agentes
    ├── features/<nombre>/        # plan.md, ipc-contracts.md, data-flows.md, acceptance.md
    └── bugs/<id>-<slug>/         # status.md con diagnostico y solucion
```

## Como funciona un agente generado

Cada agente implementa el protocolo ACP y se comunica con el proveedor LLM elegido:

- Corre como **subproceso** que recibe y envia mensajes NDJSON por `stdin/stdout`
- Mantiene **historial de conversacion** por sesion
- Usa el **system prompt** definido al generarlo para todas las respuestas
- Soporta **modo TTY** (REPL interactivo) y **modo ACP** (subproceso), detectado automaticamente via `process.stdin.isTTY`

```
bun run chat max
       |
       v
  src/client.ts  --spawn-->  max/index.ts
       |                          |
  ClientSideConnection       AgentSideConnection
       |<---- NDJSON ACP ---->   |
       |                          |
  REPL terminal              Proveedor LLM
                             (LM Studio / Anthropic / OpenAI / Gemini / Ollama)
```

## Proveedores soportados

| Proveedor | Requiere | Variable de entorno |
|---|---|---|
| LM Studio | LM Studio corriendo en `localhost:1234` | `LM_STUDIO_MODEL` (opcional) |
| Anthropic | API key | `ANTHROPIC_API_KEY` |
| OpenAI | API key | `OPENAI_API_KEY` |
| Google Gemini | API key | `GEMINI_API_KEY` |
| Ollama | Ollama corriendo localmente | `OLLAMA_MODEL` |

Cada agente generado tiene su propio `.env` con las variables necesarias para el proveedor elegido.

## Mejora automatica de prompts

Al crear un agente, el system prompt puede mejorarse automaticamente antes de guardarse:

1. Si LM Studio esta disponible, lo usa para enriquecer el prompt con el meta-prompt interno.
2. Si no, aplica un enhancer estatico basado en reglas (sin LLM).

## Sistema multi-agente

Este repositorio usa un equipo de agentes especializados para su propio desarrollo. Ver `CLAUDE.md` para el workflow completo.

| Agente | Rol |
|---|---|
| Leo | Arquitecto / Project Manager |
| Cloe | Software Engineer |
| Max | QA / SDET |
| Ada | Optimizadora |
| Cipher | DevSecOps |
