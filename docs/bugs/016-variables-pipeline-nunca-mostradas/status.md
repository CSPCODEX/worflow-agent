# Bug #016 — Variables de pipeline nunca se muestran al usuario — pipelines con template se ejecutan con vars vacías

Estado: RESUELTO
Rama: feature/dev
Fecha apertura: 2026-04-19
Fecha cierre: 2026-04-19
Requiere auditoria de Cipher: NO

---

## Info del bug

**Descripcion:** src/renderer/app.ts línea 291 accede a `result.pipeline.variables || []` pero el tipo GetPipelineResult (src/types/pipeline.ts líneas 111-124) no incluye el campo `variables`. El acceso siempre retorna `[]` en runtime, nunca muestra el modal de variables. Adicionalmente, src/ipc/handlerLogic.ts línea 282-285 mapea el pipeline sin incluir variables (que vienen del template, no del pipeline). Las variables del template (Content Creator: {topic}, {tone}; Code Review: {language}, etc.) nunca se piden al usuario.

**Como reproducir:**
1. Crear un pipeline con el template "Content Creator"
2. Ejecutar el pipeline
3. Observar que no aparece ningún modal de variables
4. El pipeline se ejecuta con `{topic}` y `{tone}` sin sustituir

**Comportamiento esperado:** Antes de ejecutar, aparece un modal solicitando los valores de las variables del template ({topic}, {tone}, etc.).

**Comportamiento actual:** El pipeline se ejecuta directamente sin pedir variables, dejando los placeholders sin sustituir en el prompt.

**Severidad:** ALTA

**Tiene implicaciones de seguridad:** NO

---

## Diagnostico de Max

### Causa raiz confirmada

Hay tres problemas encadenados:

**Problema 1 — GetPipelineResult no expone templateId ni variables**
- `src/types/pipeline.ts` lineas 111-124: la interfaz `GetPipelineResult.pipeline` no incluye `templateId` ni `variables`.
- `src/ipc/handlerLogic.ts` lineas 391-408: `handleGetPipeline` mapea el pipeline sin incluir `templateId` en la respuesta.
- En consecuencia, `app.ts` no puede saber si el pipeline tiene template ni cual es.

**Problema 2 — app.ts accede a un campo que no existe en el tipo**
- `src/renderer/app.ts` linea 290: `result.pipeline.variables || []` — el campo `variables` no existe en `GetPipelineResult.pipeline`. En runtime retorna siempre `undefined`, la expresion `|| []` produce array vacio, el modal de variables nunca se muestra.

**Problema 3 — El handler getPipelineTemplate ya existe pero no se usa aqui**
- `src/ipc/handlerLogic.ts` linea 556: `handleGetPipelineTemplate` esta implementado y devuelve `template.variables` correctamente.
- `src/ipc/handlers.ts` linea 257: esta registrado como `getPipelineTemplate` y disponible via `rpc.request.getPipelineTemplate`.
- `src/db/pipelineRepository.ts` linea 38: `PipelineRecord` tiene el campo `templateId: string | null` — el dato ya esta en la DB.
- El handler `handleGetPipeline` tiene acceso a `pipeline.templateId` (linea 388: `const pipeline = pipelineRepository.getPipeline(...)`) pero no lo expone en la respuesta.

### Opcion elegida: B — Cargar template por separado en app.ts

**Razon:** El handler `getPipelineTemplate` ya existe, ya esta registrado y ya devuelve `variables` con el tipo correcto (`GetPipelineTemplateResult`). La Opcion B requiere el minimo de cambios:
1. Añadir `templateId` a `GetPipelineResult.pipeline` en types y en el mapeo de handlerLogic.
2. En `showPipelineExecution` de app.ts, si `pipeline.templateId` existe, llamar a `rpc.request.getPipelineTemplate({ templateId })` para obtener las variables.

La Opcion A (JOIN en handleGetPipeline) acopla el pipeline handler con pipelineTemplateRepository y modifica mas superficie de codigo sin ventaja clara.

---

## Handoff Max → Cloe

### Archivos a modificar

**1. `src/types/pipeline.ts` — lineas 111-124**

Añadir `templateId` al objeto `pipeline` dentro de `GetPipelineResult`:

```typescript
export interface GetPipelineResult {
  pipeline: {
    id: string;
    name: string;
    description: string;
    templateId: string | null;   // <-- añadir este campo
    steps: Array<{
      id: string;
      order: number;
      name: string;
      agentId: string;
      agentName: string;
      inputTemplate: string;
    }>;
  } | null;
}
```

**2. `src/ipc/handlerLogic.ts` — lineas 391-408**

En el mapeo de `handleGetPipeline`, exponer `templateId`:

```typescript
return {
  pipeline: {
    id: pipeline.id,
    name: pipeline.name,
    description: pipeline.description,
    templateId: pipeline.templateId,   // <-- añadir esta linea
    steps: pipeline.steps.map((s) => {
      // ... igual que antes
    }),
  },
};
```

**3. `src/renderer/app.ts` — funcion `showPipelineExecution` (lineas 280-317)**

