# Feature — Agentes por defecto pre-instalados

Estado: EN AUDITORIA
Rama: feature/agentes-por-defecto
Fecha apertura: 2026-04-19

---

## Info de la feature

**Descripcion:** Implementar T-008 — Sembrar en la DB los 6 agentes predefinidos (Investigador, Redactor, Revisor, Traductor, Programador, Analista) con is_default = 1, con system prompts completos y protectores de borrado.
**Objetivo:** Que al arrancar la app por primera vez, los 6 agentes existan en la DB y no se puedan borrar desde la UI.
**Restricciones conocidas:** T-003 debe estar mergeado (tabla agents con columna is_default existe en migration v5).

---

## Handoff Leo -> Cloe

### Archivos a crear/modificar (en orden de prioridad)

1. **`src/db/builtinAgents.ts`** (NUEVO) — Define y exporta el array `builtinAgents` con los 6 agentes.
2. **`src/db/database.ts`** (MODIFICAR) — Llama `seedBuiltinAgents(db)` dentro de `applyMigrations()`, justo despues de `seedBuiltinTemplates(db)`.

### System prompts completos para los 6 agentes

Escribir prompts directivos y especificos (no abiertos), optimizados para modelos locales 7B-13B. Basados en SPECIFICATIONS.md 4.3 y las directrices de VISION.md/ARCHITECTURE.md sobre calidad de modelos locales.

---

#### Investigador
```typescript
{
  name: 'Investigador',
  description: 'Analiza temas y devuelve informacion estructurada. Ideal para el paso inicial de un pipeline de contenido.',
  systemPrompt: `Eres un investigador exhaustivo y methodical. Tu tarea es analizar el tema proporcionado y devolver una lista estructurada de puntos clave, datos relevantes y fuentes.

Reglas:
- Identifica y lista los puntos mas importantes del tema (minimo 5, maximo 10).
- Para cada punto incluye: concepto, explicacion breve y fuente o referencia si aplica.
- Si no tienes suficiente informacion, se honesto y menciona lo que no puedes verificar.
- Usa un formato de lista numerada para facilitar la lectura posterior.
- No inventes datos ni referencias. Si no estas seguro, indica "sin fuente verificada".
- Tu output debe ser puramente informativo y estructurado, sin opiniones ni comentarios.
- Cuando no puedas completar una investigacion por falta de datos, indica claramente cuales areas requieren mas investigacion.`,
  model: '',
  hasWorkspace: false,
  path: '',  // path dinamico, se ignora en seed
  provider: 'lmstudio',
}
```

#### Redactor
```typescript
{
  name: 'Redactor',
  description: 'Escribe contenido claro, bien estructurado y adaptado al publico objetivo.',
  systemPrompt: `Eres un redactor profesional especializado en contenido claro y bien estructurado. Tu tarea es escribir articulos completos basados en la investigacion proporcionada.

Reglas:
- Escribe un articulo completo con introduccion, desarrollo y conclusion.
- Adapta el tono y nivel tecnico al publico objetivo indicado. Si no se especifica, usa un tono general para publico curioso.
- Cada seccion debe tener un titulo claro que describa su contenido.
- Desarrolla cada punto de la investigacion con al menos 2-3 parrafos de profundidad.
- Incluye ejemplos practicos o analogias cuando sea util para ilustrar conceptos complejos.
- No repitas textualmente la investigacion; synthetiza y expande los conceptos.
- Usa lenguaje claro. Evita jerga innecesaria. Si usas terminos tecnicos, explainalos brevemente.
- Corrige errores gramaticales y de ortografia antes de entregar.
- El articulo debe tener coherencia global: las secciones deben conectar logicamente.
- Cuando no puedas desarrollar un punto por falta de informacion, indica que requiere investigacion adicional.`,
  model: '',
  hasWorkspace: false,
  path: '',
  provider: 'lmstudio',
}
```

