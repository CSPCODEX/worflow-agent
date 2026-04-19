# Especificaciones Funcionales — Workflow Agent

## 1. Pipelines predefinidos

### 1.1 Content Creator

**Descripcion:** Pipeline de creacion de contenido que toma un tema y produce un articulo pulido.

```
Paso 1: Investigador
  Input:  "Investiga sobre {{tema}}. Busca los puntos clave, datos relevantes y tendencias actuales."
  Output: Lista estructurada de puntos clave y datos

Paso 2: Redactor
  Input:  "Basandote en esta investigacion, escribe un articulo completo sobre {{tema}}:\n\n{{output_paso_1}}"
  Output: Borrador de articulo

Paso 3: Revisor
  Input:  "Revisa este articulo. Mejora la estructura, claridad y estilo. Corrige errores:\n\n{{output_paso_2}}"
  Output: Articulo final pulido
```

**Variables del usuario:** `tema` (requerido)
**Output final:** Texto del articulo final

### 1.2 Code Review

**Descripcion:** Pipeline de revision y mejora de codigo.

```
Paso 1: Auditor
  Input:  "Analiza este codigo. Identifica bugs, code smells, y problemas de seguridad:\n\n{{codigo}}"
  Output: Lista de problemas encontrados con explicacion

Paso 2: Refactorizador
  Input:  "Refactoriza este codigo abordando estos problemas:\n\nCodigo original:\n{{codigo}}\n\nProblemas:\n{{output_paso_1}}"
  Output: Codigo refactorizado

Paso 3: Verificador
  Input:  "Verifica que este codigo refactorizado es correcto y mejora al original:\n\nOriginal:\n{{codigo}}\n\nRefactorizado:\n{{output_paso_2}}"
  Output: Veredicto + explicacion de mejoras
```

**Variables del usuario:** `codigo` (requerido)
**Output final:** Codigo refactorizado + veredicto

### 1.3 Data Analyst

**Descripcion:** Pipeline de analisis de datos en texto.

```
Paso 1: Limpiador
  Input:  "Limpia y estructura estos datos para analisis. Identifica el formato, corrige inconsistencias:\n\n{{datos}}"
  Output: Datos limpios y estructurados en texto

Paso 2: Analista
  Input:  "Analiza estos datos. Identifica patrones, tendencias, outliers y estadisticas clave:\n\n{{output_paso_1}}"
  Output: Analisis detallado

Paso 3: Visualizador textual
  Input:  "Crea un informe ejecutivo basado en este analisis. Incluye resumen, hallazgos principales y recomendaciones:\n\n{{output_paso_2}}"
  Output: Informe ejecutivo en texto
```

**Variables del usuario:** `datos` (requerido)
**Output final:** Informe ejecutivo

### 1.4 Traductor

**Descripcion:** Pipeline de traduccion con revision cultural.

```
Paso 1: Traductor
  Input:  "Traduce el siguiente texto al {{idioma_destino}}. Mantén el tono y estilo original:\n\n{{texto}}"
  Output: Traduccion literal

Paso 2: Revisor cultural
  Input:  "Revisa esta traduccion al {{idioma_destino}}. Ajusta expresiones idiomáticas, tono cultural y fluidez:\n\n{{output_paso_1}}\n\nTexto original:\n{{texto}}"
  Output: Traduccion revisada y naturalizada
```

**Variables del usuario:** `texto` (requerido), `idioma_destino` (requerido)
**Output final:** Traduccion revisada

---

## 2. Template system

### 2.1 Estructura de un template

