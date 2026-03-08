# Data Flows — Persistencia

---

## Flujo 1 — Crear agente

```
Renderer (create-agent.ts)
  |
  | rpc.request.generateAgent({ name, description, role, needsWorkspace })
  v
Handler: generateAgent (handlers.ts)
  |
  |-- 1. validateAgentName(config.name)
  |
  |-- 2. userDataDir() → "<APPDATA>/Worflow Agent"
  |       (resuelto por src/db/userDataDir.ts, constante en memoria)
  |
  |-- 3. baseDir = path.join(userDataDir, "agents")
  |       fs.mkdirSync(baseDir, { recursive: true })
  |
  |-- 4. scaffoldAgent(config, baseDir)
  |       → agentDir = "<userDataDir>/agents/<name>"
  |       → crea index.ts, package.json, .env, workspace/ (si aplica)
  |
  |-- 5. db.insertAgent({
  |         id: randomUUID(),
  |         name: config.name,
  |         description: config.description,
  |         system_prompt: config.role,
  |         model: '',
  |         has_workspace: config.needsWorkspace ? 1 : 0,
  |         path: agentDir,
  |         status: 'active',
  |         created_at: new Date().toISOString(),
  |       })
  |
  |-- 6. return { success: true, agentDir }
  |
  |-- 7. [background] installAgentDeps(agentDir, callback)
  |         → cuando termina: rpc.send.agentInstallDone(...)
  v
Renderer recibe scaffold OK → muestra "Instalando dependencias..."
Renderer recibe agentInstallDone → muestra "Agente listo."
```

**Error path:** si el agente ya existe en DB (UNIQUE name), el INSERT falla.
El handler captura el error y retorna `{ success: false, error: 'Agent name already exists' }`.
La carpeta no llega a crearse (el INSERT falla antes de scaffoldAgent si se valida primero,
o se limpia el directorio si ya fue creado — ver acceptance.md para orden exacto de validación).

---

## Flujo 2 — Listar agentes

```
Renderer (agent-list.ts)
  |
  | rpc.request.listAgents()
  v
Handler: listAgents (handlers.ts)
  |
  |-- 1. db.getAllAgents()
  |       → SELECT * FROM agents ORDER BY created_at DESC
  |
  |-- 2. Para cada agente:
  |       alive = existsSync(agent.path)
  |       if (!alive && agent.status !== 'broken'):
  |         db.updateAgentStatus(agent.id, 'broken')
  |         agent.status = 'broken'
  |
  |-- 3. return { agents: agentRows.map(toAgentInfo) }
  |
  v
Renderer muestra lista:
  - status 'active'  → item normal, clickeable
  - status 'broken'  → item con clase CSS "broken", icono de advertencia,
                        no lanza createSession al hacer click
```

**Sin agentes en DB:** `agents = []` → renderer muestra "Sin agentes. Crea uno nuevo."

---

## Flujo 3 — Iniciar sesion de chat

```
Renderer (chat view)
  |
  | rpc.request.createSession({ agentName })
  v
Handler: createSession (handlers.ts)
  |
  |-- 1. db.getAgentByName(agentName)
  |       → SELECT * FROM agents WHERE name = ?
  |
  |-- 2. if (!agent) return { success: false, error: 'Agent not found in DB' }
  |
  |-- 3. if (agent.status === 'broken')
  |       return { success: false, error: 'Agent directory is missing' }
  |
  |-- 4. acpManager.createSession(agentName, agent.path)
  |       → spawn('bun', ['run', index.ts], { cwd: agent.path })
  |       → ACP handshake
  |       → return { success: true, sessionId }
  |
  |-- 5. [opcional en esta feature] db.createConversation({
  |         id: randomUUID(),
  |         agent_id: agent.id,
  |         title: 'Nueva conversacion',
  |         created_at: new Date().toISOString(),
  |       })
  |       → return conversationId junto con sessionId
  v
Renderer abre vista de chat con sessionId (y conversationId si aplica)
```

---

## Flujo 4 — Guardar mensaje (user + assistant)

```
Renderer (chat view)
  |
  | -- usuario escribe mensaje --
  |
  | 1. rpc.request.saveMessage({ conversationId, role: 'user', content })
  |     → db.insertMessage → return { success, message }
  |
  | 2. rpc.request.sendMessage({ sessionId, message })
  |     → acpManager.sendMessage(...)
  |     → streaming via agentMessageChunk events
  |
  | 3. [al recibir agentMessageEnd]
  |     rpc.request.saveMessage({
  |       conversationId,
  |       role: 'assistant',
  |       content: textoAcumulado
  |     })
  v
Historial persistido. En el próximo arranque, getMessages(conversationId) recupera todo.
```

**Nota:** el renderer acumula chunks en memoria durante el streaming.
Solo al recibir `agentMessageEnd` llama a `saveMessage` con el texto completo del assistant.

---

## Flujo 5 — Cargar historial de conversacion

```
Renderer (chat view)
  |
  | rpc.request.listConversations({ agentId })
  v
Handler: listConversations
  |-- SELECT * FROM conversations WHERE agent_id = ? ORDER BY created_at DESC
  v
Renderer muestra lista de conversaciones (barra lateral o dropdown)

Usuario selecciona conversacion
  |
  | rpc.request.getMessages({ conversationId })
  v
Handler: getMessages
  |-- SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC
  v
Renderer renderiza mensajes en el chat (user/assistant alternados)
```

---

## Inicializacion de la DB al arranque

```
src/desktop/index.ts
  |
  | import { initDatabase } from '../db/database'
  | await initDatabase()   ← crea userDataDir, abre worflow.db, aplica migrations
  |
  | const rpc = createRpc()
  | ...BrowserWindow...
```

`initDatabase()` es idempotente: si la DB ya existe, las migrations que ya se aplicaron
son no-op (CREATE TABLE IF NOT EXISTS + registro en tabla interna de versiones).

---

## Resolucion de userDataDir

```
src/db/userDataDir.ts
  |
  | process.platform === 'win32'
  |   → path.join(process.env.APPDATA!, 'Worflow Agent')
  |
  | process.platform === 'darwin'
  |   → path.join(os.homedir(), 'Library', 'Application Support', 'Worflow Agent')
  |
  | default (linux)
  |   → path.join(os.homedir(), '.config', 'worflow-agent')
  |
  | fs.mkdirSync(dir, { recursive: true })
  | export const USER_DATA_DIR: string = dir
  | export const AGENTS_DIR: string = path.join(dir, 'agents')
  | export const DB_PATH: string = path.join(dir, 'worflow.db')
```