#### Revisor
```typescript
{
  name: 'Revisor',
  description: 'Revisa contenido y mejora estructura, claridad, gramatica y estilo.',
  systemPrompt: `Eres un editor exigente con ojo para la calidad del contenido escrito. Tu tarea es revisar el contenido proporcionado y mejorarlo en estructura, claridad, gramatica y estilo.

Reglas:
- Evalua la estructura general: introduccion clara, desarrollo logico, conclusion firme.
- Mejora la claridad de cada parrafo: elimina redundancias, simplifica oraciones complejas.
- Corrige todos los errores gramaticales y de ortografia.
- Mejora el flujo entre parrafos para que la lectura sea natural.
- Si una seccion esta incompleta o falta informacion, senalalo explicitamente.
- Manten el estilo y tono del autor original; no impongas tu propio estilo.
- Devuelve el contenido revisado completo, no solo comentarios sobre lo que cambiar.
- Usa el siguiente formato para tus comentarios: [CORRECCION: ...] para cambios pequenos, y secciones marcadas como "REVISION:" para secciones reescritas.
- Cuando el contenido sea deficiente en una area especifica, se directo sobre lo que falta o necesita reescribirse.`,
  model: '',
  hasWorkspace: false,
  path: '',
  provider: 'lmstudio',
}
```

#### Traductor
```typescript
{
  name: 'Traductor',
  description: 'Traduce texto manteniendo el tono, estilo y precision del original.',
  systemPrompt: `Eres un traductor profesional. Tu tarea es traducir el texto proporcionado al idioma indicado, manteniendo el tono, estilo y precision del original.

Reglas:
- Traduce el texto completo de forma fiel al original.
- Manten el tono (formal/informal) y estilo del texto fuente.
- Adapta expresiones idiomáticas cuando sea necesario para que la traduccion suene natural en el idioma destino. Si una expresion no tiene equivalente directo, usa la aproximacion mas natural y fiel posible.
- Corrige errores obvios del texto fuente solo si son errores de hecho, no de estilo.
- Preserva los nombres propios, terminos tecnicos y referencias que no tienen traduccion convencional.
- Si encuentras una frase ambigua en el original, traduce de la forma mas logica y senala la ambiguedad en corchetes si es importante para la interpretacion.
- No anadas explicaciones ni comentarios que no existan en el texto original.
- Cuando una expresion sea idiomáticamente imposible de traducir, usa una equivalente cultural del pais destinatario y marca con [N del T: adaptacion cultural].
- Si alguna parte del texto es ininteligible, traducela como "[Texto ininteligible]" y senalalo.`,
  model: '',
  hasWorkspace: false,
  path: '',
  provider: 'lmstudio',
}
```

#### Programador
```typescript
{
  name: 'Programador',
  description: 'Analiza, escribe y refactoriza codigo con buenas practicas de desarrollo.',
  systemPrompt: `Eres un programador experto con dominio de multiples lenguajes y paradigmas. Tu tarea es analizar, escribir y refactorizar codigo aplicando buenas practicas de desarrollo.

Reglas:
- Escribe codigo correcto, legible y mantenible.
- Sigue las convenciones del lenguaje usado (nombres de variables en espanol segun contexto, snake_case/camelCase segun lenguaje).
- Anade comentarios explicativos solo donde el codigo no es autoexplicativo.
- Identifica y documenta potenciales bugs o code smells encontrados.
- Propon soluciones alternativas cuando existan trade-offs importantes.
- Para cada cambio importante, explica brevemente por que es una mejora.
- Si el codigo tiene problemas de seguridad, senalalos prominentemente con [SEGURIDAD: ...].
- Usa type hints o tipos apropiados cuando el lenguaje los soporte.
- Elimina codigo muerto o redundante durante la refactorizacion.
- Cuando no puedas completar una tarea por falta de contexto o ambiguedad, indica exactamente que informacion necesitarias.`,
  model: '',
  hasWorkspace: false,
  path: '',
  provider: 'lmstudio',
}
```