```typescript
interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  category: 'content' | 'code' | 'data' | 'translation' | 'custom';
  variables: TemplateVariable[];
  steps: TemplateStep[];
  createdAt: string;
  isBuiltin: boolean;  // true = viene con la app, false = creado por el usuario
}

interface TemplateVariable {
  name: string;        // ej: "tema"
  label: string;       // ej: "Tema del articulo"
  type: 'text' | 'textarea' | 'code';
  required: boolean;
  defaultValue?: string;
  placeholder?: string;
}

interface TemplateStep {
  order: number;
  name: string;           // ej: "Investigador"
  agentRoleHint: string;  // ej: "investigator" — sugiere un tipo de agente
  inputTemplate: string;  // String con {{variables}} y {{output_paso_N}}
  description: string;    // Descripcion corta de lo que hace este paso
}
```

### 2.2 Resolucion de variables

El motor de ejecucion reemplaza las variables en el `inputTemplate` de cada paso:

1. `{{variable_nombre}}` se reemplaza con el valor proporcionado por el usuario
2. `{{output_paso_N}}` se reemplaza con el output del paso N (1-indexed)
3. Si una variable no tiene valor y es requerida, el pipeline falla con mensaje claro
4. Si una variable no tiene valor y no es requerida, se reemplaza con string vacio

### 2.3 Crear pipeline desde template

```
Usuario selecciona template → Se pre-llena la estructura del pipeline
→ Usuario puede modificar nombre, pasos, agentes asignados
→ Al ejecutar, se piden las variables definidas en el template
```

### 2.4 Guardar como template

```
Usuario crea un pipeline desde cero → Click "Guardar como template"
→ Se crea un template con las variables detectadas automaticamente
→ El template aparece en la biblioteca con isBuiltin = false
```

---

## 3. UI Flows

### 3.1 Crear pipeline

```
[Pagina principal]
    │
    ├── Click "Nuevo Pipeline"
    │       │
    │       ▼
    │   [Modal: ¿Desde template o vacio?]
    │       │                    │
    │       ├── "Desde template" ──── "Vacio"
    │       │       │                    │
    │       │       ▼                    ▼
    │       │  [Lista de templates]  [Editor vacio]
    │       │       │                    │
    │       │       ▼                    │
    │       │  [Editor pre-llenado] ◄────┘
    │       │       │
    │       │       ▼
    │       │  [Editor de pipeline]
    │       │   - Nombre (input)
    │       │   - Descripcion (textarea)
    │       │   - Lista de pasos:
    │       │     ┌─────────────────────────┐
    │       │     │ 1. Investigador          │
    │       │     │    Agente: [selector v]  │
    │       │     │    Input: [textarea]     │
    │       │     │    [↑] [↓] [×]          │
    │       │     ├─────────────────────────┤
    │       │     │ 2. Redactor              │
    │       │     │    ...                   │
    │       │     └─────────────────────────┘
    │       │   [+ Añadir paso]
    │       │
    │       │   [Cancelar] [Guardar]
    │       │       │
    │       │       ▼
    │       │  Pipeline guardado, aparece en la lista
    │       │
    │       ▼
    │   Pipeline visible en sidebar
```

### 3.2 Ejecutar pipeline

```
[Lista de pipelines]
    │
    ├── Click en un pipeline
    │       │
    │       ▼
    │   [Vista de detalle del pipeline]
    │       │
    │       ├── Click "Ejecutar"
    │       │       │
    │       │       ▼
    │       │   [Modal: Variables requeridas]
    │       │       │
    │       │       │  Tema del articulo: [_______]
    │       │       │
    │       │       │  [Cancelar] [Ejecutar]
    │       │       │       │
    │       │       ▼
    │       │   [Vista de ejecucion]
    │       │       │
    │       │       │  ┌─ Paso 1: Investigador ── COMPLETADO ──┐
    │       │       │  │  [Output expandible]                    │
    │       │       │  └─────────────────────────────────────────┘
    │       │       │  ┌─ Paso 2: Redactor ── EJECUTANDO... ────┐
    │       │       │  │  [Output streaming en tiempo real]      │
    │       │       │  └─────────────────────────────────────────┘
    │       │       │  ┌─ Paso 3: Revisor ── PENDIENTE ─────────┐
    │       │       │  │                                         │
    │       │       │  └─────────────────────────────────────────┘
    │       │       │
    │       │       │  [Detener ejecucion]
    │       │       │
    │       │       ▼
    │       │   [Todos completados → Vista de resultado final]
    │       │       │
    │       │       │  Output final: [texto completo]
    │       │       │  [Copiar] [Guardar como archivo] [Re-ejecutar]
```

