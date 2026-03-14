# Plan — Suite de tests (IPC handlers, DB, validaciones)

## Objetivo

Establecer cobertura de regresion minima sobre las tres capas testables sin dependencias de UI ni proceso Electrobun:

1. **Validaciones de input** (`src/cli/validations.ts`) — funciones puras, sin I/O
2. **Capa de base de datos** (`src/db/`) — migrations, repositories con SQLite en memoria
3. **Logica de handlers IPC** (`src/ipc/handlers.ts`) — la logica de negocio extraida de `defineElectrobunRPC`

El objetivo no es alcanzar 100% de cobertura. Es tener una red de seguridad que detecte regresiones antes de que arranquen las features de Fase 2 del ROADMAP.

---

## Principios de diseno del test suite

### No mockear lo que se puede usar directamente

`bun:sqlite` acepta `:memory:` como path. Los tests de DB usan SQLite en memoria — sin archivo, sin teardown de disco, sin flakiness de filesystem. No hay ningun mock de SQLite.

### Aislar `electrobun` del codigo de negocio

`src/ipc/handlers.ts` importa `defineElectrobunRPC` y construye los handlers adentro de una closure. Eso hace que el codigo sea imposible de testear directamente sin levantar Electrobun.

La solucion es extraer la logica de negocio de cada handler a funciones puras testables en `src/ipc/handlerLogic.ts`. Los handlers en `handlers.ts` se convierten en delegadores delgados. Los tests importan `handlerLogic.ts` directamente.

### No usar librerías de test externas

Bun tiene test runner nativo (`bun test`) con `describe`, `it`, `expect`, `beforeEach`, `afterEach`. Sin `jest`, sin `vitest`, sin dependencias nuevas.

### Tests en carpeta separada, no colocados junto al codigo

```
tests/
  unit/
    validations.test.ts
    db/
      migrations.test.ts
      agentRepository.test.ts
      conversationRepository.test.ts
  integration/
    handlers/
      generateAgent.test.ts
      listAgents.test.ts
      createSession.test.ts
      saveMessage.test.ts
      deleteAgent.test.ts
```

---

## Estructura de archivos a crear

```
src/ipc/handlerLogic.ts          # Logica extraida de handlers.ts (refactor)
tests/
  unit/
    validations.test.ts
    db/
      migrations.test.ts
      agentRepository.test.ts
      conversationRepository.test.ts
  integration/
    handlers/
      generateAgent.test.ts
      listAgents.test.ts
      createSession.test.ts
      saveMessage.test.ts
      deleteAgent.test.ts
  helpers/
    testDb.ts                    # Helper: initDatabase() con :memory:
```

`package.json` se actualiza para agregar el script `"test": "bun test"`.

---

## Refactor: handlerLogic.ts

El refactor es minimo. `handlers.ts` actualmente tiene la logica inline dentro de `createRpc()`. Se extrae a funciones con la siguiente firma general:

```typescript
// src/ipc/handlerLogic.ts
export async function handleGenerateAgent(
  config: AgentConfig,
  deps: GenerateAgentDeps
): Promise<GenerateAgentResult>

export async function handleListAgents(): Promise<ListAgentsResult>

export async function handleCreateSession(
  params: CreateSessionParams,
  deps: CreateSessionDeps
): Promise<CreateSessionResult>

export async function handleSaveMessage(
  params: SaveMessageParams
): Promise<SaveMessageResult>

export async function handleDeleteAgent(
  params: DeleteAgentParams,
  deps: DeleteAgentDeps
): Promise<DeleteAgentResult>
```

Las `Deps` son objetos de inyeccion de dependencias que reemplazan los imports de modulos con efectos secundarios (`acpManager`, `agentRepository`, `scaffoldAgent`, etc.). En produccion se pasan las implementaciones reales; en tests se pasan mocks/stubs.

---

## Cobertura planeada por modulo

### validations.ts