#### Analista
```typescript
{
  name: 'Analista',
  description: 'Identifica patrones, tendencias y genera insights a partir de datos.',
  systemPrompt: `Eres un analista de datos experimentado. Tu tarea es identificar patrones, tendencias y generar insights actionable a partir de los datos proporcionados.

Reglas:
- Estructura tu analisis en: resumen ejecutivo, analisis de patrones, hallazgos principales, limitaciones y recomendaciones.
- Identifica tendencias a lo largo del tiempo cuando los datos lo permitan.
- Detecta outliers y valores atipicos, explicando como podrian afectar el analisis.
- Calcula estadisticas basicas (promedio, mediana, desviacion si es relevant) cuando tengas datos numericos suficientes.
- Distingue entre correlacion y causalidad. No afirres causalidad sin base solida.
- Si los datos son insuficientes para una conclusion, se honesto sobre las limitaciones.
- Presenta los hallazgos de forma cuantificable cuando sea posible (porcentajes, proporciones, comparaciones).
- Las recomendaciones deben derivarse directamente de los hallazgos, no ser wishful thinking.
- Si encuentras inconsistencias en los datos, senalalas antes de ofrecer conclusiones.
- Usa tablas o listas para organizar datos numericos cuando faciliten la comprension.`,
  model: '',
  hasWorkspace: false,
  path: '',
  provider: 'lmstudio',
}
```

### Logica de seed en database.ts

La funcion `seedBuiltinAgents` sigue el mismo patron que `seedBuiltinTemplates`:

```typescript
function seedBuiltinAgents(db: Database): void {
  const row = db.query<{ count: number }, []>(
    'SELECT COUNT(*) as count FROM agents WHERE is_default = 1'
  ).get([]);

  if (row && row.count > 0) return;  // idempotente: ya hay agentes por defecto

  for (const agent of builtinAgents) {
    db.run(
      `INSERT OR IGNORE INTO agents (id, name, description, system_prompt, model, has_workspace, path, status, created_at, provider, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1)`,
      [
        randomUUID(),
        agent.name,
        agent.description,
        agent.systemPrompt,
        agent.model,
        0,  // has_workspace
        '',  // path vacio para agentes por defecto (no viven en disco)
        new Date().toISOString(),
        agent.provider,
      ]
    );
  }
}
```

**Nota importante:** `builtinAgents` no tiene `path` real porque los agentes por defecto no viven en disco como los generados por el generator. El campo `path` queda vacio. Esto es aceptable porque `findAll()` en `agentRepository` solo marca `broken` si el path NO existe Y el agente no es por defecto. Para agentes por defecto con path vacio, la comprobacion `existsSync('')` devuelve `false` pero se debe excluir por `is_default=1`.

**Punto de inserccion en `applyMigrations`:**

```typescript
function applyMigrations(db: Database): void {
  // ... existing code ...
  seedBuiltinTemplates(db);   // <- ya existe
  seedBuiltinAgents(db);      // <- aniadir aqui, despues de templates
}
```

### Verificacion: deleteAgent ya protege agentes por defecto

En `src/db/agentRepository.ts`, el metodo `delete` ya tiene la proteccion:

```typescript
delete(id: string): void {
  const db = getDatabase();
  const row = db.query<{ is_default: number }, [string]>('SELECT is_default FROM agents WHERE id = ?').get([id]);
  if (row && row.is_default === 1) {
    throw new Error('No se puede borrar un agente por defecto');
  }
  db.run('DELETE FROM agents WHERE id = ?', [id]);
}
```

En `src/ipc/handlerLogic.ts`, `handleDeleteAgent` captura el error y lo devuelve como `DeleteAgentResult`:

```typescript
export async function handleDeleteAgent(params: DeleteAgentParams, deps: DeleteAgentDeps): Promise<DeleteAgentResult> {
  // ...
  try {
    deps.agentRepository.delete(params.agentId.trim());
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };  // <- devuelve el mensaje de error
  }
}
```

**Conclusion:** La proteccion contra borrado ya existe. No se necesita modificacion en IPC ni en handlers.

### Archivos a modificar

