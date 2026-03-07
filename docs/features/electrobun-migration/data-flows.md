# Flujos de datos — Electrobun Migration

## Flujo A — Crear agente nuevo

```
renderer/views/create-agent.ts
  │
  ├─ Valida inputs con src/cli/validations.ts (client-side)
  │
  └─ invoke('generateAgent', AgentConfig)
        │
        └─ ipc/handlers.ts
              │
              └─ generateAgentCore(config, cwd())
                    │
                    ├─ fileSystem.ts → createDirectory()
                    ├─ copyTemplateAndInject() → index.ts
                    ├─ copyTemplateAndInject() → package.json
                    ├─ writeFile() → .env
                    └─ spawnSync('bun install')
              │
              └─ retorna GenerateAgentResult { success, agentDir?, error? }
  │
  └─ UI: muestra éxito con agentDir o error descriptivo
         Actualiza sidebar con listAgents()
```

## Flujo B — Chatear con un agente

```
renderer/components/agent-list.ts
  └─ usuario selecciona agente → navega a chat view

renderer/views/chat.ts
  └─ invoke('createSession', { agentName })
        └─ ipc/acpManager.ts
              ├─ spawn('bun', ['run', agentEntry], { stdio: ['pipe','pipe','inherit'] })
              ├─ ndJsonStream(agentProcess.stdin, agentProcess.stdout)
              ├─ ClientSideConnection → initialize() → newSession()
              └─ guarda en Map: sessionId → { process, connection }
        └─ retorna CreateSessionResult { success, sessionId }

  └─ usuario escribe mensaje → invoke('sendMessage', { sessionId, message })
        └─ acpManager → connection.prompt({ sessionId, prompt: [{ type:'text', text }] })
              └─ onSessionUpdate (agentMessageChunk)
                    └─ emit evento 'agentMessageChunk' al renderer
              └─ onPromptComplete
                    └─ emit evento 'agentMessageEnd' al renderer

  renderer escucha:
  ├─ 'agentMessageChunk' → append text al bubble de respuesta
  └─ 'agentMessageEnd'   → oculta spinner, habilita input
```

## Flujo C — Listar agentes

```
renderer arranca (app.ts)
  └─ invoke('listAgents')
        └─ ipc/handlers.ts
              └─ scan cwd() → dirs que contienen index.ts + package.json
              └─ lee package.json de cada agente → { name, description }
              └─ detecta si existe workspace/ → hasWorkspace
        └─ retorna ListAgentsResult { agents: AgentInfo[] }
  └─ agent-list.ts renderiza sidebar
```

## Flujo D — Cierre limpio

```
app Electrobun cierra (evento 'will-quit')
  └─ main.ts → acpManager.closeAll()
        └─ por cada sesión activa:
              ├─ connection.close() si está disponible
              └─ agentProcess.kill()
```
