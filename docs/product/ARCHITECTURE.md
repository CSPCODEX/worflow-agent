# Arquitectura del Producto Pivot — Workflow Agent

## 1. Que se reutiliza

### 100% reutilizable (sin cambios)

| Componente | Archivo | Razon |
|---|---|---|
| Provider abstraction | `src/templates/basic-agent/providers/` | Los 5 providers (LM Studio, Ollama, OpenAI, Anthropic, Gemini) funcionan tal cual |
| Provider factory | `providers/factory.ts.tpl` | El patron registry es generico |
| Provider types | `providers/types.ts.tpl` | `LLMProvider` con `chat()` y `chatStream()` es el contrato correcto |
| Agent template | `src/templates/basic-agent/index.ts.tpl` | El agente ACP funciona como paso de pipeline sin cambios |
| ACP manager | `src/ipc/acpManager.ts` | Spawn, session, streaming — todo reutilizable |
| DB layer | `src/db/database.ts`, `userDataDir.ts` | Migraciones y WAL mode son correctos |
| Settings repository | `src/db/settingsRepository.ts` | Se extiende para nuevos settings |
| IPC framework | `src/types/ipc.ts` (estructura) | Se anaden tipos nuevos, los existentes no cambian |
| Crypto utils | `src/utils/crypto.ts` | Encripcion de API keys |
| Prompt enhancer | `src/enhancer/` | Se reutiliza para optimizar prompts de agentes |
| Agent generator | `src/generators/agentGenerator.ts` | `scaffoldAgent()` funciona para crear agentes usados en pipelines |
| File system helpers | `src/generators/fileSystem.ts` | `copyTemplateAndInject()` reutilizable |
| Validations | `src/cli/validations.ts` | Validaciones de nombre, descripcion |
| CLI | `src/index.ts`, `src/cli/prompts.ts` | El CLI sigue funcionando independientemente |

### Modificable (cambios menores)

| Componente | Archivo | Cambio necesario |
|---|---|---|
| Agent repository | `src/db/agentRepository.ts` | Anadir campo `isDefault` para agentes pre-instalados |
| Conversation repository | `src/db/conversationRepository.ts` | Sin cambios, pero las conversaciones ahora se asocian a pipeline runs |
| Message repository | `src/db/conversationRepository.ts` | Sin cambios funcionales |
| IPC handlers | `src/ipc/handlers.ts` | Anadir handlers de pipelines (no eliminar los existentes) |
| Handler logic | `src/ipc/handlerLogic.ts` | Anadir funciones de pipeline (las existentes no cambian) |
| Renderer app | `src/renderer/app.ts` | Nueva navegacion: sidebar con pipelines + agentes |
| HTML | `src/renderer/index.html` | Nueva estructura de navegacion |
| CSS | `src/renderer/style.css` | Nuevos estilos para pipeline builder |
| Migrations | `src/db/migrations.ts` | Anadir migraciones v4+ para nuevas tablas |
| Electrobun config | `electrobun.config.ts` | Posible cambio de nombre de app y metadatos |

### Eliminable (ya no necesario en el producto)

| Componente | Archivo | Razon |
|---|---|---|
| Monitor poller | `src/monitor/core/poller.ts` | El monitor del pipeline de desarrollo es meta-herramienta |
| Monitor view | `src/monitor/ui/monitor-view.ts` | Se reemplaza por la vista de ejecucion de pipelines |
| History DB | `src/monitor/core/historyDb.ts` | Solo para el monitor de desarrollo |
| Compliance | `src/monitor/core/complianceRepository.ts`, `complianceParser.ts` | Solo para el pipeline de desarrollo |
| Change detector | `src/monitor/core/changeDetector.ts` | Solo para el monitor de desarrollo |
| Behavior parser | `src/monitor/core/behaviorParser.ts` | Solo para el pipeline de desarrollo |
| Status parser | `src/monitor/core/statusParser.ts` | Solo para el pipeline de desarrollo |

**NOTA:** No se eliminan inmediatamente. Se mueven a un directorio `src/dev-tools/` para mantener la funcionalidad del pipeline de desarrollo interno (Leo→Cloe→Max→Ada→Cipher). El monitor sigue siendo util como herramienta interna del equipo.

---

## 2. Que se modifica

### 2.1 Base de datos — Schema actualizado