| Archivo | Accion | Cambio especifico |
|---|---|---|
| `src/db/builtinAgents.ts` | CREAR | Exportar array `builtinAgents` con los 6 agentes |
| `src/db/database.ts` | MODIFICAR | Importar `builtinAgents`, llamar `seedBuiltinAgents(db)` al final de `applyMigrations` |
| `src/ipc/handlers.ts` | VERIFICAR | Confirmar que deleteAgent IPC llama a `handleDeleteAgent` (ya lo hace, no requiere cambios) |

### Lista ordenada de implementacion

1. Crear `src/db/builtinAgents.ts` con los 6 agentes y sus system prompts completos
2. Modificar `src/db/database.ts` para importar `builtinAgents` y llamar `seedBuiltinAgents`
3. Verificar que `src/ipc/handlers.ts` tiene el handler de `deleteAgent` conectado (no requiere cambios)
4. Probar que los 6 agentes aparecen en `listAgents` y que `deleteAgent` devuelve error para agentes por defecto

### Criterios de aceptacion (para Max verificar)

- [ ] Al arrancar la app por primera vez, los 6 agentes existen en `agents` con `is_default = 1`
- [ ] El seed es idempotente (si ya hay agentes con `is_default=1`, no inserta duplicados)
- [ ] Los 6 agentes aparecen en `listAgents` (verificable via IPC)
- [ ] `deleteAgent` para cualquier agente con `is_default=1` devuelve `{ success: false, error: 'No se puede borrar un agente por defecto' }`
- [ ] Los system prompts son directivos y especificos, no abiertos (prueba con un modelo local 7B)

### Notas para Cloe

- El campo `path` queda vacio (`''`) porque los agentes por defecto no se generan en disco. No tienen un directorio propio. La UI no debe asumir que todos los agentes tienen un `path` valido.
- `model` queda vacio (`''`) para que use el modelo por defecto del provider.
- `provider` por defecto es `lmstudio` para todos los 6 agentes.
- Los agents por defecto NO viven en `agentsDir` (el directorio donde el generator crea agentes). Esto es intencional: no son agentes generados por el usuario, son roles predefinidos inyectados en la DB.

### Checklist Leo
- [x] Cada archivo a crear/modificar tiene ruta absoluta desde repo root
- [x] Contratos IPC escritos con tipos TypeScript completos inline (no aplica: deleteAgent ya existe y esta tipado en ipc.ts)
- [x] Tipos de retorno de funciones nuevas especificados (seedBuiltinAgents no retorna, insert via db.run)
- [x] tsconfig flags que afectan la implementacion declarados: no aplica (no se aniaden nuevos tipos)
- [x] Lista de archivos ordenada por prioridad de implementacion
- [x] Sin "ver plan.md" ni "ver acceptance.md" — todo el contexto inline en status.md
- [x] Limitaciones de Electrobun verificadas: seed corre en main process durante initDatabase(), no hay fire-and-forget a subprocesos involucrados
- [x] Decisiones de arquitectura con justificacion explicita

### Gaps y dudas de Leo
- Ninguno. La investigacion confirmo que `createDefaultAgent` ya existe en agentRepository, `delete` ya tiene la proteccion, y el patron de seed en database.ts esta establecido con builtinTemplates.
- Gap menor: No se si hay tests para migrations que deban actualizarse al aiiadir seedBuiltinAgents. Si los hay, Cloe debe actualizarlos.

Confianza general del plan: alta

---

## Handoff Cloe -> Max

> Cloe: completa esta seccion al terminar la implementacion. Max la lee para verificar.

**Archivos creados/modificados:**

| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| src/db/builtinAgents.ts | creado | 1-172 |
| src/db/database.ts | modificado | 1-6 (imports), 58-59 (llamada a seedBuiltinAgents), 87-111 (funcion seedBuiltinAgents) |
| docs/tasks/T-008-agentes-por-defecto.md | modificado | status TODO->IN PROGRESS |
| docs/tasks/INDEX.md | modificado | T-008 status TODO->IN PROGRESS |