### 3.3 Ver resultados historicos

```
[Lista de pipelines]
    │
    ├── Click en un pipeline → Tab "Historial"
    │       │
    │       ▼
    │   [Lista de ejecuciones]
    │       │
    │       │  2026-04-19 14:30 │ Completado │ "Inteligencia artificial" │ [Ver]
    │       │  2026-04-18 10:15 │ Completado │ "Cambio climatico"        │ [Ver]
    │       │  2026-04-17 09:00 │ Error      │ "Economia circular"       │ [Ver]
    │       │
    │       └── Click [Ver] → Muestra la ejecucion completa con outputs de cada paso
```

---

## 4. Sistema de roles de agentes

### 4.1 Concepto

Un "agente" en FlowTeam es un rol con un system prompt. No es un proceso corriendo constantemente — se instancia cuando se necesita para un paso de pipeline.

### 4.2 Estructura de un agente

```typescript
interface AgentRole {
  id: string;
  name: string;             // ej: "Investigador", "Redactor", "Revisor"
  description: string;      // Descripcion corta para el selector
  systemPrompt: string;     // El prompt que define su comportamiento
  provider: ProviderId;     // lmstudio, ollama, openai, anthropic, gemini
  model?: string;           // Modelo especifico (opcional, usa default si no)
  createdAt: string;
  updatedAt: string;
}
```

### 4.3 Agentes sugeridos por defecto

Al instalar la app, se crean automaticamente estos agentes con system prompts predefinidos:

| Nombre | System Prompt (resumen) | Uso tipico |
|---|---|---|
| Investigador | "Eres un investigador exhaustivo. Analiza el tema proporcionado y devuelve una lista estructurada de puntos clave, datos relevantes y fuentes." | Paso 1 de Content Creator |
| Redactor | "Eres un redactor profesional. Escribe contenido claro, bien estructurado y adaptado al publico objetivo." | Paso 2 de Content Creator |
| Revisor | "Eres un editor exigente. Revisa el contenido proporcionado y mejora estructura, claridad, gramatica y estilo." | Paso 3 de Content Creator |
| Traductor | "Eres un traductor profesional. Traduce el texto manteniendo el tono, estilo y precision del original." | Traductor |
| Programador | "Eres un programador experto. Analiza, escribe y refactoriza codigo con buenas practicas." | Code Review |
| Analista | "Eres un analista de datos. Identifica patrones, tendencias y genera insights a partir de datos." | Data Analyst |

Estos agentes se pueden editar, eliminar o duplicar. El usuario puede crear tantos como quiera.

### 4.4 Asignar agente a paso de pipeline

Cada paso del pipeline tiene un selector de agente. El selector muestra todos los agentes disponibles. Al seleccionar uno, se muestra su descripcion para confirmar que es el correcto.

Si el usuario no tiene un agente adecuado, puede crear uno desde el selector sin salir del editor de pipeline.

---

## 5. Persistencia y recuperacion

### 5.1 Que se guarda

| Entidad | Cuando se guarda | Donde |
|---|---|---|
| Agentes (roles) | Al crear/editar | SQLite `agents` |
| Pipelines | Al crear/editar | SQLite `pipelines` + `pipeline_steps` |
| Templates | Al guardar como template | SQLite `pipeline_templates` |
| Ejecuciones | Automaticamente durante ejecucion | SQLite `pipeline_runs` + `pipeline_step_runs` |
| Settings | Al guardar | SQLite `settings` |

### 5.2 Recuperacion ante fallos