```sql
-- Migracion v4: Tablas de pipelines
-- (las tablas existentes agents, conversations, messages, settings NO cambian)

CREATE TABLE IF NOT EXISTS pipeline_templates (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'custom',
  variables     TEXT NOT NULL DEFAULT '[]',  -- JSON: TemplateVariable[]
  steps         TEXT NOT NULL DEFAULT '[]',  -- JSON: TemplateStep[]
  is_builtin    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipelines (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  description   TEXT NOT NULL DEFAULT '',
  template_id   TEXT REFERENCES pipeline_templates(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_steps (
  id              TEXT PRIMARY KEY,
  pipeline_id     TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  step_order      INTEGER NOT NULL,
  name            TEXT NOT NULL,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  input_template  TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pipeline_steps_pipeline ON pipeline_steps(pipeline_id, step_order);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id            TEXT PRIMARY KEY,
  pipeline_id   TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending', 'running', 'completed', 'failed', 'paused')),
  variables     TEXT NOT NULL DEFAULT '{}',   -- JSON: Record<string, string>
  final_output  TEXT,
  error         TEXT,
  started_at    TEXT,
  completed_at  TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline ON pipeline_runs(pipeline_id);

CREATE TABLE IF NOT EXISTS pipeline_step_runs (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  step_id         TEXT NOT NULL REFERENCES pipeline_steps(id) ON DELETE CASCADE,
  step_order      INTEGER NOT NULL,
  agent_name      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending', 'running', 'completed', 'failed')),
  input_resolved  TEXT,      -- El prompt final despues de resolver variables
  output          TEXT,      -- La respuesta del agente
  error           TEXT,
  started_at      TEXT,
  completed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_step_runs_run ON pipeline_step_runs(run_id, step_order);
```

### 2.2 Renderer — Nueva estructura de navegacion

```
Antes:
┌──────────┬────────────────────────┐
│ Agentes  │  [Crear | Chat | etc]  │
│ (lista)  │                        │
│          │                        │
│          │                        │
│ [Monitor]│                        │
│ [Ajustes]│                        │
└──────────┴────────────────────────┘

Despues:
┌──────────────────┬──────────────────────────────┐
│  FLOWTEAM        │                              │
│                  │                              │
│  Pipelines       │  [Pipeline builder]          │
│  ├ Content...    │  [Pipeline execution]        │
│  ├ Code Review   │  [Pipeline results]          │
│  ├ Data...       │  [Agent editor]              │
│  └ + Nuevo       │  [Agent preview/chat]        │
│                  │  [Settings]                   │
│  Agentes         │  [Onboarding]                │
│  ├ Investigador  │                              │
│  ├ Redactor      │                              │
│  ├ Revisor       │                              │
│  └ + Nuevo       │                              │
│                  │                              │
│  [Ajustes]       │                              │
└──────────────────┴──────────────────────────────┘
```

### 2.3 Estructura de archivos nueva

