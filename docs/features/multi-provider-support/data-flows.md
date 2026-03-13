# Data Flows — Multi-Provider LLM Support

---

## Flujo 1: Creación de un agente con proveedor seleccionado (Desktop)

```
Usuario (Renderer)                  Main Process (Bun)              Filesystem / DB
      |                                    |                               |
      | -- click "Crear agente" ---------> |                               |
      |    { name, description, role,      |                               |
      |      needsWorkspace, provider }    |                               |
      |                                    |                               |
      |                          validateProvider(provider)               |
      |                          validateAgentName(name)                  |
      |                          agentRepository.findByName(name) ------> DB (check duplicate)
      |                                    | <----- null (no existe)       |
      |                                    |                               |
      |                          scaffoldAgent(config, AGENTS_DIR)        |
      |                                    | -- mkdir <agent>/            -> FS
      |                                    | -- mkdir <agent>/providers/  -> FS
      |                                    | -- copy index.ts.tpl         -> FS (index.ts)
      |                                    | -- inject package.json.tpl   -> FS (con PROVIDER_DEP)
      |                                    | -- copy providers/*.ts.tpl   -> FS (todos los providers)
      |                                    | -- write .env                -> FS (PROVIDER=xxx + vars)
      |                                    | -- mkdir workspace/          -> FS (si needsWorkspace)
      |                                    |                               |
      |                          agentRepository.insert({ ...config,      |
      |                            provider: config.provider })  -------> DB (INSERT agents)
      |                                    |                               |
      | <-- { success: true } ----------- |                               |
      |                                    |                               |
      | [background tasks, paralelo]       |                               |
      |                          installAgentDeps(agentDir) -----------> bun install
      |                          enhanceAndPersist(...)  ------------> LM Studio (si disponible)
      |                                    |                               |
      | <-- agentInstallDone (rpc.send) -- |                               |
      | <-- agentEnhanceDone (rpc.send) -- |                               |
      |                                    |                               |
      | [navega al listado]                |                               |
```

**Punto clave:** `scaffoldAgent` usa `config.provider` para:
1. Seleccionar qué línea inyectar en `package.json` (`PROVIDER_DEP` placeholder)
2. Generar el `.env` con `PROVIDER=<id>` y las variables específicas del proveedor

---

## Flujo 2: Creación de un agente con proveedor seleccionado (CLI)

```
Terminal (TTY)                     src/index.ts              agentGenerator.ts
    |                                   |                          |
    | bun run dev                       |                          |
    |---------------------------------> |                          |
    |                          runInterview()                      |
    |                                   |                          |
    | <-- "¿Nombre del agente?" -----   |                          |
    | -- "mi-agente" ----------------> |                          |
    | <-- "¿Descripción?" -----------  |                          |
    | -- "Un asistente..." ----------> |                          |
    | <-- "¿System Prompt?" ---------  |                          |
    | -- "Eres un experto..." -------> |                          |
    | <-- "¿Workspace?" -------------  |                          |
    | -- yes/no ---------------------  |                          |
    | <-- "¿Proveedor?" [select] ----  |                          |  <- NUEVO
    |    lmstudio / ollama / openai    |                          |
    |    anthropic / gemini            |                          |
    | -- "openai" -------------------> |                          |
    |                                   |                          |
    |                          generateAgent(config)               |
    |                                   | --(scaffoldAgent)------> |
    |                                   |    config.provider       |
    |                                   |    = 'openai'            |
    |                                   |                          | -- inject PROVIDER_DEP
    |                                   |                          |    "openai": "^4.0.0"
    |                                   |                          | -- write .env:
    |                                   |                          |    PROVIDER=openai
    |                                   |                          |    OPENAI_API_KEY=""
    |                                   |                          |    OPENAI_MODEL="gpt-4o-mini"
    |                                   |                          | -- copy providers/*.ts
    |                                   |                          |
    |                                   | --(bun install)--------> mi-agente/
    |                                   |                          |
    | <-- "Agente listo!" ------------ |                          |
    |     "Edita mi-agente/.env"        |                          |
    |     "Pon tu OPENAI_API_KEY"       |                          |
```

---

## Flujo 3: Ejecución de un agente generado (modo ACP)

```
acpManager.ts (Main)        Agente subprocess (index.ts)      Provider SDK
      |                              |                               |
      | Bun.spawn(['bun', 'start'])  |                               |
      | ---------------------------> |                               |
      |                     dotenv.config()                         |
      |                     process.env.PROVIDER = 'openai'        |
      |                     createProvider()                        |
      |                              | -- factory.ts switch         |
      |                              |    case 'openai'             |
      |                              |    new OpenAIProvider()  --> | OpenAI SDK init
      |                     !process.stdin.isTTY                   |
      |                     → modo ACP                             |
      |                     ndJsonStream(stdout, stdin)             |
      |                     new AgentSideConnection(...)            |
      |                              |                               |
      | -- ACP Initialize ----------> |                               |
      | <-- InitializeResponse ------ |                               |
      | -- ACP NewSession ----------> |                               |
      | <-- NewSessionResponse ------- |                               |
      | -- ACP Prompt (userText) ----> |                               |
      |                     provider.chatStream(messages, onChunk)  |
      |                              | -- API call ----------------> | OpenAI API
      |                              | <-- stream chunks ----------- |
      |                     for await fragment:                      |
      |                       connection.sessionUpdate(chunk)        |
      | <-- sessionUpdate (chunks) -- |                               |
      | <-- PromptResponse ---------- |                               |
      |                              |                               |
```