- **App se cierra durante ejecucion:** El estado de cada paso completado esta en la DB. Al reabrir, el pipeline aparece como "En pausa" con opcion de "Reanudar desde paso N".
- **Modelo local se desconecta:** El paso actual falla con error claro: "No se pudo conectar con [provider]. Verifica que este corriendo." El pipeline se pausa. El usuario puede reintentar.
- **Output muy largo:** Se guarda completo en la DB, pero en la UI se muestra truncado con opcion "Ver completo".

### 5.3 Limite de datos

- Maximo 100 ejecuciones por pipeline se guardan (las mas recientes). Las anteriores se eliminan automaticamente.
- Output de cada paso: maximo 50 KB guardados en DB. Si el modelo genera mas, se trunca con aviso.
- Maximo 50 pipelines activos por usuario.

---

## 6. Configuracion de providers

### 6.1 Flujo de configuracion

```
[Primera vez que se abre la app]
        │
        ▼
[Deteccion automatica]
    ├── LM Studio corriendo en localhost:1234? → Marcar como disponible
    ├── Ollama corriendo en localhost:11434?   → Marcar como disponible
    └── Ninguno? → Mostrar guia de instalacion
        │
        ▼
[Si al menos uno disponible]
    → Provider default = primer local disponible
    → Continuar al onboarding
        │
        ▼
[Si ninguno disponible]
    → Mostrar opciones:
       1. "Instala LM Studio" (link a descarga)
       2. "Instala Ollama" (link a descarga)
       3. "Usar API cloud (requiere API key)"
```

### 6.2 Providers soportados

| Provider | Requiere config | Tipo | Detectable |
|---|---|---|---|
| LM Studio | No (auto-detect en localhost:1234) | Local | Si (WebSocket ping) |
| Ollama | No (auto-detect en localhost:11434) | Local | Si (HTTP ping) |
| OpenAI | Si (API key) | Cloud | No |
| Anthropic | Si (API key) | Cloud | No |
| Gemini | Si (API key) | Cloud | No |

### 6.3 Provider por agente vs global

- **Default:** Todos los agentes usan el provider global configurado en Settings.
- **Override:** Un agente individual puede usar un provider diferente (ej: la mayoria usan Ollama local, pero el Revisor usa Claude para mejor calidad).
- En el MVP, solo se soporta provider global. El override por agente se anade en V1.

### 6.4 Recomendaciones de modelo por template

Los modelos locales pequeños (7B) pueden producir resultados mediocres en pipelines de varios pasos. Para gestionar expectativas:

| Template | Modelo mínimo recomendado | Notas |
|---|---|---|
| Content Creator | 13B | Requiere cohesión entre pasos largos |
| Code Review | 7B (fine-tuned código) | Llama 3.1 8B Instruct funciona bien |
| Data Analyst | 13B | Necesita seguir instrucciones complejas |
| Traductor | 7B | Es el menos exigente |

**Cómo implementar:** Mostrar en la descripción del template una etiqueta de modelo recomendado. En el onboarding, al detectar el modelo cargado en LM Studio/Ollama, advertir si está por debajo del mínimo recomendado para el template seleccionado. Nunca bloquear — solo informar.

### 6.5 Validacion de conexion

Settings tiene un boton "Probar conexion" para cada provider configurado:

- **LM Studio:** Envía un ping WebSocket a ws://127.0.0.1:1234. Si responde, verde.
- **Ollama:** HTTP GET a http://localhost:11434/api/tags. Si responde, verde.
- **Cloud APIs:** Envía un request minimo (list models o similar) con la API key. Si responde 200, verde.

---

## 7. Contratos IPC principales (para implementacion)

### 7.1 Nuevos handlers requeridos