Reemplazar el bloque `try/catch` que carga el pipeline para que, cuando `templateId` exista, haga una segunda llamada a `getPipelineTemplate` y use sus variables:

```typescript
async function showPipelineExecution(pipelineId: string) {
  teardownCurrentView();
  const rpc = (window as any).appRpc;
  let pipelineInfo: { name: string; variables: Array<{ name: string; label: string; type: string; required: boolean; placeholder?: string }> } | null = null;

  try {
    const result = await rpc.request.getPipeline({ pipelineId });
    if (result.pipeline) {
      let variables: Array<{ name: string; label: string; type: string; required: boolean; placeholder?: string }> = [];

      if (result.pipeline.templateId) {
        const templateResult = await rpc.request.getPipelineTemplate({ templateId: result.pipeline.templateId });
        variables = templateResult.template?.variables ?? [];
      }

      pipelineInfo = {
        name: result.pipeline.name,
        variables,
      };
    }
  } catch (e) {
    console.error('Error loading pipeline:', e);
  }
  // ... resto igual
}
```

### Criterios de verificacion para Max (post-fix)

1. Al ejecutar un pipeline con template "Content Creator", aparece modal solicitando `{topic}` y `{tone}` — evidencia: verificacion visual o test
2. Las variables introducidas sustituyen los placeholders en el prompt — evidencia: log del IPC con variables en `ExecutePipelineParams`
3. Pipelines sin template (templateId null) no muestran modal de variables — evidencia: verificacion con pipeline creado manualmente
4. `bun run tsc --noEmit` — sin errores nuevos en `src/types/pipeline.ts`, `src/ipc/handlerLogic.ts`, `src/renderer/app.ts`
5. El campo `templateId` del tipo `GetPipelineResult` coincide con lo que retorna `handleGetPipeline`

### Gaps declarados por Max

- No se puede verificar en runtime (sin entorno Electrobun disponible). La logica se verifica estaticamente.
- El campo `defaultValue` de `TemplateVariable` no se propaga al modal — fuera de scope de este bug pero puede ser un follow-up.

Confianza en el diagnostico: alta

---

## Metricas de Max (diagnostico)

- archivos_leidos: 6
- bugs_criticos: 0
- bugs_altos: 1
- bugs_medios: 0
- items_checklist_verificados: 3/3 (ESTATICO activo: archivos verificados, tsc sin errores nuevos en src/, logica verificada)
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 2

---

→ Siguiente: @cloe Implementa el fix del bug #016. Los tres archivos a modificar y los cambios exactos están en la sección "Handoff Max → Cloe" de este status.md. La opción elegida es B: añadir `templateId` a `GetPipelineResult` (types + handlerLogic) y en `showPipelineExecution` de app.ts hacer una segunda llamada a `getPipelineTemplate` cuando `templateId` no sea null.

---

## Handoff Cloe → Max

### Cambios implementados

Fix de la Opcion B: tres cambios quirurgicos encadenados.

**1. `src/types/pipeline.ts` linea 116** — Campo `templateId: string | null` añadido a `GetPipelineResult.pipeline`. El tipo ahora es coherente con `PipelineRecord` en `src/db/pipelineRepository.ts`.

**2. `src/ipc/handlerLogic.ts` linea 396** — `templateId: pipeline.templateId` añadido al objeto de respuesta de `handleGetPipeline`. El valor viene directamente de `PipelineRecord` que ya lo tenia en DB.

**3. `src/renderer/app.ts` lineas 288-298** — Bloque `try/catch` en `showPipelineExecution` reemplazado. Ahora:
- Declara `variables = []` por defecto (pipelines sin template: sin modal)
- Si `result.pipeline.templateId` no es null, hace una segunda llamada `rpc.request.getPipelineTemplate({ templateId })`
- Asigna `templateResult.template?.variables ?? []` — el `??` cubre el caso de template no encontrado

### Checklist Cloe
- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Leo (o documentado por que difieren)
- [x] bun run tsc --noEmit ejecutado — 0 errores nuevos en src/types/pipeline.ts, src/ipc/handlerLogic.ts, src/renderer/app.ts
- [x] Strings que viajan por IPC son ASCII puro (sin tildes, acentos ni chars > 0x7E)
- [x] Fire-and-forget en todos los handlers IPC que lanzan subprocesos — no aplica (este fix no toca spawns)
- [x] Input validation en todos los IPC handlers que tocan filesystem o spawn — no aplica (este fix es solo mapeo y lectura)
- [x] DB: si INSERT falla despues de scaffold, rollback del directorio creado — no aplica (sin DB writes)
- [x] initDatabase() en try/catch con process.exit(1) si lanza — no aplica (no se toca initDatabase)
- [x] Sin `any` sin justificacion — no se introduce ningun `any` nuevo
- [x] Labels HTML: no se crean formularios ni inputs nuevos
- [x] Si creaste vistas nuevas: no aplica (no se crean vistas nuevas)

### Manifiesto de archivos
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| src/types/pipeline.ts | modificado | 116 (añadido templateId: string | null) |
| src/ipc/handlerLogic.ts | modificado | 396 (añadido templateId: pipeline.templateId) |
| src/renderer/app.ts | modificado | 285-302 (bloque try/catch reemplazado con logica de segunda llamada) |

