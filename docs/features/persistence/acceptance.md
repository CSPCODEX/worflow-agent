# Acceptance Criteria — Persistencia

## src/db/userDataDir.ts

- [ ] Exporta `USER_DATA_DIR`, `AGENTS_DIR` y `DB_PATH` como constantes string
- [ ] En Windows resuelve a `%APPDATA%\Worflow Agent\`
- [ ] En macOS resuelve a `~/Library/Application Support/Worflow Agent/`
- [ ] En Linux resuelve a `~/.config/worflow-agent/`
- [ ] Crea el directorio (y subdirectorio `agents/`) con `{ recursive: true }` si no existe
- [ ] Si `APPDATA` no está definido en Windows, lanza error descriptivo (no crashea silenciosamente)
- [ ] No tiene dependencias de runtime externas — solo `node:os`, `node:path`, `node:fs`

## src/db/migrations.ts

- [ ] Exporta un array `MIGRATIONS: Migration[]` donde cada elemento tiene `{ version: number, sql: string }`
- [ ] La migration v1 crea las 4 tablas: `agents`, `conversations`, `messages`, `settings`
- [ ] La migration v1 crea los índices `idx_conversations_agent` e `idx_messages_conversation`
- [ ] Las migrations son append-only (no se modifica una ya existente)
- [ ] Cada migration es idempotente (usa `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`)

## src/db/database.ts

- [ ] Exporta `initDatabase(): Promise<void>` — idempotente, seguro llamar varias veces
- [ ] Exporta un objeto o clase `db` con las queries tipadas:
  - [ ] `db.insertAgent(agent): AgentRow`
  - [ ] `db.getAllAgents(): AgentRow[]`
  - [ ] `db.getAgentByName(name): AgentRow | null`
  - [ ] `db.getAgentById(id): AgentRow | null`
  - [ ] `db.updateAgentStatus(id, status): void`
  - [ ] `db.insertConversation(conv): ConversationRow`
  - [ ] `db.getConversationsByAgent(agentId): ConversationRow[]`
  - [ ] `db.deleteConversation(id): void`
  - [ ] `db.insertMessage(msg): MessageRow`
  - [ ] `db.getMessagesByConversation(conversationId): MessageRow[]`
- [ ] Usa `bun:sqlite` (import `{ Database } from 'bun:sqlite'`) — no instala paquetes externos
- [ ] Abre la DB en `DB_PATH` (de userDataDir.ts)
- [ ] Aplica todas las migrations en orden al inicializar
- [ ] Usa `WAL` journal mode para lectura/escritura concurrente sin bloqueos
- [ ] Todas las queries usan prepared statements (no interpolación de strings)

## src/ipc/handlers.ts

- [ ] `generateAgent`:
  - [ ] Valida nombre antes de crear el directorio (si falla, no hay carpeta huérfana)
  - [ ] Verifica que el nombre no exista ya en DB antes de scaffoldAgent
  - [ ] Usa `AGENTS_DIR` como `baseDir` en lugar de `process.cwd()`
  - [ ] Inserta el agente en DB tras scaffold exitoso
  - [ ] Si el INSERT en DB falla después de scaffold, intenta eliminar la carpeta creada (best-effort)
  - [ ] Retorna `{ success: false, error: 'Agent name already exists' }` para nombres duplicados
- [ ] `listAgents`:
  - [ ] Lee de DB en lugar de escanear filesystem
  - [ ] Detecta agentes con path inexistente y marca `status = 'broken'` en DB + resultado
  - [ ] Agentes `broken` aparecen en la lista (no se filtran)
  - [ ] No crashea si DB está vacía — retorna `{ agents: [] }`
- [ ] `createSession`:
  - [ ] Consulta DB por nombre para obtener el `path` absoluto
  - [ ] Retorna error si el agente no existe en DB
  - [ ] Retorna error si `status === 'broken'`
  - [ ] Llama a `acpManager.createSession(agentName, agentPath)` con la firma extendida
- [ ] `createConversation` (nuevo):
  - [ ] Crea conversación vinculada a `agentId`
  - [ ] Retorna `ConversationInfo` completo
- [ ] `listConversations` (nuevo):
  - [ ] Filtra por `agentId`
  - [ ] Orden: `created_at DESC`
- [ ] `getMessages` (nuevo):
  - [ ] Filtra por `conversationId`
  - [ ] Orden: `created_at ASC`
- [ ] `saveMessage` (nuevo):
  - [ ] Inserta mensaje con role `'user'` o `'assistant'`
  - [ ] Retorna `MessageInfo` completo con `id` y `createdAt`
- [ ] `deleteConversation` (nuevo):
  - [ ] Elimina la conversación y sus mensajes (CASCADE en DB)
  - [ ] Retorna `{ success: true }` incluso si el ID no existía (idempotente)

## src/ipc/acpManager.ts

- [ ] `createSession(agentName, agentPath)` acepta segundo parámetro `agentPath: string`
- [ ] Ya no compone el path con `process.cwd()` — usa el `agentPath` recibido directamente
- [ ] El resto de la lógica (spawn, ACP handshake, streaming) no cambia

## src/types/ipc.ts

- [ ] `AgentInfo` incluye campos `id`, `status`, `createdAt`
- [ ] `CreateSessionParams` mantiene `agentName` (sin cambio de firma desde renderer)
- [ ] Nuevas interfaces: `ConversationInfo`, `MessageInfo`, `CreateConversationParams/Result`,
  `ListConversationsParams/Result`, `GetMessagesParams/Result`, `SaveMessageParams/Result`,
  `DeleteConversationParams/Result`
- [ ] `AppRPC` incluye los 5 nuevos channels de requests

## src/desktop/index.ts

- [ ] Llama a `initDatabase()` antes de `createRpc()`
- [ ] Si `initDatabase()` lanza error, el proceso termina con mensaje descriptivo (no arranca con DB rota)

## Renderer (agent-list.ts, create-agent.ts, app.ts)

- [ ] Agentes con `status === 'broken'` se muestran con clase CSS `agent-item--broken`
- [ ] Click en agente `broken` muestra mensaje "Directorio no encontrado" en lugar de abrir chat
- [ ] El formulario de creación muestra `'Agent name already exists'` si el nombre ya está en DB
- [ ] La lista de agentes se recarga correctamente tras crear uno nuevo (comportamiento sin cambios)

## Compatibilidad CLI

- [ ] `bun run dev` sigue funcionando sin tocar DB
- [ ] `bun run chat <agent>` sigue funcionando sin tocar DB
- [ ] `src/index.ts` y `src/client.ts` sin modificaciones
- [ ] `src/generators/agentGenerator.ts` sin modificaciones (scaffoldAgent recibe baseDir por param)

## Regresion

- [ ] Los agentes creados antes de esta feature (en `process.cwd()`) no crashean la app
  — simplemente no están en DB y no aparecen en `listAgents` (comportamiento aceptable)
- [ ] Un agente creado con la nueva feature persiste entre reinicios de la app
- [ ] El historial de mensajes de una conversación se recupera correctamente tras reiniciar