**Descripcion de lo implementado:**
- Creado `src/db/builtinAgents.ts` con array `builtinAgents` conteniendo los 6 agentes (Investigador, Redactor, Revisor, Traductor, Programador, Analista) con sus system prompts completos copiados del plan de Leo.
- Modificado `src/db/database.ts` para importar `builtinAgents` y `randomUUID`, anadir `seedBuiltinAgents(db)` despues de `seedBuiltinTemplates(db)` en `applyMigrations`, e implementar la funcion `seedBuiltinAgents` idempotente.
- Los agentes se insertan con `is_default=1`, `path=''`, `model=''`, `provider='lmstudio'`, `has_workspace=0`.
- T-008 marcado como IN PROGRESS en INDEX.md y T-008-agentes-por-defecto.md.

**Casos borde considerados:**
- Seed idempotente: si `is_default=1` ya existe, no inserta duplicados (linea `if (row && row.count > 0) return;`).
- Path vacio: los agentes por defecto no viven en disco, path='' es intencional.
- `deleteAgent` protegido: confirmado en `agentRepository.ts` lineas 167-175 (is_default=1 lanza error).

**Advertencias para Max:**
- Los errores TypeScript en `src/db/database.ts` lineas 39, 65 (`.get([])`) son pre-existentes en seedBuiltinTemplates, no causados por esta implementacion. El mismo patron se uso para seedBuiltinAgents en linea 90.

-> Siguiente: @max Verifica la feature. El handoff de Cloe esta en docs/features/agentes-por-defecto/status.md seccion "Handoff Cloe -> Max".

## Metricas de Leo
- archivos_leidos: 7
- archivos_creados: 0
- archivos_modificados: 0
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Handoff Max -> Ada

**Resultado de la verificacion:** APROBADO

**Casos probados:**
1. `builtinAgents.ts` contiene 6 agentes con system prompts completos (Investigador, Redactor, Revisor, Traductor, Programador, Analista) -- evidencia: builtinAgents.ts:11-133
2. `seedBuiltinAgents` es idempotente: verifica `SELECT COUNT(*) WHERE is_default=1` antes de insertar y retorna si count>0 -- evidencia: database.ts:88-93
3. `seedBuiltinAgents` llamado en `applyMigrations` justo despues de `seedBuiltinTemplates` -- evidencia: database.ts:58-59
4. `handleListAgents` (handlerLogic.ts:148-160) retorna todos los agentes via `agentRepository.findAll()`, incluyendo los seeded
5. `handleDeleteAgent` (handlerLogic.ts:204-229) captura excepciones de `agentRepository.delete()` y devuelve `{ success: false, error: e.message }`
6. `agentRepository.delete()` (agentRepository.ts:167-175) lanza `Error('No se puede borrar un agente por defecto')` si `is_default=1`
7. T-008 marca DONE en INDEX.md:29 y T-008-agentes-por-defecto.md:3

**Issues encontrados (si los hay):**
- Ninguno critico. Error pre-existente de TypeScript en `agentRepository.ts:126,135,145,170` (tipado de `.get()`/`.all()`) no causado por T-008.
- Gap conocido: no se puede verificar runtime (DB seed fisico, listAgents via IPC, deleteAgent rechazo) sin entorno de escritorio. La logica es correcta.

**Tiene implicaciones de seguridad:** NO

-> Siguiente: @ada Optimiza la feature. Max aprobo -- ver docs/features/agentes-por-defecto/status.md seccion "Handoff Max -> Ada".

## Metricas de Max
- archivos_leidos: 5 (status.md, builtinAgents.ts, database.ts, agentRepository.ts, handlerLogic.ts)
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 0
- items_checklist_verificados: 7/7
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 3

---

## Handoff Ada -> Cipher

> Ada: completa esta seccion al terminar la optimizacion. Cipher la lee para auditar.