```
src/
  desktop/
    index.ts                    # Main process (EXISTENTE, sin cambios)
  db/
    database.ts                 # DB init + migraciones (MODIFICAR: anadir migraciones v4+)
    migrations.ts               # Definicion de migraciones (MODIFICAR: anadir v4-v7)
    userDataDir.ts              # Paths (EXISTENTE, sin cambios)
    agentRepository.ts          # CRUD agentes (MODIFICAR: anadir isDefault)
    conversationRepository.ts   # Conversaciones (EXISTENTE, sin cambios)
    settingsRepository.ts       # Settings (MODIFICAR: anadir nuevas keys)
    pipelineTemplateRepository.ts  # NUEVO
    pipelineRepository.ts          # NUEVO
    pipelineRunRepository.ts       # NUEVO
  generators/
    agentGenerator.ts           # Scaffolding (EXISTENTE, sin cambios)
    fileSystem.ts               # Helpers (EXISTENTE, sin cambios)
  templates/
    basic-agent/                # Templates de agentes (EXISTENTE, sin cambios)
    pipelines/                  # NUEVO: Templates de pipelines predefinidos
      content-creator.json
      code-review.json
      data-analyst.json
      translator.json
  enhancer/
    promptEnhancer.ts           # (EXISTENTE, sin cambios)
    lmStudioEnhancer.ts         # (EXISTENTE, sin cambios)
    staticEnhancer.ts           # (EXISTENTE, sin cambios)
  ipc/
    handlers.ts                 # Registrar handlers RPC (MODIFICAR: anadir pipeline handlers)
    handlerLogic.ts             # Logica de handlers (MODIFICAR: anadir pipeline logic)
    acpManager.ts               # Gestion ACP (EXISTENTE, sin cambios)
    pipelineRunner.ts           # NUEVO: Motor de ejecucion de pipelines
  renderer/
    app.ts                      # Orquestador UI (MODIFICAR: nueva navegacion)
    index.html                  # HTML base (MODIFICAR: nueva estructura)
    style.css                   # Estilos (MODIFICAR: anadir pipeline styles)
    components/
      agent-list.ts             # (MODIFICAR: adaptar a nuevo layout)
      confirm-dialog.ts         # (EXISTENTE, sin cambios)
    views/
      create-agent.ts           # (MODIFICAR: simplificar formulario)
      chat.ts                   # (EXISTENTE: reutilizar para preview de agente)
      settings.ts               # (MODIFICAR: anadir deteccion de providers)
      pipeline-list.ts          # NUEVO
      pipeline-builder.ts       # NUEVO
      pipeline-execution.ts     # NUEVO
      pipeline-results.ts       # NUEVO
      pipeline-history.ts       # NUEVO
      onboarding.ts             # NUEVO
  cli/
    prompts.ts                  # CLI interactivo (EXISTENTE, sin cambios)
    validations.ts              # Validaciones (EXISTENTE, sin cambios)
  utils/
    logger.ts                   # (EXISTENTE, sin cambios)
    crypto.ts                   # (EXISTENTE, sin cambios)
  monitor/                      # MOVER a src/dev-tools/monitor/ (no eliminar)
  types/
    ipc.ts                      # Contratos IPC (MODIFICAR: anadir tipos de pipeline)
    pipeline.ts                 # NUEVO: tipos de pipeline, template, run
    agent.ts                    # NUEVO: tipos de agente (extraidos de ipc.ts)
```

---

## 3. Que se anade nuevo

### 3.1 PipelineRunner (motor de ejecucion)

```typescript
// src/ipc/pipelineRunner.ts

interface PipelineRunnerConfig {
  maxStepOutputBytes: number;   // default: 50_000
  stepTimeoutMs: number;        // default: 120_000 (2 min)
  retryAttempts: number;        // default: 0 (no retry en MVP)
}

class PipelineRunner {
  // Ejecuta un pipeline completo
  async execute(params: {
    pipelineId: string;
    variables: Record<string, string>;
    runId: string;
  }): Promise<void>;

  // Reanuda un pipeline pausado desde un step especifico
  async resume(params: {
    runId: string;
    fromStepIndex: number;
  }): Promise<void>;

  // Detiene un pipeline en ejecucion
  async stop(runId: string): Promise<void>;

  // Registra callbacks para eventos
  onStepStart(cb: (runId: string, stepIndex: number) => void): void;
  onStepChunk(cb: (runId: string, stepIndex: number, text: string) => void): void;
  onStepComplete(cb: (runId: string, stepIndex: number, output: string) => void): void;
  onStepError(cb: (runId: string, stepIndex: number, error: string) => void): void;
  onPipelineComplete(cb: (runId: string, finalOutput: string) => void): void;
  onPipelineError(cb: (runId: string, error: string) => void): void;
}
```

**Flujo interno del PipelineRunner:**

```
execute()
  │
  ├── 1. Leer pipeline + steps de DB
  ├── 2. Validar que todos los steps tienen agente asignado
  ├── 3. Crear pipeline_run en DB (status='running')
  ├── 4. Para cada step en orden:
  │     │
  │     ├── a. Resolver input_template (reemplazar {{variables}} y {{output_paso_N}})
  │     ├── b. Crear step_run en DB (status='running')
  │     ├── c. Notificar onStepStart al renderer
  │     ├── d. Buscar agente en DB → obtener path
  │     ├── e. Spawn proceso agente via acpManager.createSession()
  │     ├── f. Enviar prompt via acpManager.sendMessage()
  │     ├── g. Recibir chunks → notificar onStepChunk
  │     ├── h. Al completar → guardar output en step_run DB
  │     ├── i. Notificar onStepComplete
  │     ├── j. Cerrar sesion via acpManager.closeSession()
  │     │
  │     └── [Si error en cualquier punto]:
  │           ├── Guardar error en step_run
  │           ├── Notificar onStepError
  │           ├── Marcar pipeline_run como 'paused'
  │           └── Return (no continuar con siguientes steps)
  │
  ├── 5. Concatenar output del ultimo step como final_output
  ├── 6. Marcar pipeline_run como 'completed'
  └── 7. Notificar onPipelineComplete
```