**Punto clave:** `acpManager.ts` no necesita saber qué proveedor usa el agente. El agente es una caja negra ACP — la selección del proveedor ocurre dentro del subprocess al leer su propio `.env`.

---

## Flujo 4: Ejecución de un agente generado (modo TTY)

```
Terminal                    index.ts                    Provider SDK
    |                          |                              |
    | bun run start             |                              |
    | ------------------------> |                              |
    |                  dotenv.config()                        |
    |                  process.env.PROVIDER = 'anthropic'    |
    |                  createProvider()                       |
    |                  → new AnthropicProvider()  ---------> | Anthropic SDK init
    |                  process.stdin.isTTY = true            |
    |                  → modo TTY REPL                       |
    |                          |                              |
    | <-- "Modo interactivo..." |                              |
    | "Tu: " <---------------- |                              |
    | -- "Hola" ------------> |                              |
    |                  provider.chatStream(                   |
    |                    messages, onChunk)                   |
    |                          | -- API call --------------> | Claude API
    |                          | <-- stream chunks --------- |
    |                  process.stdout.write(chunk)            |
    | <-- "Hola! Soy..." ----  |                              |
    | "Tu: " <---------------- |                              |
```

---

## Flujo 5: Renderer solicita lista de proveedores (Desktop)

```
Renderer                         Main Process
    |                                 |
    | rpc.request.listProviders()     |
    | --------------------------------> |
    |                        [lista hardcodeada en memoria]
    |                        ProviderId[], ProviderInfo[]
    | <-- { providers: [...] } ------- |
    |                                 |
    | Render <select> con 5 opciones  |
    | Default: 'lmstudio'             |
```

Este flujo es síncrono y sin I/O — la lista de proveedores es estática.

---

## Flujo 6: Usuario carga agentes existentes (listAgents)

```
Renderer                  Main Process             DB
    |                          |                    |
    | rpc.request.listAgents() |                    |
    | ------------------------> |                    |
    |               agentRepository.findAll() ---> SELECT * FROM agents
    |                          | <--- rows --------- |
    |               for each row:                    |
    |                 check path exists (sync)       |
    |                 if not: mark broken            |
    |               map rows → AgentInfo[]           |
    |               (incluye provider field)         |
    | <-- { agents: [...] } --- |                    |
    |                          |                    |
    | Render sidebar con badge |                    |
    | del proveedor por agente |                    |
```

`AgentInfo.provider` se muestra en el sidebar como badge informativo ("OpenAI", "LM Studio", etc.). Agentes existentes muestran "LM Studio" (default de migration).

---

## Diagrama de relaciones entre módulos modificados

```
src/cli/prompts.ts
  AgentConfig { + provider }
        |
        | importado por
        v
src/types/ipc.ts
  ProviderId (definido aquí)
  ProviderInfo
  ListProvidersResult
  AgentInfo { + provider }
  AppRPC { + listProviders }
        |
        | usado por
        +-------------------> src/ipc/handlers.ts
        |                       handler: listProviders (estático)
        |                       handler: generateAgent → pasa provider a:
        |                         scaffoldAgent(config)
        |                         agentRepository.insert({...provider})
        |
        +-------------------> src/renderer/views/create-agent.ts
                                <select> proveedor
                                envía config.provider en generateAgent call

src/generators/agentGenerator.ts
  scaffoldAgent(config, baseDir)
        |
        | crea en <agentDir>/
        +---> providers/ (copia todos los .tpl)
        +---> .env (PROVIDER=config.provider + vars específicas)
        +---> package.json (PROVIDER_DEP inyectado)
        +---> index.ts (usa createProvider() — sin cambio de estructura)

src/db/migrations.ts
  v3: ALTER TABLE agents ADD COLUMN provider TEXT DEFAULT 'lmstudio'

src/db/agentRepository.ts
  AgentRow { + provider }
  AgentRecord { + provider }
  insert({ + provider })
  rowToRecord → mapea provider
```

---

## Mapa de variables de entorno por proveedor

```
PROVEEDOR     | PROVIDER=  | API KEY VAR        | MODEL VAR           | Requiere servicio local?
--------------+------------+--------------------+---------------------+-------------------------
LM Studio     | lmstudio   | (ninguna)          | LM_STUDIO_MODEL     | Sí (localhost:1234)
Ollama        | ollama     | (ninguna)          | OLLAMA_MODEL        | Sí (localhost:11434)
OpenAI        | openai     | OPENAI_API_KEY     | OPENAI_MODEL        | No (API remota)
Anthropic     | anthropic  | ANTHROPIC_API_KEY  | ANTHROPIC_MODEL     | No (API remota)
Gemini        | gemini     | GEMINI_API_KEY     | GEMINI_MODEL        | No (API remota)
```

---

## Invariantes del sistema (no deben romperse)

1. `process.stdin.isTTY` detecta modo — no depende del proveedor. Se mantiene.
2. `acpManager.ts` no importa ningún SDK de proveedor — los agentes son subprocesos opacos.
3. El enhancer (`src/enhancer/`) siempre usa LM Studio del host — no el provider del agente.
4. El CLI `bun run chat <agente>` lanza el agente como subproceso ACP — funciona con cualquier proveedor.
5. Agentes ya creados con proveedor `lmstudio` siguen funcionando sin re-generarse.
6. Cambiar de proveedor en un agente existente requiere editar `.env` manualmente (no hay UI para eso en esta feature).