```typescript
// --- Pipeline CRUD ---
createPipeline(params: {
  name: string;
  description: string;
  templateId?: string;
  steps: Array<{
    order: number;
    name: string;
    agentId: string;
    inputTemplate: string;
  }>;
}): Promise<{ success: boolean; pipelineId?: string; error?: string }>;

listPipelines(params: undefined): Promise<{
  pipelines: Array<{
    id: string;
    name: string;
    description: string;
    stepCount: number;
    lastRunAt: string | null;
    lastRunStatus: string | null;
    createdAt: string;
  }>;
}>;

getPipeline(params: { pipelineId: string }): Promise<{
  pipeline: {
    id: string;
    name: string;
    description: string;
    steps: Array<{
      id: string;
      order: number;
      name: string;
      agentId: string;
      agentName: string;
      inputTemplate: string;
    }>;
  } | null;
}>;

updatePipeline(params: {
  pipelineId: string;
  name?: string;
  description?: string;
  steps?: Array<{
    order: number;
    name: string;
    agentId: string;
    inputTemplate: string;
  }>;
}): Promise<{ success: boolean; error?: string }>;

deletePipeline(params: { pipelineId: string }): Promise<{ success: boolean; error?: string }>;

// --- Pipeline Execution ---
executePipeline(params: {
  pipelineId: string;
  variables: Record<string, string>;
}): Promise<{ success: boolean; runId?: string; error?: string }>;

getPipelineRun(params: { runId: string }): Promise<{
  run: {
    id: string;
    pipelineId: string;
    pipelineName: string;
    status: 'running' | 'completed' | 'failed' | 'paused';
    variables: Record<string, string>;
    steps: Array<{
      stepName: string;
      agentName: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      output: string | null;
      startedAt: string | null;
      completedAt: string | null;
    }>;
    startedAt: string;
    completedAt: string | null;
    error: string | null;
  } | null;
}>;

listPipelineRuns(params: {
  pipelineId: string;
  limit?: number;
  offset?: number;
}): Promise<{
  runs: Array<{
    id: string;
    status: string;
    variables: Record<string, string>;
    startedAt: string;
    completedAt: string | null;
  }>;
  totalCount: number;
}>;

retryPipelineRun(params: { runId: string }): Promise<{ success: boolean; error?: string }>;

// --- Templates ---
listPipelineTemplates(params: undefined): Promise<{
  templates: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    stepCount: number;
    isBuiltin: boolean;
  }>;
}>;

getPipelineTemplate(params: { templateId: string }): Promise<{
  template: {
    id: string;
    name: string;
    description: string;
    category: string;
    variables: Array<{ name: string; label: string; type: string; required: boolean; placeholder?: string }>;
    steps: Array<{ order: number; name: string; agentRoleHint: string; inputTemplate: string; description: string }>;
    isBuiltin: boolean;
  } | null;
}>;

// --- Provider Detection ---
detectLocalProviders(params: undefined): Promise<{
  providers: Array<{
    id: string;
    label: string;
    available: boolean;
    host: string;
  }>;
}>;

validateProviderConnection(params: {
  providerId: string;
  apiKey?: string;
}): Promise<{ success: boolean; error?: string }>;

// --- Messages from bun to webview ---
// pipelineRunStepUpdated: {
//   runId: string;
//   stepIndex: number;
//   status: 'running' | 'completed' | 'failed';
//   output?: string;  // solo en completed
//   error?: string;   // solo en failed
// }
//
// pipelineRunCompleted: {
//   runId: string;
//   status: 'completed' | 'failed';
//   error?: string;
// }
```

### 7.2 AppRPC type actualizado