### 3.2 Resolucion de variables

```typescript
// src/ipc/pipelineRunner.ts (funcion helper)

function resolveInputTemplate(
  template: string,
  variables: Record<string, string>,
  previousOutputs: Map<number, string>
): string {
  let resolved = template;

  // Reemplazar variables del usuario: {{variable_nombre}}
  for (const [key, value] of Object.entries(variables)) {
    resolved = resolved.replaceAll(`{{${key}}}`, value);
  }

  // Reemplazar outputs de pasos anteriores: {{output_paso_N}}
  for (const [stepNum, output] of previousOutputs) {
    resolved = resolved.replaceAll(`{{output_paso_${stepNum}}}`, output);
  }

  return resolved;
}
```

### 3.3 Templates predefinidos (JSON)

```json
// src/templates/pipelines/content-creator.json
{
  "name": "Content Creator",
  "description": "Crea contenido pulido a partir de un tema. Un investigador recopila datos, un redactor escribe el borrador, y un revisor lo mejora.",
  "category": "content",
  "variables": [
    {
      "name": "tema",
      "label": "Tema del articulo",
      "type": "text",
      "required": true,
      "placeholder": "Ej: Inteligencia artificial en la educacion"
    }
  ],
  "steps": [
    {
      "order": 1,
      "name": "Investigador",
      "agentRoleHint": "investigator",
      "description": "Recopila puntos clave y datos sobre el tema",
      "inputTemplate": "Investiga sobre {{tema}}. Busca los puntos clave, datos relevantes, tendencias actuales y posibles angulos para un articulo. Organiza la informacion de forma estructurada."
    },
    {
      "order": 2,
      "name": "Redactor",
      "agentRoleHint": "writer",
      "description": "Escribe un borrador basandose en la investigacion",
      "inputTemplate": "Basandote en esta investigacion, escribe un articulo completo, bien estructurado y atractivo:\n\n{{output_paso_1}}"
    },
    {
      "order": 3,
      "name": "Revisor",
      "agentRoleHint": "reviewer",
      "description": "Revisa y mejora el borrador",
      "inputTemplate": "Revisa y mejora este articulo. Mejora la estructura, claridad, gramatica y estilo. Devuelve el articulo final mejorado:\n\n{{output_paso_2}}"
    }
  ]
}
```

### 3.4 Deteccion de providers locales

```typescript
// Nuevo handler en handlers.ts o helper en pipelineRunner.ts

async function detectLocalProviders(): Promise<Array<{
  id: string;
  label: string;
  available: boolean;
  host: string;
}>> {
  const results = [];

  // LM Studio: ping WebSocket
  try {
    const response = await fetch('http://127.0.0.1:1234/v1/models', {
      signal: AbortSignal.timeout(3000),
    });
    results.push({
      id: 'lmstudio',
      label: 'LM Studio',
      available: response.ok,
      host: 'localhost:1234',
    });
  } catch {
    results.push({ id: 'lmstudio', label: 'LM Studio', available: false, host: 'localhost:1234' });
  }

  // Ollama: ping HTTP
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(3000),
    });
    results.push({
      id: 'ollama',
      label: 'Ollama',
      available: response.ok,
      host: 'localhost:11434',
    });
  } catch {
    results.push({ id: 'ollama', label: 'Ollama', available: false, host: 'localhost:11434' });
  }

  return results;
}
```

---

## 4. Diagramas de flujo de datos

### 4.1 Crear pipeline desde template

```
[Renderer]                          [Main Process]                     [SQLite]
    │                                     │                               │
    │  listPipelineTemplates()            │                               │
    │ ──────────────────────────────────► │                               │
    │                                     │  SELECT * FROM pipeline_templates
    │                                     │ ──────────────────────────────►│
    │                                     │ ◄──────────────────────────────│
    │  [{Content Creator, Code, Data}]    │                               │
    │ ◄────────────────────────────────── │                               │
    │                                     │                               │
    │  [Usuario selecciona "Content Creator"]                             │
    │                                     │                               │
    │  getPipelineTemplate(id)            │                               │
    │ ──────────────────────────────────► │                               │
    │                                     │  SELECT * WHERE id = ?        │
    │                                     │ ──────────────────────────────►│
    │                                     │ ◄──────────────────────────────│
    │  template completo con steps        │                               │
    │ ◄────────────────────────────────── │                               │
    │                                     │                               │
    │  [Usuario edita agentes asignados]  │                               │
    │                                     │                               │
    │  createPipeline({name, steps})      │                               │
    │ ──────────────────────────────────► │                               │
    │                                     │  INSERT pipelines             │
    │                                     │ ──────────────────────────────►│
    │                                     │  INSERT pipeline_steps (x3)   │
    │                                     │ ──────────────────────────────►│
    │  {success: true, pipelineId}        │                               │
    │ ◄────────────────────────────────── │                               │
```

