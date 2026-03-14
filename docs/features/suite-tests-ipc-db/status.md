# Feature — Suite de tests (IPC handlers, DB, validaciones)

Estado: EN IMPLEMENTACION
Rama: feature/suite-tests-ipc-db
Fecha apertura: 2026-03-14

---

## Info de la feature

**Descripcion:** Implementar tests unitarios e de integracion con alcance minimo en handlers IPC, migraciones DB y validaciones de input (`src/cli/validations.ts`)
**Objetivo:** Establecer cobertura de regresion sobre las tres capas testables sin dependencias de UI ni proceso Electrobun. Las features de Fase 2 del ROADMAP conviene arrancarlas despues de tener esta red de seguridad.
**Restricciones conocidas:** Cero cobertura actual. No se agregan dependencias externas — Bun tiene test runner nativo. El refactor de handlers.ts debe ser transparente al renderer.

---

## Handoff Leo → Cloe

### Que hacer y en que orden

**Orden de implementacion obligatorio:**

1. `tests/helpers/testDb.ts` — helper de DB en memoria (sin esto, nada mas puede arrancar)
2. `tests/unit/validations.test.ts` — tests de funciones puras (cero deps, triviales)
3. `tests/unit/db/migrations.test.ts` — tests de migrations con DB en memoria
4. `tests/unit/db/agentRepository.test.ts` — tests del repositorio de agentes
5. `tests/unit/db/conversationRepository.test.ts` — tests de conversaciones y mensajes
6. `src/ipc/handlerLogic.ts` — REFACTOR: extraer logica de handlers.ts a funciones testables
7. Actualizar `src/ipc/handlers.ts` para delegar a handlerLogic.ts
8. `tests/integration/handlers/generateAgent.test.ts`
9. `tests/integration/handlers/listAgents.test.ts`
10. `tests/integration/handlers/createSession.test.ts`
11. `tests/integration/handlers/saveMessage.test.ts`
12. `tests/integration/handlers/deleteAgent.test.ts`
13. Actualizar `package.json` para agregar script `"test": "bun test"`

---

### Reglas que Cloe debe respetar

- NO tocar `src/index.ts`, `src/client.ts` ni el modo TTY de los agentes generados
- NO agregar dependencias externas (jest, vitest, etc.) — usar solo `bun:test`
- NO modificar `src/cli/validations.ts` ni la logica de DB — solo testearlos
- El refactor de `handlers.ts` → `handlerLogic.ts` debe ser transparent: el comportamiento observable del handler (lo que retorna, los RPC sends que dispara) debe ser identico antes y despues
- Todos los tests de DB usan SQLite `:memory:` — ningun test escribe disco
- Cada suite de tests crea su propia instancia de DB en `beforeEach` y la cierra en `afterEach` — sin estado compartido entre tests
- Los stubs de inyeccion de dependencias son objetos literales con metodos `jest.fn()` — no usar librerias de mock
- En Bun test, los mocks son funciones con `mock()` de `bun:test` o simplemente funciones stub como objetos literales — NO depende de jest
- Los tests de integracion de handlers NO hacen spawn real de agentes — `acpManager` es un stub

---

### Estructura de archivos a crear

```
tests/
  helpers/
    testDb.ts                              # CREAR
  unit/
    validations.test.ts                    # CREAR
    db/
      migrations.test.ts                   # CREAR
      agentRepository.test.ts              # CREAR
      conversationRepository.test.ts       # CREAR
  integration/
    handlers/
      generateAgent.test.ts                # CREAR
      listAgents.test.ts                   # CREAR
      createSession.test.ts                # CREAR
      saveMessage.test.ts                  # CREAR
      deleteAgent.test.ts                  # CREAR
src/ipc/handlerLogic.ts                    # CREAR (refactor de handlers.ts)
src/ipc/handlers.ts                        # MODIFICAR (delegar a handlerLogic)
package.json                               # MODIFICAR (agregar script test)
```

---

### Helper: tests/helpers/testDb.ts

```typescript
import { Database } from 'bun:sqlite';
import { migrations } from '../../src/db/migrations';

export function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');

  // Replica exacta de applyMigrations() de src/db/database.ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  const row = db.query<{ version: number }, []>(
    'SELECT MAX(version) as version FROM schema_version'
  ).get([]);

  const currentVersion = row?.version ?? 0;
  const pending = migrations.filter((m) => m.version > currentVersion);

  for (const migration of pending) {
    try {
      db.exec(migration.up);
    } catch (err: any) {
      if (typeof err?.message === 'string' && err.message.includes('duplicate column name')) {
        // ya aplicada parcialmente — continuar
      } else {
        throw err;
      }
    }
    db.run('INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [migration.version]);
  }

  return db;
}
```

**Problema critico:** `agentRepository`, `conversationRepository` y `messageRepository` llaman a `getDatabase()` que retorna el singleton global. Para los tests, se necesita que usen la DB de test en memoria, no la DB del disco del usuario.

**Solucion:** El helper `testDb.ts` tambien debe proveer una funcion `withTestDb(fn)` que temporalmente sobreescribe el singleton. La alternativa mas limpia es que los repositorios acepten una DB como parametro opcional. Dado que modificar los repositorios cambia su firma (lo que podria romper algo), la solucion recomendada es sobreescribir el modulo `database.ts` via monkey-patching del singleton antes de cada test:

```typescript
// tests/helpers/testDb.ts — version completa
import { Database } from 'bun:sqlite';
import { migrations } from '../../src/db/migrations';

// Acceso al modulo para monkey-patching
let _testDb: Database | null = null;

export function getTestDb(): Database {
  if (!_testDb) throw new Error('testDb not initialized');
  return _testDb;
}

export function setupTestDb(): Database {
  _testDb = new Database(':memory:');
  _testDb.exec('PRAGMA foreign_keys = ON');
  applyTestMigrations(_testDb);
  return _testDb;
}

export function teardownTestDb(): void {
  if (_testDb) {
    _testDb.close();
    _testDb = null;
  }
}

function applyTestMigrations(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);`);
  const row = db.query<{ version: number }, []>(
    'SELECT MAX(version) as version FROM schema_version'
  ).get([]);
  const currentVersion = row?.version ?? 0;
  const pending = migrations.filter((m) => m.version > currentVersion);
  for (const migration of pending) {
    try { db.exec(migration.up); } catch (e: any) {
      if (!e?.message?.includes('duplicate column name')) throw e;
    }
    db.run('INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [migration.version]);
  }
}
```

Para que los repositorios usen la DB de test, se debe mockear `getDatabase` del modulo `src/db/database.ts`. Bun soporta `mock.module()` para esto:

```typescript
// En cada test file que usa repositorios:
import { mock } from 'bun:test';
import { setupTestDb, teardownTestDb, getTestDb } from '../../helpers/testDb';

mock.module('../../../src/db/database', () => ({
  getDatabase: () => getTestDb(),
  initDatabase: () => getTestDb(),
}));
```

El `mock.module()` en Bun debe declararse ANTES de importar los modulos que lo usan. Cloe debe asegurarse de que el mock de `getDatabase` este antes de importar `agentRepository`, `conversationRepository`, etc.

---

### Refactor: src/ipc/handlerLogic.ts

Cloe debe crear este archivo extrayendo la logica de los 5 handlers principales de `handlers.ts`. La firma de cada funcion usa inyeccion de dependencias para que los tests no necesiten el entorno de Electrobun.

```typescript
// src/ipc/handlerLogic.ts
import { mkdirSync } from 'fs';
import { validateAgentName } from '../cli/validations';
import type {
  AgentConfig,
  GenerateAgentResult,
  ListAgentsResult,
  CreateSessionParams,
  CreateSessionResult,
  SaveMessageParams,
  SaveMessageResult,
  DeleteAgentParams,
  DeleteAgentResult,
  AgentInfo,
  AgentEnhanceDone,
  AgentInstallDone,
  ProviderId,
} from '../types/ipc';
import type { agentRepository as AgentRepo } from '../db/agentRepository';
import type { acpManager as AcpMgr } from './acpManager';
import type { scaffoldAgent as ScaffoldFn, installAgentDeps as InstallFn } from '../generators/agentGenerator';
import { agentRepository } from '../db/agentRepository';
import { conversationRepository, messageRepository } from '../db/conversationRepository';

const VALID_PROVIDERS: ProviderId[] = ['lmstudio', 'ollama', 'openai', 'anthropic', 'gemini'];
const VALID_ROLES = ['user', 'assistant', 'system'] as const;

// --- Tipos de deps inyectadas ---

export interface GenerateAgentDeps {
  agentRepository: Pick<typeof AgentRepo, 'findByName' | 'insert'>;
  scaffoldAgent: typeof ScaffoldFn;
  installAgentDeps: typeof InstallFn;
  enhanceAndPersist: (
    agentId: string,
    agentDir: string,
    agentName: string,
    originalPrompt: string,
    rpcSend: (payload: AgentEnhanceDone) => void
  ) => Promise<void>;
  onInstallDone: (payload: AgentInstallDone) => void;
  onEnhanceDone: (payload: AgentEnhanceDone) => void;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
}

export interface CreateSessionDeps {
  agentRepository: Pick<typeof AgentRepo, 'findByName'>;
  acpManager: Pick<typeof AcpMgr, 'createSession'>;
}

export interface DeleteAgentDeps {
  agentRepository: Pick<typeof AgentRepo, 'findById' | 'delete'>;
  acpManager: Pick<typeof AcpMgr, 'closeSessionByAgentName'>;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
}

// --- Funciones de logica de handlers ---

export async function handleGenerateAgent(
  config: AgentConfig,
  agentsDir: string,
  deps: GenerateAgentDeps
): Promise<GenerateAgentResult> {
  if (!config?.name) return { success: false, error: 'Agent name required' };
  const nameError = validateAgentName(config.name);
  if (nameError) return { success: false, error: nameError };

  if (config.provider && !VALID_PROVIDERS.includes(config.provider as ProviderId)) {
    return { success: false, error: `Proveedor invalido: "${config.provider}".` };
  }

  const existing = deps.agentRepository.findByName(config.name);
  if (existing) return { success: false, error: `El agente "${config.name}" ya existe.` };

  mkdirSync(agentsDir, { recursive: true });

  try {
    const agentDir = await deps.scaffoldAgent(config, agentsDir);

    let insertedAgent;
    try {
      insertedAgent = deps.agentRepository.insert({
        name: config.name,
        description: config.description,
        systemPrompt: config.role,
        model: '',
        hasWorkspace: config.needsWorkspace ?? false,
        path: agentDir,
        provider: config.provider ?? 'lmstudio',
      });
    } catch (dbErr: any) {
      try { deps.rmSync(agentDir, { recursive: true, force: true }); } catch {}
      throw dbErr;
    }

    deps.installAgentDeps(agentDir, (installError) => {
      deps.onInstallDone({
        agentDir,
        agentName: config.name,
        ...(installError ? { error: installError } : {}),
      });
    });

    deps.enhanceAndPersist(
      insertedAgent.id,
      agentDir,
      config.name,
      config.role,
      (payload) => deps.onEnhanceDone(payload)
    ).catch((e) => console.error('[enhancer] Error inesperado en enhance:', e));

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function handleListAgents(): Promise<ListAgentsResult> {
  const records = agentRepository.findAll();
  const agents: AgentInfo[] = records.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    hasWorkspace: r.hasWorkspace,
    status: r.status,
    createdAt: r.createdAt,
    provider: (r.provider ?? 'lmstudio') as ProviderId,
  }));
  return { agents };
}