| Caso | Tipo |
|---|---|
| nombre vacio → error | unit |
| nombre con espacios/mayusculas/tildes → error | unit |
| nombre valido (solo a-z0-9-) → undefined | unit |
| rol menor de 10 chars → error | unit |
| rol con 10 o mas chars → undefined | unit |
| descripcion vacia → error | unit |
| descripcion con contenido → undefined | unit |

### migrations + database.ts

| Caso | Tipo |
|---|---|
| initDatabase() con :memory: crea schema_version | unit |
| applyMigrations() lleva schema_version a version 3 | unit |
| migrations son idempotentes (doble ejecucion no lanza) | unit |
| columnas de todas las migraciones existen en el schema final | unit |

### agentRepository.ts

| Caso | Tipo |
|---|---|
| insert() retorna AgentRecord con los campos correctos | unit |
| findByName() retorna null si no existe | unit |
| findById() retorna el agente correcto | unit |
| insert() con nombre duplicado lanza error (UNIQUE) | unit |
| delete() elimina el agente | unit |
| updateSystemPrompt() actualiza el campo | unit |
| findAll() marca broken si path no existe | unit |

### conversationRepository.ts

| Caso | Tipo |
|---|---|
| create() retorna ConversationRecord | unit |
| findByAgent() lista conversaciones del agente | unit |
| delete() elimina la conversacion (CASCADE a messages) | unit |

### messageRepository.ts

| Caso | Tipo |
|---|---|
| save() retorna MessageRecord | unit |
| findByConversation() lista en orden ASC | unit |
| save() con role invalido lanza (CHECK constraint de SQLite) | unit |

### handleGenerateAgent

| Caso | Tipo |
|---|---|
| config.name ausente → { success: false } | integration |
| nombre invalido (caracteres ilegales) → { success: false } | integration |
| provider invalido → { success: false } | integration |
| agente ya existe en DB → { success: false } | integration |
| scaffoldAgent lanza → { success: false } | integration |
| DB insert lanza → rollback filesystem, { success: false } | integration |
| happy path → { success: true }, installs + enhance fire-and-forget | integration |

### handleListAgents

| Caso | Tipo |
|---|---|
| DB vacia → { agents: [] } | integration |
| retorna agentes existentes mapeados a AgentInfo | integration |

### handleCreateSession

| Caso | Tipo |
|---|---|
| agentName vacio → { success: false } | integration |
| agente no en DB → { success: false } | integration |
| agente marcado broken → { success: false } | integration |
| happy path → delega a acpManager.createSession | integration |

### handleSaveMessage

| Caso | Tipo |
|---|---|
| role invalido → { success: false, error } | integration |
| happy path → { success: true, message } | integration |

### handleDeleteAgent

| Caso | Tipo |
|---|---|
| agentId vacio → { success: false } | integration |
| agente no encontrado → { success: false } | integration |
| happy path → cierra sesion, borra fs, borra DB | integration |

---

## Dependencias externas que se inyectan en tests de integracion

| Dependencia | Como se inyecta en tests |
|---|---|
| `agentRepository` | Instancia real con DB en memoria |
| `conversationRepository` | Instancia real con DB en memoria |
| `messageRepository` | Instancia real con DB en memoria |
| `scaffoldAgent` | Stub que resuelve con path temporal o lanza |
| `installAgentDeps` | Stub no-op (fire-and-forget, no bloquea) |
| `enhanceAndPersist` | Stub no-op (fire-and-forget) |
| `acpManager` | Stub con createSession/closeSessionByAgentName |
| `rmSync` | Stub no-op (evita borrar disco en tests) |

---

## Script de test

Agregar a `package.json`:

```json
"test": "bun test",
"test:watch": "bun test --watch"
```

Bun resuelve automaticamente todos los archivos `*.test.ts` en el proyecto.

---

## Limitaciones conocidas

- Los tests de handlers NO cubren el streaming de chunks (el streaming pasa por ACP + stub de acpManager). Eso queda fuera del alcance minimo.
- `acpManager.createSession` requiere subprocesos reales — los tests de integracion de createSession solo verifican los early-exit guards, no el spawn real.
- `generateAgentCore` (usado solo en el flujo CLI) no se testa en esta feature — es de la capa CLI, no IPC.