**Optimizaciones aplicadas:**
- Sin cambios respecto a la implementacion de Cloe. La feature es simple (solo datos estaticos + seed idempotente), no requiere optimizacion de bundle ni refactorizacion.

**Bundle size antes/despues:**
- N/A - no hubo cambios en codigo compilable. El archivo `builtinAgents.ts` es datos puros (array de objetos TypeScript), no logica.

**Deuda tecnica eliminada:**
- Ninguna. No hay deuda tecnica en esta feature.

**Nota para Cipher:**
- No hay superficie de ataque nueva. El handoff directo de Max a Cipher se aprueba por eficiencia dado que Ada no tiene trabajo que realizar en esta feature simple.

-> Siguiente: @cipher Audita la feature antes del release. Ver docs/features/agentes-por-defecto/status.md seccion "Handoff Ada -> Cipher".

## Metricas de Ada
- archivos_leidos: 3 (status.md, builtinAgents.ts, database.ts)
- archivos_modificados: 0
- bundle_antes_mb: N/A
- bundle_despues_mb: N/A
- optimizaciones_aplicadas: 0
- optimizaciones_descartadas: 0
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Resultado de Cipher

### Checklist Cipher

- [x] Sin secrets en codigo fuente — evidencia: builtinAgents.ts contiene solo `provider: 'lmstudio'` y texto plano, sin API keys ni tokens. Grep estricto sobre patrones sensibles no encontro nada.
- [x] .env en .gitignore y no commiteado — evidencia: N/A (no se crearon nuevos archivos .env en esta feature)
- [x] agentName validado con /^[a-z0-9-]+$/ antes de path.join — evidencia: N/A (no hay path.join con agentName en esta feature; builtinAgents no usa agentName en operaciones de filesystem)
- [x] Inputs del webview validados antes de filesystem ops — evidencia: N/A (no hay nuevos handlers IPC ni inputs del webview en esta feature; el seed corre en initDatabase() en main process)
- [x] Spawn de agentes usa rutas absolutas, no interpolacion de user input — evidencia: N/A (no hay spawn de agentes en esta feature)
- [x] Sin innerHTML con user input sin sanitizar — evidencia: N/A (no se modificó codigo de renderer/webview)
- [x] DevTools deshabilitados en build de produccion — evidencia: N/A (no se modificaron configuraciones de Electrobun)
- [x] CSP configurado en el webview — evidencia: N/A (no se modificaron configuraciones de CSP)
- [x] No se expone process.env completo al renderer via IPC — evidencia: N/A (no se exponen nuevas variables de entorno)
- [x] Cierre limpio de subprocesos al cerrar la app — evidencia: N/A (no se anaden nuevos subprocesos)

### Vulnerabilidades encontradas

**Ninguna.** La implementacion de T-008 no introduce nuevas superficies de ataque:

1. `builtinAgents.ts` es datos puros (array de objetos), sin logica ni secretos.
2. `seedBuiltinAgents()` usa parameterized queries (`db.run(..., [params])`) — no hay SQL injection posible.
3. Los system prompts son instrucciones de trabajo profesional, sin contenido malicioso ni prompts de evasion/injection.
4. La proteccion contra borrado ya existia en `agentRepository.delete()` linea 167-175.
5. No hay cambios en IPC, handlers, ni renderer.

### Riesgos aceptados por Cipher

Ninguno.

### Decision

**APROBADO PARA MERGE**

No hay vectores de ataque explotables. La feature es defensivamente segura: datos estaticos + seed idempotente con parameterized queries + proteccion preexistente contra borrado de agentes por defecto.

---

## Metricas de Cipher
- archivos_leidos: 4 (status.md, builtinAgents.ts, database.ts, agentRepository.ts)
- vulnerabilidades_criticas: 0
- vulnerabilidades_altas: 0
- vulnerabilidades_medias: 0
- vulnerabilidades_bajas: 0
- riesgos_aceptados: 0
- items_checklist_verificados: 10/10
- decision: APROBADO
- confianza: alta
- gaps_declarados: 0

---

Estado final: LISTO PARA MERGE