export async function handleCreateSession(
  params: CreateSessionParams,
  deps: CreateSessionDeps
): Promise<CreateSessionResult> {
  if (!params?.agentName?.trim()) return { success: false, error: 'agentName is required' };
  const nameError = validateAgentName(params.agentName.trim());
  if (nameError) return { success: false, error: nameError };

  const agent = deps.agentRepository.findByName(params.agentName.trim());
  if (!agent) return { success: false, error: `Agente "${params.agentName}" no encontrado en la base de datos.` };
  if (agent.status === 'broken') return { success: false, error: `El agente "${params.agentName}" no se encuentra en disco. Esta marcado como roto.` };

  return deps.acpManager.createSession(params.agentName.trim(), agent.path);
}

export async function handleSaveMessage(
  params: SaveMessageParams
): Promise<SaveMessageResult> {
  if (!VALID_ROLES.includes(params.role as any)) {
    return { success: false, error: `role invalido: "${params.role}". Debe ser uno de: user, assistant, system.` };
  }
  try {
    const record = messageRepository.save({
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
    });
    return {
      success: true,
      message: {
        id: record.id,
        conversationId: record.conversationId,
        role: record.role,
        content: record.content,
        createdAt: record.createdAt,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function handleDeleteAgent(
  params: DeleteAgentParams,
  deps: DeleteAgentDeps
): Promise<DeleteAgentResult> {
  if (!params?.agentId?.trim()) return { success: false, error: 'agentId es requerido' };
  if (!params?.agentName?.trim()) return { success: false, error: 'agentName es requerido' };

  try {
    const agent = deps.agentRepository.findById(params.agentId.trim());
    if (!agent) return { success: false, error: `Agente con id "${params.agentId}" no encontrado.` };

    deps.acpManager.closeSessionByAgentName(params.agentName.trim());

    try {
      deps.rmSync(agent.path, { recursive: true, force: true });
    } catch (e: any) {
      console.error(`[deleteAgent] No se pudo borrar ${agent.path}:`, e.message);
    }

    deps.agentRepository.delete(params.agentId.trim());

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
```

---

### Como modificar handlers.ts para delegar

Despues de crear `handlerLogic.ts`, los 5 handlers de `handlers.ts` se convierten en wrappers delgados. Ejemplo para `generateAgent`:

```typescript
// handlers.ts — despues del refactor
import {
  handleGenerateAgent,
  handleListAgents,
  handleCreateSession,
  handleSaveMessage,
  handleDeleteAgent,
} from './handlerLogic';
import { rmSync } from 'fs';

// Dentro de createRpc(), requests section:
generateAgent: async (config) => {
  return handleGenerateAgent(config, AGENTS_DIR, {
    agentRepository,
    scaffoldAgent,
    installAgentDeps,
    enhanceAndPersist: (agentId, agentDir, agentName, originalPrompt, rpcSend) =>
      enhanceAndPersist(agentId, agentDir, agentName, originalPrompt, rpcSend),
    onInstallDone: (p) => (rpc as any).send.agentInstallDone(p),
    onEnhanceDone: (p) => (rpc as any).send.agentEnhanceDone(p),
    rmSync,
  });
},
listAgents: async () => handleListAgents(),
createSession: async (params) => handleCreateSession(params, { agentRepository, acpManager }),
saveMessage: async (params) => handleSaveMessage(params),
deleteAgent: async (params) => handleDeleteAgent(params, { agentRepository, acpManager, rmSync }),
```

Los handlers `sendMessage`, `closeSession`, `createConversation`, `listConversations`, `getMessages`, `deleteConversation` son suficientemente simples y no requieren extraccion en esta fase.

---

### Patrones de test: unit (validaciones)

```typescript
// tests/unit/validations.test.ts
import { describe, it, expect } from 'bun:test';
import { validateAgentName, validateRole, validateDescription } from '../../src/cli/validations';

describe('validateAgentName', () => {
  it('retorna error si el nombre esta vacio', () => {
    expect(validateAgentName('')).toBeDefined();
    expect(validateAgentName(undefined as any)).toBeDefined();
  });

  it('retorna error si contiene caracteres invalidos', () => {
    expect(validateAgentName('Mi Agente')).toBeDefined();    // espacio
    expect(validateAgentName('Mi-Agente')).toBeDefined();    // mayusculas
    expect(validateAgentName('agente!')).toBeDefined();      // especial
  });

  it('retorna undefined para nombres validos', () => {
    expect(validateAgentName('mi-agente')).toBeUndefined();
    expect(validateAgentName('agente1')).toBeUndefined();
    expect(validateAgentName('a')).toBeUndefined();
  });
});
```

---

### Patrones de test: DB en memoria

```typescript
// tests/unit/db/agentRepository.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mock } from 'bun:test';
import { setupTestDb, teardownTestDb, getTestDb } from '../../helpers/testDb';

// IMPORTANTE: mock.module debe ir ANTES de los imports que dependen del modulo mockeado
mock.module('../../../src/db/database', () => ({
  getDatabase: () => getTestDb(),
  initDatabase: () => getTestDb(),
}));

// Importar DESPUES del mock
import { agentRepository } from '../../../src/db/agentRepository';

const SAMPLE_AGENT = {
  name: 'test-agent',
  description: 'A test agent',
  systemPrompt: 'You are a test agent.',
  model: '',
  hasWorkspace: false,
  path: '/fake/path/test-agent',
  provider: 'lmstudio',
};

describe('agentRepository', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  it('insert() retorna AgentRecord con status active', () => {
    const record = agentRepository.insert(SAMPLE_AGENT);
    expect(record.id).toBeDefined();
    expect(record.status).toBe('active');
    expect(record.name).toBe('test-agent');
  });

  it('findByName() retorna null si no existe', () => {
    expect(agentRepository.findByName('nonexistent')).toBeNull();
  });

  it('insert() con nombre duplicado lanza error', () => {
    agentRepository.insert(SAMPLE_AGENT);
    expect(() => agentRepository.insert(SAMPLE_AGENT)).toThrow();
  });

  it('delete() elimina el agente', () => {
    const record = agentRepository.insert(SAMPLE_AGENT);
    agentRepository.delete(record.id);
    expect(agentRepository.findById(record.id)).toBeNull();
  });
});
```

---

### Patrones de test: handlers de integracion

```typescript
// tests/integration/handlers/generateAgent.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mock } from 'bun:test';
import { setupTestDb, teardownTestDb, getTestDb } from '../../helpers/testDb';

mock.module('../../../src/db/database', () => ({
  getDatabase: () => getTestDb(),
  initDatabase: () => getTestDb(),
}));

import { agentRepository } from '../../../src/db/agentRepository';
import { handleGenerateAgent } from '../../../src/ipc/handlerLogic';
import type { GenerateAgentDeps } from '../../../src/ipc/handlerLogic';

function makeDeps(overrides: Partial<GenerateAgentDeps> = {}): GenerateAgentDeps {
  return {
    agentRepository,
    scaffoldAgent: async (_config, baseDir) => `${baseDir}/test-agent`,
    installAgentDeps: (_dir, cb) => { cb(); },  // no-op, llama cb inmediatamente
    enhanceAndPersist: async () => {},           // no-op
    onInstallDone: () => {},
    onEnhanceDone: () => {},
    rmSync: () => {},
    ...overrides,
  };
}

const VALID_CONFIG = {
  name: 'test-agent',
  description: 'A test agent',
  role: 'You are a helpful test agent with enough characters.',
  needsWorkspace: false,
  provider: 'lmstudio' as const,
};

describe('handleGenerateAgent', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  it('retorna error si config.name esta ausente', async () => {
    const result = await handleGenerateAgent(
      { ...VALID_CONFIG, name: '' },
      '/fake/agents',
      makeDeps()
    );
    expect(result.success).toBe(false);
  });

  it('retorna error si provider es invalido', async () => {
    const result = await handleGenerateAgent(
      { ...VALID_CONFIG, provider: 'invalid' as any },
      '/fake/agents',
      makeDeps()
    );
    expect(result.success).toBe(false);
  });

  it('retorna error si el agente ya existe en DB', async () => {
    agentRepository.insert({
      name: 'test-agent',
      description: 'existing',
      systemPrompt: 'existing',
      model: '',
      hasWorkspace: false,
      path: '/fake/path',
      provider: 'lmstudio',
    });
    const result = await handleGenerateAgent(VALID_CONFIG, '/fake/agents', makeDeps());
    expect(result.success).toBe(false);
    expect(result.error).toContain('ya existe');
  });

  it('happy path retorna success:true', async () => {
    const result = await handleGenerateAgent(VALID_CONFIG, '/fake/agents', makeDeps());
    expect(result.success).toBe(true);
  });

  it('llama rmSync si la insercion en DB falla', async () => {
    let rmCalled = false;
    const deps = makeDeps({
      rmSync: () => { rmCalled = true; },
      agentRepository: {
        findByName: () => null,
        insert: () => { throw new Error('DB error simulado'); },
      },
    });
    const result = await handleGenerateAgent(VALID_CONFIG, '/fake/agents', deps);
    expect(result.success).toBe(false);
    expect(rmCalled).toBe(true);
  });
});
```

---

### Script de test en package.json

```json
"scripts": {
  "dev": "bun run src/index.ts",
  "chat": "bun run src/client.ts",
  "desktop": "electrobun dev",
  "metrics": "bun run scripts/metrics.ts",
  "test": "bun test",
  "test:watch": "bun test --watch"
}
```

---

### Checklist Leo
- [x] Cada archivo a crear/modificar tiene ruta absoluta desde repo root
- [x] Contratos IPC escritos con tipos TypeScript completos inline (no "ver ipc-contracts.md")
- [x] Lista de archivos ordenada por prioridad de implementacion
- [x] Sin "ver plan.md" ni "ver acceptance.md" — todo el contexto inline en status.md
- [x] Limitaciones de Electrobun verificadas: fire-and-forget en handlers, no await a subprocesos
- [x] Decisiones de arquitectura con justificacion explicita

### Gaps y dudas de Leo

**Gap 1 — mock.module en Bun:** Bun soporta `mock.module()` para reemplazar modulos en tiempo de test. Sin embargo, el comportamiento exacto cuando el mock se declara al nivel del modulo (fuera de beforeEach) depende de la version de Bun. Si Cloe encuentra que el mock no se aplica correctamente, la alternativa es refactorizar `agentRepository` para aceptar un parametro `db?: Database` opcional — lo cual es un cambio de firma mas invasivo pero mas robusto. Leo recomienda intentar `mock.module` primero.

**Gap 2 — `existsSync` en findAll():** El test de "broken detection" en `agentRepository.findAll()` necesita que el path del agente no exista. En tests, insertar un agente con path `/nonexistent/path/that/does/not/exist` deberia ser suficiente en cualquier entorno de CI.

Confianza general del plan: alta

→ Siguiente: @cloe Implementa la feature. Las instrucciones estan en docs/features/suite-tests-ipc-db/status.md seccion "Handoff Leo → Cloe".

---

## Handoff Cloe → Max

> Cloe: completa esta seccion al terminar la implementacion. Max la lee para verificar.

**Archivos creados/modificados:**
- 9 archivos nuevos (helper + 3 unit suites + 5 integration suites)
- 2 archivos fuente creados/modificados (handlerLogic.ts nuevo, handlers.ts refactorizado, package.json)

**Descripcion de lo implementado:**
- `tests/helpers/testDb.ts`: helper SQLite in-memory con setupTestDb/teardownTestDb/getTestDb. Aplica todas las migrations desde `src/db/migrations.ts`. Usa `never[]` en lugar de `[]` como tipo de parametros de query para compatibilidad con las definiciones de tipos de Bun (la diferencia es que `.get([])` no compila con el tipo `[]` en bun:sqlite, pero `.get()` sin argumentos si).
- `src/ipc/handlerLogic.ts`: extrae la logica de los 5 handlers principales (generateAgent, listAgents, createSession, saveMessage, deleteAgent) con inyeccion de dependencias. Mensajes de error en ASCII puro (sin tildes ni acentos) por BUG #001.
- `src/ipc/handlers.ts`: refactorizado para delegar los 5 handlers a handlerLogic.ts. Los handlers simples (sendMessage, closeSession, createConversation, listConversations, getMessages, deleteConversation) permanecen inline. Comportamiento observable identico al original.
- `package.json`: agregados scripts `"test": "bun test"` y `"test:watch": "bun test --watch"`.

**Casos borde considerados:**
- `findAll()` marca agentes como broken cuando el path no existe: testado con path `/nonexistent/path/that/does/not/exist`
- `delete()` de agente en cascada elimina conversaciones y mensajes (testado via FK)
- `rmSync` que lanza error en deleteAgent: el handler captura el error internamente y continua con el DELETE en DB
- `insert()` con nombre duplicado lanza error UNIQUE constraint (testado)
- `messageRepository.save()` con role invalido lanza error CHECK constraint (testado)
- Provider invalido en generateAgent: retorna error sin tocar filesystem
- DB falla despues de scaffoldAgent: se llama rmSync para limpiar el directorio huerfano

**Advertencias para Max:**
- `mock.module()` de Bun funciona correctamente cuando se declara ANTES de los imports que dependen del modulo mockeado. Los test files de DB y handlers siguen este patron.
- El console output `[deleteAgent] No se pudo borrar /fake/path/test-agent: filesystem error` que aparece al correr los tests es esperado — lo genera el test que verifica que el handler continua cuando rmSync lanza error.
- Los errores TypeScript pre-existentes en `src/db/agentRepository.ts`, `src/db/conversationRepository.ts`, `src/db/database.ts`, `src/ipc/acpManager.ts` y `src/client.ts` no son nuevos — son anteriores a esta feature. Los archivos nuevos no introducen errores TS.
- `handleListAgents` usa `agentRepository` directamente del modulo (no via inyeccion de deps). Para testarla con DB en memoria, el mock.module de los test files de integracion cubre este caso.

### Manifiesto de archivos
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| `tests/helpers/testDb.ts` | creado | 1-47 |
| `tests/unit/validations.test.ts` | creado | 1-60 |
| `tests/unit/db/migrations.test.ts` | creado | 1-90 |
| `tests/unit/db/agentRepository.test.ts` | creado | 1-90 |
| `tests/unit/db/conversationRepository.test.ts` | creado | 1-100 |
| `tests/integration/handlers/generateAgent.test.ts` | creado | 1-100 |
| `tests/integration/handlers/listAgents.test.ts` | creado | 1-70 |
| `tests/integration/handlers/createSession.test.ts` | creado | 1-95 |
| `tests/integration/handlers/saveMessage.test.ts` | creado | 1-80 |
| `tests/integration/handlers/deleteAgent.test.ts` | creado | 1-95 |
| `src/ipc/handlerLogic.ts` | creado | 1-172 |
| `src/ipc/handlers.ts` | modificado | 1-17 (imports), 55-71 (generateAgent), 73 (listAgents), 75-76 (createSession), 128 (saveMessage), 135-136 (deleteAgent) |
| `package.json` | modificado | 10-11 (scripts test y test:watch) |

### Checklist Cloe
- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Leo (o documentado por que difieren)
- [x] Fire-and-forget en todos los handlers IPC que lanzan subprocesos (Bun.spawn sin await)
- [x] Input validation en todos los IPC handlers que tocan filesystem o spawn
- [x] Sin `any` sin justificacion escrita en el handoff
- [x] Labels HTML: todos tienen for+id matching, ningun input sin label (N/A — no hay cambios en HTML)

**Nota sobre `any`:** Los unicos usos de `any` heredados estan en `handlers.ts` lineas 68-69 (`(rpc as any).send.xxx`) — justificado en memoria de Cloe: type inference limitation de Electrobun, patron establecido desde la feature anterior. No se introdujeron nuevos `any`.

### Gaps y dudas de Cloe
- Gap resuelto: `mock.module()` en Bun funciona correctamente. Se declara al nivel del modulo, antes de los imports dependientes. Leo sugeria esta alternativa como primera opcion — funciono sin necesidad de refactorizar los repositorios.
- Gap resuelto: broken detection en `findAll()` con path `/nonexistent/path/that/does/not/exist` funciona correctamente en el entorno de test.
- Gap declarado: `handleSaveMessage` y `handleListAgents` no reciben `db` via inyeccion de deps — usan los repositorios directamente del modulo. Esto es correcto porque el `mock.module` actua a nivel de modulo. Max debe verificar que los tests de integracion de saveMessage y listAgents efectivamente usan la DB en memoria y no la del disco.

Confianza en la implementacion: alta

→ Siguiente: @max Verifica la feature. El handoff de Cloe esta en docs/features/suite-tests-ipc-db/status.md seccion "Handoff Cloe → Max".

---

## Handoff Max → Ada

> Max: completa esta seccion al aprobar la implementacion. Ada la lee para optimizar.

**Resultado de la verificacion:** APROBADO

**Casos probados:**
- `bun test` ejecutado: 72 tests pasan, 0 fallan, 144 expect() calls, 9 archivos, 103ms — evidencia: output de consola
- Gap critico de Cloe verificado: `handleSaveMessage` y `handleListAgents` usan DB en memoria — evidencia: ambos repositorios llaman `getDatabase()` (conversationRepository.ts:2 y agentRepository.ts:3); el mock.module en saveMessage.test.ts:6-9 y listAgents.test.ts:6-9 se declara ANTES de los imports de repositorios, interceptando correctamente las llamadas; los tests happy-path de saveMessage crean agente + conversacion en la DB de test y los mensajes se persisten correctamente (saveMessage.test.ts:49-65)
- Mock isolation verificado: cada test file declara mock.module al nivel del modulo y usa beforeEach/afterEach para crear/destruir la DB — patron correcto sin estado compartido entre tests
- fire-and-forget en handlers.ts: handlers.ts:61-71 — generateAgent no tiene await al wrapper, delega a handleGenerateAgent que lanza installAgentDeps y enhanceAndPersist como fire-and-forget (handlerLogic.ts:95-109)
- Mensajes de error ASCII verificados: handlerLogic.ts lineas 63, 65, 68, 72, 135, 140, 141, 150, 177, 178, 182 — sin tildes ni acentos, cumple BUG #001
- `(rpc as any).send.xxx` en handlers.ts:68-69 — patron heredado justificado, no introducido en esta feature

**Issues encontrados:**
- Discrepancia menor en manifiesto: handlerLogic.ts tiene 198 lineas reales vs 172 declaradas. No es un bug funcional — el codigo es correcto y los tests pasan. Solo afecta la precision del manifiesto.
- testDb.ts tiene 46 lineas reales vs 47 declaradas — diferencia de 1 linea, irrelevante.

**Tiene implicaciones de seguridad:** NO — esta feature es exclusivamente de testing. No modifica logica de seguridad, no expone nuevas superficies de ataque, no agrega dependencias externas. Los handlers refactorizados tienen comportamiento observable identico al original.

### Checklist Max
- [ ] Flujo completo de generacion de agente funciona — evidencia: NO APLICA a esta feature (no hay cambios de UI ni flujo desktop; el refactor de handlers.ts es transparente al renderer)
- [ ] Chat con agente via ACP funciona (spawn→connect→message→response) — evidencia: NO APLICA a esta feature (no se toca acpManager ni el flujo de chat)
- [x] Cada archivo del manifiesto de Cloe verificado con file:line — evidencia: los 10 archivos de tests existen en `tests/` (verificado con find), `src/ipc/handlerLogic.ts` existe (198 lineas reales), `src/ipc/handlers.ts` modificado con imports de handlerLogic en lineas 11-16 y delegacion en lineas 61-76 y 128 y 135-136, `package.json` lineas 11-12 tienen scripts test y test:watch
- [ ] Sin errores en consola del webview — evidencia: NO APLICA (no hay cambios en renderer; feature es exclusivamente de testing y refactor de logica)
- [ ] Labels HTML verificados — evidencia: NO APLICA (no hay cambios en HTML/renderer)
- [ ] Build de Electrobun exitoso — evidencia: NO VERIFICADO (requiere proceso Electrobun en ejecucion; fuera del alcance de esta feature que es test-only)
- [ ] Bundle dentro del limite de tamaño (< 20MB) — evidencia: NO VERIFICADO (mismo motivo; los archivos de test no se incluyen en el bundle de produccion)
- [ ] Manejo de error visible en UI cuando LM Studio no esta disponible — evidencia: NO APLICA (no hay cambios en UI)
- [x] `bun test` pasa sin errores — evidencia: `bun test v1.3.5 (1e86cebd) — 72 pass, 0 fail, 144 expect() calls, Ran 72 tests across 9 files. [103.00ms]`
- [x] Cobertura de los casos del acceptance — evidencia: validaciones (13 tests), migrations (6 tests), agentRepository (10 tests), conversationRepository (11 tests), generateAgent (9 tests), listAgents (5 tests), createSession (6 tests), saveMessage (6 tests), deleteAgent (6 tests). Cubren happy path, errores de validacion, casos borde (duplicado, broken, cascade delete, rollback de filesystem)

### No verificado por Max
- Build de Electrobun y bundle size: requieren `bun run desktop` y proceso Electrobun activo — fuera del alcance de esta feature que es exclusivamente test infrastructure. Los archivos de test no forman parte del bundle de produccion.
- Flujo ACP end-to-end (spawn→connect→message→response): no se toca acpManager ni el protocolo ACP en esta feature.
- Consola del webview y UI: no hay cambios en renderer, styles ni HTML.

Confianza en la verificacion: alta

→ Siguiente: @ada Optimiza la feature. Max aprobo — ver docs/features/suite-tests-ipc-db/status.md seccion "Handoff Max → Ada".

---

## Handoff Ada → Cipher

> Ada: completa esta seccion al terminar la optimizacion. Cipher la lee para auditar.

**Optimizaciones aplicadas:**

### Imports duplicados de `bun:test` consolidados

En los 7 test files que usan `mock.module`, habia dos sentencias de importacion separadas del mismo modulo `bun:test`:

```typescript
// Antes (en agentRepository.test.ts, conversationRepository.test.ts y los 5 integration tests)
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mock } from 'bun:test';

// Despues
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
```

Archivos modificados:
- `tests/unit/db/agentRepository.test.ts:1-2`
- `tests/unit/db/conversationRepository.test.ts:1-2`
- `tests/integration/handlers/generateAgent.test.ts:1-2`
- `tests/integration/handlers/listAgents.test.ts:1-2`
- `tests/integration/handlers/createSession.test.ts:1-2`
- `tests/integration/handlers/saveMessage.test.ts:1-2`
- `tests/integration/handlers/deleteAgent.test.ts:1-2`

Razon: dos sentencias `import` del mismo especificador de modulo son redundantes — el modulo se resuelve una sola vez de todos modos; consolidar elimina ambiguedad y sigue la convencion de un import por modulo. El orden de los nombres exportados dentro del mismo import no afecta el comportamiento.

**Bundle size antes/despues:**

Esta feature es exclusivamente de testing. Los archivos de test no forman parte del bundle de produccion de Electrobun. El build de Electrobun no fue ejecutado porque requiere el proceso Electrobun activo (confirmado por Max como fuera de scope). Las metricas de bundle de la feature anterior siguen vigentes: main process 9.66 MB, renderer 21.94 KB.

**Deuda tecnica eliminada:**

- 7 imports duplicados de `bun:test` consolidados en import unico por archivo.

### Checklist Ada
- [x] bundle-check ejecutado ANTES — sin dist/; feature es test-only; metricas de bundle de la feature anterior aplican (main: 9.66 MB, renderer: 21.94 KB); Electrobun build fuera de scope confirmado por Max
- [x] Named imports verificados: sin `import * as x` en ningun archivo de la feature. El unico `import * as acp` del repo esta en `src/client.ts` — archivo protegido (fuera de scope por CLAUDE.md)
- [x] Dependencias muertas verificadas con grep — `handlerLogic.ts` importa exactamente lo que usa; `handlers.ts` todos sus imports son activos; test files sin imports inutilizados
- [x] Fire-and-forget preservado: `handlers.ts` — `generateAgent` retorna sin await a `installAgentDeps` ni `enhanceAndPersist`; ambas se lanzan como fire-and-forget con `.catch(console.error)`
- [x] bundle-check ejecutado DESPUES — sin cambio en bundle (test files no se bundlean); 7 lineas eliminadas en test files (1 por archivo)
- [x] Sin cambios de comportamiento observable (no regresiones) — `bun test` 72/72 confirmado antes y despues

### No optimizado por Ada
- `src/client.ts:9` — `import * as acp from '@agentclientprotocol/sdk'`: detectado como candidato a named imports (patron de memoria de Ada). No aplicado porque `src/client.ts` esta explicitamente protegido por CLAUDE.md ("Do NOT modify `src/index.ts`, `src/client.ts`").
- Patron de `mock.module` repetido en 7 archivos (boilerplate identico lineas 4-9 de cada test): no se extrae a helper porque `mock.module` en Bun debe ejecutarse al nivel del modulo antes de los imports que dependen de el — no puede encapsularse en una funcion exportada sin cambiar el comportamiento de la resolucion de modulos.
- `handleListAgents` sin inyeccion de deps (`agentRepository` accedido directamente del modulo): detectado por Cloe como gap conocido. No refactorizado porque cambiaria la firma de la funcion publica y el patron `mock.module` ya lo cubre correctamente en los tests.

Confianza en las optimizaciones: alta

→ Siguiente: @cipher Audita la feature antes del release. Ver docs/features/suite-tests-ipc-db/status.md seccion "Handoff Ada → Cipher".

---

## Resultado de Cipher

**Vulnerabilidades encontradas:** Ninguna nueva en el scope de esta feature. Un secret pre-existente detectado en `.env` — no commiteado, correctamente en .gitignore.

**Decision:** APROBADO

### Checklist Cipher
- [x] Sin secrets en codigo fuente — evidencia: scan grep sobre src/ y tests/ con patrones GEMINI_API_KEY, OPENAI_API_KEY, sk-, AIza. Unico hit: `.env:1` con GEMINI_API_KEY="AIzaSy..." — archivo no en git (ver item siguiente). Los archivos de la feature (handlerLogic.ts, handlers.ts, tests/) no contienen ningun secret.
- [x] .env en .gitignore y no commiteado — evidencia: `git check-ignore -v .env` retorna `.gitignore:23:.env`; `git log --all -- .env` retorna vacio (nunca commiteado). `.gitignore` lineas 19-24 cubren tambien `master.key`, `*.key`, `.env.*.local`.
- [x] agentName validado con /^[a-z0-9-]+$/ antes de path.join — evidencia: `handlerLogic.ts:64` llama `validateAgentName(config.name)` antes de cualquier operacion de filesystem. `handlerLogic.ts:136` llama `validateAgentName(params.agentName.trim())` en handleCreateSession antes de usar el nombre. La funcion `validateAgentName` en `src/cli/validations.ts` usa exactamente el regex `/^[a-z0-9-]+$/`.
- [x] Inputs del webview validados antes de filesystem ops — evidencia: `handlerLogic.ts:63-69` valida name, nameError y provider antes de `mkdirSync(agentsDir)` en linea 74. `handlerLogic.ts:177-178` valida agentId y agentName antes de `findById` y `rmSync`. `handlerLogic.ts:149` valida role con VALID_ROLES whitelist antes de `messageRepository.save()`.
- [x] Spawn de agentes usa rutas absolutas, no interpolacion de user input — evidencia: `handleCreateSession` en `handlerLogic.ts:143` pasa `agent.path` a `acpManager.createSession` — este path viene de la DB (resultado de `findByName`), no del input del usuario directamente. El input del usuario (`params.agentName`) se usa solo para lookup en DB, nunca se concatena en rutas.
- [x] Sin innerHTML con user input sin sanitizar — evidencia: grep sobre src/ipc/ y tests/ busca `innerHTML` — sin resultados. Esta feature no toca el renderer.
- [x] DevTools deshabilitados en build de produccion — evidencia: riesgo aceptado desde feature electrobun-migration. Sin referencia a `openDevTools` en ningun archivo de src/ (grep confirma sin resultados). Electrobun no expone API de devtools — estado identico a auditorias anteriores.
- [x] CSP configurado en el webview — evidencia: `src/renderer/index.html:6` contiene `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none';">` — sin cambios en esta feature.
- [x] No se expone process.env completo al renderer via IPC — evidencia: grep sobre src/ipc/ busca `process.env` — sin resultados. Los handlers de esta feature no leen ni exponen variables de entorno. `src/desktop/index.ts:11` usa `process.env.NODE_ENV` solo para condicionar el detalle del mensaje de error en consola, no en IPC.
- [x] Cierre limpio de subprocesos al cerrar la app — evidencia: `src/desktop/index.ts:19` registra `process.on('exit', () => acpManager.closeAll())` y `src/desktop/index.ts:20` registra `process.on('SIGINT', () => { acpManager.closeAll(); process.exit(0); })`. `acpManager.ts:138-141` implementa `closeAll()` iterando sobre todas las sesiones y llamando `closeSession()` que ejecuta `session.process.kill()`. Sin cambios en esta logica en la feature auditada.

### Puntos de atencion verificados (handoff Ada)

**1. config.name validado antes de path.join:** VERIFICADO — `handlerLogic.ts:64-65` ejecuta `validateAgentName(config.name)` y retorna error si falla, antes de cualquier uso de `agentsDir` o `path.join`. El path del agente se construye dentro de `scaffoldAgent` (dep inyectada) usando el `agentsDir` constante del main process + el nombre ya validado.

**2. handleDeleteAgent llama rmSync con agent.path de la DB:** VERIFICADO — `handlerLogic.ts:181` hace `findById(params.agentId.trim())` y obtiene `agent` de la DB. La linea 187 usa `agent.path` (campo del registro de DB) para `rmSync`. El input del usuario (`params.agentId`, `params.agentName`) se usa unicamente para lookup y para cerrar la sesion ACP — nunca se concatena en rutas de filesystem.

**3. agentsDir es constante del main process:** VERIFICADO — `handlers.ts:6` importa `AGENTS_DIR` de `src/db/userDataDir.ts`. `userDataDir.ts:25` define `AGENTS_DIR = path.join(USER_DATA_DIR, 'agents')` donde `USER_DATA_DIR` se resuelve a partir de `process.env.APPDATA` (Windows) o `process.env.HOME` (macOS/Linux) — variables del entorno del proceso, no del renderer. El renderer no puede influir en este valor.

**4. Mensajes de error en ASCII puro (BUG #001):** VERIFICADO — `grep -Pn "[^\x00-\x7E]" src/ipc/handlerLogic.ts src/ipc/handlers.ts` retorna exit code 1 sin output, confirmando que ambos archivos son 100% ASCII. Todos los strings de error en handlerLogic.ts (lineas 63, 65, 68, 72, 135, 137, 140, 141, 150, 169, 177, 178, 182) usan unicamente caracteres ASCII 0x20-0x7E.

### Riesgos aceptados por Cipher
- DevTools sin deshabilitar explicitamente: Electrobun no expone API de devtools — riesgo aceptado desde feature electrobun-migration, estado sin cambios.
- `HOME ?? '~'` en userDataDir.ts:14-17 (macOS/Linux): path invalido si HOME undefined — baja severidad, riesgo aceptado desde feature multi-provider-support, fuera del scope de esta feature.
- `agentDir` expuesto al renderer en AgentInstallDone/AgentEnhanceDone: path absoluto innecesariamente visible — baja severidad, riesgo aceptado desde feature persistencia-sqlite, fuera del scope de esta feature.
- `handleListAgents` sin inyeccion de deps (accede `agentRepository` directamente del modulo): gap de testabilidad conocido, no es vulnerabilidad de seguridad — `mock.module` lo cubre en tests.

Confianza en la auditoria: alta

---

## Metricas de Leo
- archivos_leidos: 14
- archivos_creados: 4 (plan.md, ipc-contracts.md, data-flows.md, acceptance.md)
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 2 (mock.module Bun, existsSync en broken detection)

## Metricas de Cloe
- archivos_leidos: 11
- archivos_creados: 11
- archivos_modificados: 2
- rework: si
- iteraciones: 2
- confianza: alta
- gaps_declarados: 1

## Metricas de Max
- archivos_leidos: 16
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 0
- items_checklist_verificados: 3/10 (7 no aplican a esta feature — son items de runtime/UI/build que esta feature no toca)
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 3 (build Electrobun, bundle size, ACP end-to-end — todos fuera del alcance de esta feature)

## Metricas de Ada
- archivos_leidos: 15
- archivos_modificados: 7
- bundle_antes_mb: N/A (test-only; sin dist/; metricas de referencia: main 9.66 MB, renderer 21.94 KB)
- bundle_despues_mb: N/A (test files no se bundlean)
- optimizaciones_aplicadas: 1 (consolidacion de 7 imports duplicados de bun:test)
- optimizaciones_descartadas: 3 (client.ts wildcard — archivo protegido; mock.module boilerplate — no extraible; handleListAgents sin DI — gap conocido)
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 1 (Electrobun build y bundle size fuera de scope — confirmado por Max)

## Metricas de Cipher
- archivos_leidos: 12
- vulnerabilidades_criticas: 0
- vulnerabilidades_altas: 0
- vulnerabilidades_medias: 0
- vulnerabilidades_bajas: 0
- riesgos_aceptados: 4 (devtools, HOME undefined, agentDir en IPC, handleListAgents sin DI — todos pre-existentes y documentados)
- items_checklist_verificados: 10/10
- decision: APROBADO
- confianza: alta
- gaps_declarados: 0

---

Estado final: APROBADO — LISTO PARA MERGE A MAIN