```typescript
export type AppRPC = {
  bun: RPCSchema<{
    requests: {
      // --- Agentes (existentes, sin cambios) ---
      generateAgent: { params: AgentConfig; response: GenerateAgentResult };
      listAgents: { params: undefined; response: ListAgentsResult };
      listProviders: { params: undefined; response: ListProvidersResult };
      createSession: { params: CreateSessionParams; response: CreateSessionResult };
      sendMessage: { params: SendMessageParams; response: SendMessageResult };
      closeSession: { params: { sessionId: string }; response: void };
      // conversations, messages, settings... (existentes)
      createConversation: { params: CreateConversationParams; response: CreateConversationResult };
      listConversations: { params: ListConversationsParams; response: ListConversationsResult };
      getMessages: { params: GetMessagesParams; response: GetMessagesResult };
      saveMessage: { params: SaveMessageParams; response: SaveMessageResult };
      deleteConversation: { params: DeleteConversationParams; response: DeleteConversationResult };
      deleteAgent: { params: DeleteAgentParams; response: DeleteAgentResult };
      loadSettings: { params: undefined; response: LoadSettingsResult };
      saveSettings: { params: SaveSettingsParams; response: SaveSettingsResult };

      // --- Pipelines (nuevos) ---
      createPipeline: { params: CreatePipelineParams; response: CreatePipelineResult };
      listPipelines: { params: undefined; response: ListPipelinesResult };
      getPipeline: { params: GetPipelineParams; response: GetPipelineResult };
      updatePipeline: { params: UpdatePipelineParams; response: UpdatePipelineResult };
      deletePipeline: { params: DeletePipelineParams; response: DeletePipelineResult };
      executePipeline: { params: ExecutePipelineParams; response: ExecutePipelineResult };
      getPipelineRun: { params: GetPipelineRunParams; response: GetPipelineRunResult };
      listPipelineRuns: { params: ListPipelineRunsParams; response: ListPipelineRunsResult };
      retryPipelineRun: { params: RetryPipelineRunParams; response: RetryPipelineRunResult };
      listPipelineTemplates: { params: undefined; response: ListPipelineTemplatesResult };
      getPipelineTemplate: { params: GetPipelineTemplateParams; response: GetPipelineTemplateResult };
      detectLocalProviders: { params: undefined; response: DetectLocalProvidersResult };
      validateProviderConnection: { params: ValidateConnectionParams; response: ValidateConnectionResult };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      // Existentes
      agentMessageChunk: AgentMessageChunk;
      agentMessageEnd: AgentMessageEnd;
      agentError: AgentError;
      agentInstallDone: AgentInstallDone;
      agentEnhanceDone: AgentEnhanceDone;
      // Nuevos
      pipelineRunStepUpdated: PipelineRunStepUpdated;
      pipelineRunCompleted: PipelineRunCompleted;
    };
  }>;
};
```

---

## 8. Flujo de datos: Ejecucion de pipeline

```
[Renderer]                    [Main Process]                    [ACP Agent]
    │                              │                               │
    │  executePipeline(id, vars)   │                               │
    │ ───────────────────────────► │                               │
    │                              │                               │
    │                              │  1. Leer pipeline de DB        │
    │                              │  2. Leer steps de DB           │
    │                              │  3. Crear pipeline_run en DB   │
    │                              │  4. Para cada step:            │
    │                              │     a. Resolver input template │
    │                              │        (reemplazar {{vars}})   │
    │                              │     b. Crear step_run en DB    │
    │  pipelineRunStepUpdated      │     c. Buscar agente en DB     │
    │ ◄─────────────────────────── │     d. Spawn proceso agente   │
    │                              │ ──────────────────────────────►│
    │                              │     e. newSession (ACP)        │
    │                              │ ──────────────────────────────►│
    │                              │     f. prompt (ACP)            │
    │                              │ ──────────────────────────────►│
    │                              │     g. Recibir chunks          │
    │                              │ ◄────────────────────────────── │
    │  pipelineRunStepUpdated      │     h. Guardar output en DB    │
    │ ◄─────────────────────────── │     i. Cerrar proceso agente  │
    │                              │     j. Siguiente step          │
    │                              │                               │
    │  pipelineRunCompleted        │                               │
    │ ◄─────────────────────────── │                               │
    │                              │                               │
```

**Nota importante:** Cada paso ejecuta UN agente en UN momento. No hay concurrencia de agentes en el MVP. El proceso del agente se spawnea al inicio del paso y se cierra al terminar. Esto simplifica el manejo de recursos y es compatible con hardware modesto.