### Gaps y dudas de Cloe

- Sin verificacion en runtime: el entorno Electrobun no esta disponible para ejecutar el flujo completo.
- El campo `defaultValue` de `TemplateVariable` sigue sin propagarse al modal — heredado del diagnostico de Max, fuera de scope.

Confianza en la implementacion: alta

Sin gaps adicionales porque: fix de 3 lineas de cambio neto mas logica de segunda llamada; tsc limpio en los 3 archivos modificados; la cadena de tipos (PipelineRecord.templateId → GetPipelineResult.templateId → getPipelineTemplate) es consistente.

---

## Metricas de Cloe
- archivos_leidos: 4
- archivos_creados: 0
- archivos_modificados: 3
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 2

---

## Verificacion final de Max

### Checklist Max — bloques activos: ESTATICO | IPC | RENDERER

## ESTATICO
- [x] Cada archivo del manifiesto verificado con file:line
  - `src/types/pipeline.ts:116` — `templateId: string | null` presente en `GetPipelineResult.pipeline` — evidencia: leido en lineas 111-126
  - `src/ipc/handlerLogic.ts:396` — `templateId: pipeline.templateId` presente en el objeto de respuesta de `handleGetPipeline` — evidencia: leido en lineas 391-409
  - `src/renderer/app.ts:285-302` — bloque try/catch reemplazado con logica de segunda llamada condicional — evidencia: leido en lineas 280-302
- [x] bun run tsc --noEmit — 0 errores nuevos en los 3 archivos del fix — evidencia: `bun run tsc --noEmit 2>&1 | grep -E "^src/types/pipeline\.ts|^src/ipc/handlerLogic\.ts|^src/renderer/app\.ts"` produce salida vacia (cero errores en esos archivos). Los errores existentes son preexistentes en node_modules, scripts/ y otros src/db/.
- [x] Sin logica de negocio rota — la cadena completa es correcta: PipelineRecord.templateId (DB) -> GetPipelineResult.templateId (tipo) -> handleGetPipeline retorno (handler) -> app.ts condicional (renderer). Evidencia: verificacion linea a linea de los tres archivos.

## IPC
- [x] Fire-and-forget no aplica — este fix no toca spawns de subprocesos
- [x] Strings IPC son ASCII puro — `templateId` es UUID alfanumerico generado por `randomUUID()`, sin chars > 0x7E — evidencia: confirmado por revision de src/db/agentRepository.ts:1-10 (randomUUID)
- [x] Inputs validados antes de filesystem ops — `handleGetPipeline` en linea 386 valida `params?.pipelineId?.trim()` antes de consulta DB; `handleGetPipelineTemplate` en linea 558 valida `params?.templateId?.trim()` — evidencia: handlerLogic.ts:386 y handlerLogic.ts:558

## RENDERER
- [x] User input no usa innerHTML — `app.ts` no introduce innerHTML nuevo en el bloque modificado (lineas 285-302) — evidencia: bloque leido completo, solo asignaciones a variables locales y llamadas RPC
- [x] Estados de error manejados — `templateResult.template?.variables ?? []` cubre template no encontrado; el bloque try/catch cubre fallo de red IPC — evidencia: app.ts:292 (`??`) y app.ts:300 (catch)

### Criterios de aceptacion del bug (verificacion estatica)

1. Pipelines con templateId hacen segunda llamada a `getPipelineTemplate` — VERIFICADO: app.ts:290-292, condicional `if (result.pipeline.templateId)` seguido de `rpc.request.getPipelineTemplate({ templateId: result.pipeline.templateId })`
2. Pipelines sin template (templateId null) no muestran modal (variables = []) — VERIFICADO: app.ts:288, `variables = []` por defecto; el condicional no se ejecuta cuando templateId es null o undefined
3. `templateId` fluye correctamente desde el tipo hasta la llamada en app.ts — VERIFICADO: cadena completa `GetPipelineResult.templateId (types:116)` → `handleGetPipeline retorno (handlerLogic:396)` → `result.pipeline.templateId (app.ts:290)` → `getPipelineTemplate({ templateId }) (app.ts:291)`
4. TSC limpio en los 3 archivos — VERIFICADO: cero lineas de output de tsc para estos 3 archivos
5. `getPipelineTemplate` registrado en AppRPC y en handlers.ts — VERIFICADO: src/types/ipc.ts:508 y src/ipc/handlers.ts:257

### No verificado por Max
- Verificacion en runtime del modal visual: sin entorno Electrobun disponible. La logica se verifica estaticamente.
- Sustitucion de placeholders post-modal: el flujo de ExecutePipelineParams con variables rellenas no se puede ejecutar sin runtime.

Confianza en la verificacion: alta

---

## Metricas de Max (verificacion final)
- archivos_leidos: 7
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 0
- items_checklist_verificados: 8/8
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 2

QA aprobado con gaps conocidos: verificacion en runtime no disponible (entorno Electrobun), sustitucion de placeholders post-modal no verificable sin runtime.