### 4.2 Ejecutar pipeline

```
[Renderer]                    [Main Process]              [SQLite]         [Agent Process]
    │                              │                         │                  │
    │  executePipeline(id, vars)   │                         │                  │
    │ ───────────────────────────► │                         │                  │
    │                              │  INSERT pipeline_run    │                  │
    │                              │ ───────────────────────►│                  │
    │                              │                         │                  │
    │                              │ ── [Step 1] ──────────────────────────────│
    │                              │  INSERT step_run (running)                │
    │                              │ ───────────────────────►│                  │
    │  stepUpdated(1, "running")   │                         │                  │
    │ ◄─────────────────────────── │                         │                  │
    │                              │  resolveInputTemplate() │                  │
    │                              │  acpManager.createSession("investigador") │
    │                              │ ─────────────────────────────────────────►│
    │                              │  acpManager.sendMessage(resolved_input)   │
    │                              │ ─────────────────────────────────────────►│
    │                              │  ◄── chunks ──────────────────────────────│
    │  stepChunk(1, "...")         │                         │                  │
    │ ◄─────────────────────────── │                         │                  │
    │                              │  ◄── end ──────────────────────────────── │
    │                              │  UPDATE step_run (completed, output)     │
    │                              │ ───────────────────────►│                  │
    │  stepUpdated(1, "completed") │                         │                  │
    │ ◄─────────────────────────── │  acpManager.closeSession()               │
    │                              │                         │                  │
    │                              │ ── [Step 2] ──────────────────────────────│
    │                              │  (mismo flujo, con {{output_paso_1}}      │
    │                              │   reemplazado por el output del step 1)   │
    │                              │                         │                  │
    │                              │ ── [Step 3] ──────────────────────────────│
    │                              │  (mismo flujo)          │                  │
    │                              │                         │                  │
    │                              │  UPDATE pipeline_run (completed)          │
    │                              │ ───────────────────────►│                  │
    │  pipelineCompleted(runId)    │                         │                  │
    │ ◄─────────────────────────── │                         │                  │
```

### 4.3 Reanudar pipeline pausado

```
[Renderer]                    [Main Process]              [SQLite]
    │                              │                         │
    │  retryPipelineRun(runId)     │                         │
    │ ───────────────────────────► │                         │
    │                              │  SELECT pipeline_run    │
    │                              │ ───────────────────────►│
    │                              │  SELECT step_runs       │
    │                              │ ───────────────────────►│
    │                              │                         │
    │                              │  [Encontrar ultimo step completado]
    │                              │  [Reconstruir previousOutputs map]
    │                              │  [Ejecutar desde step fallido + 1]
    │                              │                         │
```

---

## 5. Modelo de datos completo (SQLite)

### Tablas existentes (sin cambios)

```sql
agents              -- Roles de agentes (reutilizado en pipelines)
conversations       -- Conversaciones (para chat directo con agente)
messages            -- Mensajes (para chat directo con agente)
settings            -- Configuracion global de la app
schema_version      -- Control de migraciones
```

### Tablas nuevas

```sql
pipeline_templates  -- Templates predefinidos y creados por usuario
pipelines           -- Pipelines creados por el usuario
pipeline_steps      -- Pasos de cada pipeline
pipeline_runs       -- Ejecuciones de pipelines
pipeline_step_runs  -- Ejecuciones de cada paso
```

### Relaciones

```
pipeline_templates ──1:N──► pipelines (template_id, opcional)
pipelines ──1:N──► pipeline_steps (pipeline_id)
pipelines ──1:N──► pipeline_runs (pipeline_id)
pipeline_steps ──1:N──► pipeline_step_runs (step_id)
pipeline_runs ──1:N──► pipeline_step_runs (run_id)
agents ──1:N──► pipeline_steps (agent_id, RESTRICT en delete)
agents ──1:N──► conversations (agent_id, CASCADE en delete)
conversations ──1:N──► messages (conversation_id, CASCADE en delete)
```

