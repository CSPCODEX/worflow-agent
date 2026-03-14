# Criterios de aceptacion — Suite de tests

## Criterios generales

- [ ] `bun test` pasa sin errores en la rama feature/suite-tests-ipc-db
- [ ] Ningun test existente (si hubiera) regresa al estado FAIL
- [ ] No se agregaron dependencias nuevas al `package.json` (Bun test runner es nativo)
- [ ] El flujo CLI `bun run dev` y `bun run chat` siguen funcionando sin cambios (refactor es interno)

---

## Criterios por modulo

### validations.ts

- [ ] 7 casos de test, todos pasan
- [ ] `validateAgentName('')` retorna string de error
- [ ] `validateAgentName('Mi-Agente')` retorna string de error (mayusculas)
- [ ] `validateAgentName('mi-agente-1')` retorna `undefined`
- [ ] `validateRole('corto')` retorna string de error (< 10 chars)
- [ ] `validateRole('suficientemente largo')` retorna `undefined`
- [ ] `validateDescription('')` retorna string de error
- [ ] `validateDescription('desc')` retorna `undefined`

### migrations.test.ts

- [ ] `initDatabase(':memory:')` no lanza
- [ ] Despues de `applyMigrations`, `SELECT MAX(version) FROM schema_version` retorna 3
- [ ] Segunda llamada a `applyMigrations` no lanza (idempotencia)
- [ ] Tabla `agents` tiene columnas: `id`, `name`, `description`, `system_prompt`, `model`, `has_workspace`, `path`, `status`, `created_at`, `enhance_status`, `provider`
- [ ] Tabla `conversations` tiene columna `agent_id` con FK hacia `agents`
- [ ] Tabla `messages` tiene CHECK constraint en `role`

### agentRepository.test.ts

- [ ] `insert()` con datos validos retorna `AgentRecord` con `status: 'active'`
- [ ] `findByName('nonexistent')` retorna `null`
- [ ] `findById(id)` retorna el agente correcto
- [ ] `insert()` con nombre duplicado lanza error de UNIQUE constraint
- [ ] `delete(id)` hace que `findById(id)` retorne `null`
- [ ] `updateSystemPrompt(id, prompt, 'done')` actualiza el campo
- [ ] `findAll()` con path inexistente retorna agente con `status: 'broken'`

### conversationRepository.test.ts

- [ ] `create({ agentId })` retorna `ConversationRecord` con titulo por defecto
- [ ] `findByAgent(agentId)` lista las conversaciones del agente en orden DESC
- [ ] `delete(id)` hace que las conversaciones y sus mensajes desaparezcan (CASCADE)

### messageRepository.test.ts

- [ ] `save({ conversationId, role: 'user', content })` retorna `MessageRecord`
- [ ] `findByConversation(id)` lista mensajes en orden ASC
- [ ] `save({ ..., role: 'invalid' })` lanza (CHECK constraint)

### handleGenerateAgent.test.ts

- [ ] `config.name` ausente → `{ success: false, error: ... }`
- [ ] nombre con caracteres invalidos → `{ success: false }`
- [ ] provider invalido → `{ success: false }`
- [ ] agente ya existe en DB → `{ success: false }`
- [ ] `scaffoldAgent` stub lanza → `{ success: false }`
- [ ] DB insert lanza → stub de rmSync fue llamado (rollback filesystem)
- [ ] happy path → `{ success: true }`, stubs de installAgentDeps y enhanceAndPersist fueron llamados

### handleListAgents.test.ts

- [ ] DB vacia → `{ agents: [] }`
- [ ] Con agentes en DB → retorna todos mapeados a `AgentInfo` con campo `provider`

### handleCreateSession.test.ts

- [ ] `agentName` vacio → `{ success: false }`
- [ ] nombre con caracteres invalidos → `{ success: false }`
- [ ] agente no en DB → `{ success: false }`
- [ ] agente marcado broken → `{ success: false }`
- [ ] happy path → llama `acpManager.createSession` con `(agentName, agent.path)`

### handleSaveMessage.test.ts

- [ ] `role: 'hacker'` → `{ success: false, error: ... }`
- [ ] `role: 'user'` con conversationId valido → `{ success: true, message: { ... } }`
- [ ] Todos los roles validos pasan: 'user', 'assistant', 'system'

### handleDeleteAgent.test.ts

- [ ] `agentId` vacio → `{ success: false }`
- [ ] agente no encontrado → `{ success: false }`
- [ ] happy path → `closeSessionByAgentName` fue llamado, `rmSync` fue llamado, `agentRepository.delete` fue llamado, retorna `{ success: true }`

---

## Criterios de cobertura minima aceptable

No se exige un % de cobertura especifico. Se exige que todos los casos listados arriba tengan al menos un test que los ejercite. La cobertura por lineas es un subproducto, no el objetivo.

---

## Criterios de no-regresion

- [ ] `src/ipc/handlers.ts` sigue compilando sin errores de TypeScript
- [ ] `src/cli/validations.ts` no fue modificado (solo se testa, no se cambia)
- [ ] `src/db/database.ts` no fue modificado en su logica (solo se usa desde tests)
- [ ] Ningun archivo de renderer fue modificado
