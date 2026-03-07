# Workflow Agent — Generador de Agentes ACP con LM Studio

CLI interactivo que genera agentes de IA locales basados en el protocolo [ACP (Agent Client Protocol)](https://agentclientprotocol.org/) y [LM Studio](https://lmstudio.ai/). Cada agente generado se comunica con un modelo local sin necesidad de APIs externas.

## Requisitos

- [Bun](https://bun.sh/) >= 1.0
- [LM Studio](https://lmstudio.ai/) corriendo localmente en `localhost:1234` con al menos un modelo cargado

## Instalacion

```bash
bun install
```

## Uso

### 1. Generar un agente nuevo

```bash
bun run dev
```

El CLI hace una entrevista interactiva y genera el agente con las respuestas:

| Campo | Descripcion |
|---|---|
| Nombre | Identificador del agente (ej: `mi-agente`) |
| Descripcion | Breve descripcion del proposito |
| System Prompt | Rol e instrucciones que definen el comportamiento |
| Workspace | Si el agente va a manipular archivos locales |

Al finalizar, se crea la carpeta `<nombre-agente>/` con todo configurado y las dependencias instaladas.

### 2. Chatear con un agente

```bash
bun run chat <nombre-agente>
```

Ejemplo:

```bash
bun run chat max
```

Esto lanza el agente como subproceso, establece una sesion ACP y abre un REPL interactivo en la terminal:

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
│   ├── index.ts                  # Entry point del generador (bun run dev)
│   ├── client.ts                 # Cliente ACP interactivo (bun run chat)
│   ├── cli/
│   │   ├── prompts.ts            # Entrevista interactiva con @clack/prompts
│   │   └── validations.ts        # Validaciones de los inputs
│   ├── generators/
│   │   ├── agentGenerator.ts     # Orquesta la creacion del agente
│   │   └── fileSystem.ts         # Helpers de fs e inyeccion de templates
│   ├── templates/
│   │   └── basic-agent/
│   │       ├── index.ts.tpl      # Codigo del agente generado
│   │       └── package.json.tpl  # package.json del agente generado
│   └── utils/
│       └── logger.ts             # Output estilizado con picocolors
│
├── <nombre-agente>/              # Agente generado (ej: max/)
│   ├── index.ts                  # Logica del agente (ACP + LM Studio)
│   ├── package.json
│   ├── .env                      # LM_STUDIO_MODEL (opcional)
│   └── workspace/                # Carpeta de archivos (si se habilito)
│
└── .agents/                      # Sistema de agentes multi-rol (ver abajo)
```

## Como funciona un agente generado

Cada agente implementa el protocolo ACP usando `@agentclientprotocol/sdk` y se comunica con LM Studio via `@lmstudio/sdk`:

- Corre como **subproceso** que recibe y envia mensajes NDJSON por `stdin/stdout`
- Mantiene **historial de conversacion** por sesion
- Usa el **system prompt** definido al generarlo para todas las respuestas
- Selecciona el modelo de LM Studio automaticamente (o el especificado en `.env`)

```
bun run chat max
       |
       v
  src/client.ts  --spawn-->  max/index.ts
       |                          |
  ClientSideConnection       AgentSideConnection
       |<---- NDJSON ACP ---->   |
       |                          |
  REPL terminal              LMStudioClient
                                  |
                             modelo local
```

### Variable de entorno del agente

Cada agente tiene su propio `.env`:

```env
LM_STUDIO_MODEL=""   # Dejar vacio para usar el primer modelo disponible
                     # O especificar el ID: "lmstudio-community/Meta-Llama-3-8B-Instruct-GGUF"
```

## Sistema multi-agente (`.agents/`)

Carpeta de configuracion para un equipo de agentes especializados de desarrollo. No es ejecutada por este codebase — son definiciones de roles para usar con un orquestador externo de IA.

| Agente | Rol |
|---|---|
| Leo | Arquitecto / Project Manager |
| Cloe | Frontend Developer |
| Max | QA |
| Felix | Bug Fixer |
| Ada | Optimizadora de rendimiento |
| Cipher | Seguridad |

Los workflows se invocan con comandos como `/1-agente-arquitecto` y comparten memoria en `.agents/memory/`.