### Datos pre-insertados (al instalar)

1. **pipeline_templates**: Los 4 templates predefinidos (content-creator, code-review, data-analyst, translator) con `is_builtin = 1`.

2. **agents**: Los 6 agentes sugeridos por defecto (Investigador, Redactor, Revisor, Traductor, Programador, Analista) con system prompts predefinidos. Se marcan con algun flag para distinguirlos de los creados por el usuario.

---

## 6. Decisiones de arquitectura con justificacion

### Decision 1: Ejecucion secuencial, no paralela

**Que:** Los pipelines ejecutan un paso a la vez. Nunca hay 2 agentes corriendo simultaneamente.

**Por que:**
- Hardware modesto: correr 2 modelos locales en paralelo agota la memoria
- Simplifica el estado: no hay race conditions ni concurrencia que manejar
- El output de cada paso es el input del siguiente — hay dependencia natural
- El MVP no necesita paralelismo. Se anade en V2 si hay demanda

### Decision 2: Cada paso spawnea y mata un proceso agente

**Que:** Al inicio de cada paso se spawnea el proceso del agente. Al terminar, se cierra.

**Por que:**
- Libera memoria entre pasos (critico en hardware modesto)
- Evita sesiones fantasma si un agente se cuelga
- El ACP manager ya maneja el ciclo de vida de sesiones
- El overhead de spawn es minimo comparado con el tiempo de inferencia

### Decision 3: Templates en JSON embebidos, no en archivos separados

**Que:** Los templates predefinidos se guardan como JSON en la tabla `pipeline_templates` al instalar la app. Los archivos JSON en `src/templates/pipelines/` son solo para el seed inicial.

**Por que:**
- Un solo source of truth (la DB)
- El usuario puede editar los templates builtin sin tocar archivos
- Simplifica el backup (un solo archivo SQLite)

### Decision 4: El monitor de desarrollo se mueve, no se elimina

**Que:** El monitor del pipeline de desarrollo (Leo→Cloe→Max→Ada→Cipher) se mueve a `src/dev-tools/monitor/`. No es parte del producto final.

**Por que:**
- El equipo de desarrollo sigue usandolo internamente
- Puede reactivarse si en V2 se anade "meta-pipelines" (pipelines que monitorizan otros pipelines)
- Evita perder codigo funcional

### Decision 5: Renderer vanilla TS, sin framework

**Que:** El renderer sigue usando TypeScript vanilla sin React, Vue, etc.

**Por que:**
- Electrobun usa system webview — bundle pequeno es critico
- La UI no es suficientemente compleja para justificar un framework
- Las vistas existentes (chat, settings, create-agent) ya funcionan sin framework
- Anadir un framework aumenta el bundle y la superficie de bugs

### Decision 6: Pipeline step = 1 agente + 1 prompt

**Que:** Cada paso de pipeline ejecuta exactamente un agente con un prompt. No hay pasos de "transformacion" sin agente.

**Por que:**
- Simplifica el modelo mental del usuario: "cada paso es un especialista"
- Simplifica la implementacion: un solo tipo de paso
- Si el usuario necesita transformar texto sin IA, puede crear un agente con un prompt de transformacion
- En V2 se pueden anadir tipos de paso adicionales (HTTP, script, condicional)

### Decision 7: Schema preparado para bifurcaciones, sin implementarlas en MVP

**Que:** La tabla `pipeline_steps` no tiene aun campos de bifurcacion condicional, pero su diseno los admite sin migraciones destructivas. En V2 se puede anadir una columna `branch_condition TEXT` y `next_step_id_on_true / next_step_id_on_false` como ALTER TABLE no destructivo.

**Por que:**
- El pipeline secuencial cubre el 80% de los casos de uso del MVP
- Anadir bifurcaciones antes de tener usuarios reales es construir complejidad que nadie pidio
- Disenar el schema ahora para soportarlo despues cuesta cero: no hay logica extra, solo columnas nullable que se ignoran hasta que se necesiten
- Evita una migracion dolorosa cuando llegue la demanda real

**Implicacion practica:** No anadir `branch_condition` ahora. Solo tener presente que `step_order` como INTEGER (no como linked list) facilita la insercion de pasos intermedios sin renumerar todo.
