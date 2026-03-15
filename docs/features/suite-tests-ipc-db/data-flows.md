# Flujos de datos — Suite de tests

Los tests no tienen flujos de datos de negocio propios. Este archivo documenta como fluyen los datos a traves del sistema bajo test para entender que se esta verificando en cada capa.

---

## Flujo: generateAgent (handler de integracion)

```
[Test] config object
    |
    v
handleGenerateAgent(config, deps)
    |
    +-- validateAgentName(config.name)           [validacion pura]
    |       |
    |       +-- "" / null → return { success: false }
    |       +-- "Mi-Agente" → return { success: false }
    |       +-- "mi-agente" → continue
    |
    +-- VALID_PROVIDERS.includes(config.provider) [whitelist check]
    |       |
    |       +-- "invalid" → return { success: false }
    |       +-- "openai" → continue
    |
    +-- deps.agentRepository.findByName(config.name) [DB lookup]
    |       |
    |       +-- record found → return { success: false }
    |       +-- null → continue
    |
    +-- deps.scaffoldAgent(config, AGENTS_DIR)   [filesystem — stub en tests]
    |       |
    |       +-- throws → return { success: false }
    |       +-- agentDir → continue
    |
    +-- deps.agentRepository.insert(...)         [DB insert]
    |       |
    |       +-- throws → rmSync(agentDir) → re-throw → return { success: false }
    |       +-- record → continue
    |
    +-- deps.installAgentDeps(agentDir, cb)      [fire-and-forget — no-op stub]
    +-- deps.enhanceAndPersist(...)              [fire-and-forget — no-op stub]
    |
    v
return { success: true }
```

---

## Flujo: SQLite en memoria (helper testDb.ts)

```
[Test beforeEach]
    |
    v
createTestDb()
    |
    +-- new Database(':memory:')
    +-- PRAGMA foreign_keys = ON
    +-- applyMigrations(db)       [todas las migrations 1, 2, 3]
    |
    v
db (referencia a usar en el test)

[Test afterEach]
    |
    v
db.close()
```

Cada `describe` que usa la DB crea su propia instancia en `beforeEach` y la cierra en `afterEach`. No hay estado compartido entre tests.

---

## Flujo: migration idempotencia

```
[Test]
    |
    v
applyMigrations(db)   <-- primera vez: schema_version = 3
    |
    v
applyMigrations(db)   <-- segunda vez: pending = [], noop
    |
    v
schema_version = 3    <-- sin duplicados, sin error
```

---

## Flujo: agentRepository — findAll() con broken detection

```
[Test setup]
    |
    +-- insert agent con path = "/tmp/nonexistent/agent"
    +-- existsSync("/tmp/nonexistent/agent") → false
    |
    v
agentRepository.findAll()
    |
    +-- SELECT * FROM agents
    +-- for each row: existsSync(row.path)
    |       |
    |       +-- false AND status != 'broken' → UPDATE status='broken'
    |
    v
returns [{ ...agent, status: 'broken' }]
```

---

## Flujo: cascade delete (FK)

```
[Test]
    |
    +-- insert agent
    +-- create conversation (agent_id = agent.id)
    +-- save message (conversation_id = conversation.id)
    |
    v
agentRepository.delete(agent.id)
    |
    +-- DELETE FROM agents WHERE id = ?
    +-- ON DELETE CASCADE → DELETE FROM conversations
    +-- ON DELETE CASCADE → DELETE FROM messages
    |
    v
SELECT COUNT(*) FROM messages → 0
SELECT COUNT(*) FROM conversations → 0
```
