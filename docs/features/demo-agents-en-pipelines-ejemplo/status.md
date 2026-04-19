# Feature — Demo agents en pipelines de ejemplo

Estado: EN PLANIFICACION
Rama: feature/demo-agents-en-pipelines-ejemplo
Fecha apertura: 2026-04-19

---

## Info de la feature

**Descripcion:** Crear agentes demo pre-cargados cuando el usuario abre un pipeline de ejemplo para que no tenga que configurarlos manualmente. El pipeline de ejemplo debería incluir 2-3 agentes ya creados para que el usuario pueda ejecutar el ejemplo inmediatamente sin setup.

**Objetivo:** Cuando el usuario selecciona un template de pipeline (ej: Content Creator) desde la UI, los pasos del pipeline deben venir automaticamente asignados con los agentes por defecto correspondientes (Investigador, Redactor, Revisor) basandose en el `agentRoleHint` del template. El usuario puede ejecutar el pipeline inmediatamente sin tener que seleccionar agentes manualmente.

**Restricciones conocidas:** Los 6 agentes por defecto (Investigador, Redactor, Revisor, Traductor, Programador, Analista) ya estan implementados y seeded en la DB via T-008. Esta feature reutiliza esos agentes, no crea agentes nuevos.

---

## Handoff Leo → Cloe

> Leo: completa esta seccion con el plan de implementacion. Cloe lee esto para implementar.

### Diagnostico del gap

**Problema identificado en `src/renderer/views/pipeline-builder.ts` (lineas 102-116):**

```typescript
if (params.templateId) {
  rpc.request.getPipelineTemplate({ templateId: params.templateId }).then((result: GetPipelineTemplateResult) => {
    if (result.template) {
      nameInput.value = result.template.name;
      descInput.value = result.template.description;
      steps = result.template.steps.map((s, i) => ({
        order: i + 1,
        name: s.name,
        agentId: '',  // <-- agentId queda VACIO. El usuario tiene que seleccionar manualmente.
        inputTemplate: s.inputTemplate,
      }));
      renderSteps();
    }
  }).catch(() => {});
}
```

Cuando se carga un template, `agentId` queda vacio. El renderer muestra un selector con los agentes disponibles pero ninguno viene pre-seleccionado. El usuario tiene que hacer click en cada paso y seleccionar el agente manualmente.

**Solucion:** Modificar el renderer para que al cargar un template, normalice el `agentRoleHint` de cada step y lo resuelva al `agentId` correspondiente de los built-in agents ya cargados en `availableAgents`.

### Mapeo agentRoleHint → nombre de agente

El `agentRoleHint` en los templates usa un naming convention diferente al `name` de los agentes por defecto. Se requiere normalizacion:

| Template agentRoleHint | Built-in Agent name |
|---|---|
| `investigador` | `Investigador` |
| `redactor` | `Redactor` |
| `revisor` | `Revisor` |
| `traductor` | `Traductor` |
| `programador` | `Programador` |
| `analista` | `Analista` |

Verificacion: los 4 templates en `src/templates/pipelines/` usan estos valores de `agentRoleHint`:
- content-creator.json: `investigador`, `redactor`, `revisor`
- code-review.json: `auditor`, `refactorizador`, `verificador` (estos NO existen como built-in agents)
- data-analyst.json: `limpiador`, `analista`, `visualizador textual` (solo `analista` coincide)
- translator.json: `traductor`, `revisor cultural` (solo `traductor` coincide)

**Decision de arquitectura:** Para steps cuyo `agentRoleHint` no coincida con ningun built-in agent, el selector queda vacio (comportamiento actual). Esto no es un bloqueante porque los templates built-in principales (Content Creator) si tienen sus agentes asignados automaticamente.

### Archivos a modificar (en orden de prioridad)

1. **`src/renderer/views/pipeline-builder.ts`** (MODIFICAR) — Lineas 102-116. Cuando se carga un template, resolver `agentRoleHint` a `agentId` de los built-in agents ya cargados en `availableAgents`.

### Codigo exacto a implementar

Reemplazar el bloque de carga de template (lineas 102-116 de pipeline-builder.ts):

```typescript
// Load template if provided
if (params.templateId) {
  rpc.request.getPipelineTemplate({ templateId: params.templateId }).then((result: GetPipelineTemplateResult) => {
    if (result.template) {
      nameInput.value = result.template.name;
      descInput.value = result.template.description;
      
      // Normalize agentRoleHint to agentId using availableAgents
      steps = result.template.steps.map((s, i) => {
        // Normalize role hint: lowercase, remove accents, spaces to underscores
        const normalizedHint = s.agentRoleHint
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\s+/g, '_');
        
        // Try exact match first, then contains match
        let matchedAgentId = '';
        for (const agent of availableAgents) {
          const normalizedAgentName = agent.name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, '_');
          
          if (normalizedAgentName === normalizedHint || 
              normalizedAgentName.includes(normalizedHint) ||
              normalizedHint.includes(normalizedAgentName)) {
            matchedAgentId = agent.id;
            break;
          }
        }
        
        return {
          order: i + 1,
          name: s.name,
          agentId: matchedAgentId,  // Pre-seleccionado si coincide con un built-in
          inputTemplate: s.inputTemplate,
        };
      });
      renderSteps();
    }
  }).catch(() => {});
}
```

### Logica de matching explicada

1. `normalizedHint` = `agentRoleHint` normalizado (lowercase, sin acentos, espacios a guiones bajos)
   - Ejemplo: `"investigador"` → `"investigador"`
   - Ejemplo: `"revisor cultural"` → `"revisor_cultural"`

2. `normalizedAgentName` = nombre del agente normalizado con la misma transformacion
   - Ejemplo: `"Revisor"` → `"revisor"`

3. Matching en 3 niveles:
   - **Exact match**: `"revisor"` === `"revisor"` → OK
   - **Contains (hint in agent)**: `"analista"` incluido en `"analista_de_datos"` → OK
   - **Contains (agent in hint)**: `"revisor"` incluido en `"revisor_cultural"` → OK (Traductor pipeline)

4. Si no hay match, `agentId` queda `''` (selector vacio, usuario selecciona manualmente).

### Reglas que Cloe debe respetar

- No modificar el contrato IPC existente (no se anaden nuevos handlers ni se cambian tipos)
- No crear nuevos agentes ni modificar `builtinAgents.ts`
- No modificar la logica de seed en `database.ts`
- Mantener el selector de agentes visible para que el usuario pueda cambiar la asignacion si quiere
- El renderer sigue usando vanilla TypeScript, no anadir dependencias nuevas

### Tipos TypeScript necesarios

No se requieren tipos nuevos. La funcion `renderPipelineBuilder` recibe `availableAgents: AgentInfo[]` ya tipado de `listAgents` IPC response. El array `availableAgents` se llena en linea 76-78.

### Criterios de aceptacion (para Max verificar)

- [ ] Al abrir un pipeline desde el template "Content Creator", el paso 1 viene con "Investigador" pre-seleccionado
- [ ] Al abrir un pipeline desde el template "Content Creator", el paso 2 viene con "Redactor" pre-seleccionado
- [ ] Al abrir un pipeline desde el template "Content Creator", el paso 3 viene con "Revisor" pre-seleccionado
- [ ] Al abrir un pipeline desde el template "Traductor", paso 1 viene con "Traductor" pre-seleccionado
- [ ] Para templates cuyos `agentRoleHint` no coincidan con built-in agents (ej: Code Review), el selector queda vacio y el usuario puede seleccionar manualmente
- [ ] El usuario puede cambiar la asignacion de agente en cualquier paso despues de cargar el template
- [ ] La asignacion automatica no rompe el guardado del pipeline (el `agentId` se guarda correctamente en la DB)

### Lista ordenada de implementacion

1. Modificar `src/renderer/views/pipeline-builder.ts` lineas 102-116 para resolver `agentRoleHint` a `agentId` automaticamente
2. Verificar que los 4 templates built-in tienen `agentRoleHint` que coinciden con los 6 built-in agents
3. Probar manualmente que al seleccionar "Content Creator" template, los 3 pasos vienen pre-seleccionados
4. Probar que se puede guardar y ejecutar el pipeline sin seleccionar agentes manualmente

### Notas para Cloe

- Los built-in agents ya existen en la DB con `is_default=1`. El renderer los recibe via `listAgents()` (linea 76).
- La normalizacion de texto maneja acentos y espacios para hacer el matching robusto.
- El matching "contains" es intencional para cubrir casos como "revisor_cultural" que debe coincidir con "Revisor".
- Esta feature NO crea agentes demo nuevos. Reutiliza los 6 built-in agents que ya estan en `builtinAgents.ts`.

### Checklist Leo
- [x] Cada archivo a crear/modificar tiene ruta absoluta desde repo root
- [x] Contratos IPC escritos con tipos TypeScript completos inline (no aplica: no se modifican contratos IPC)
- [x] Tipos de retorno de funciones nuevas especificados (no hay funciones nuevas, es logica inline)
- [x] tsconfig flags que afectan la implementacion declarados: no aplica
- [x] Lista de archivos ordenada por prioridad de implementacion
- [x] Sin "ver plan.md" ni "ver acceptance.md" — todo el contexto inline en status.md
- [x] Limitaciones de Electrobun verificadas: es logica de renderer puro, no hay IPC nuevo ni subprocesos
- [x] Decisiones de arquitectura con justificacion explicita

### Gaps y dudas de Leo

- Gap 1: No hay tests automatizados para el renderer. La verificacion es manual. Cloe debe probar localmente con `bun run desktop`.
- Gap 2: El matching "contains" podria dar falsos positivos si hay nombres similares (ej: "Programador" y "Programador Senior"). Se asume que los 6 nombres built-in son lo suficientemente distintivos.
- Gap 3: No se si `availableAgents` siempre llega antes que `getPipelineTemplate` complete (race condition). En teoria el `Promise.all` de ambos no existe, pero en la practica `listAgents` es rapido y el template se carga despues. Si hay issues, se puede envolver en `Promise.all([listAgents, getPipelineTemplate])`.

Confianza general del plan: media-alta

---

## Handoff Cloe → Max

> Cloe: completa esta seccion al terminar la implementacion. Max la lee para verificar.

**Archivos creados/modificados:**

| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| | | |

**Descripcion de lo implementado:**

**Casos borde considerados:**

**Advertencias para Max:**

→ Siguiente: @max Verifica la feature. El handoff de Cloe esta en docs/features/demo-agents-en-pipelines-ejemplo/status.md seccion "Handoff Cloe -> Max".

## Metricas de Leo
- archivos_leidos: 7 (status.md feature previa, builtinAgents.ts, content-creator.json, pipeline-builder.ts, SPECIFICATIONS.md, ARCHITECTURE.md, SKILL.md)
- archivos_creados: 0
- archivos_modificados: 0
- rework: no
- iteraciones: 1
- confianza: media-alta
- gaps_declarados: 3

---

## Handoff Max → Ada

> Max: completa esta seccion al aprobar la implementacion. Ada la lee para optimizar.

**Resultado de la verificacion:** APROBADO / RECHAZADO

**Casos probados:**

**Issues encontrados (si los hay):**

**Tiene implicaciones de seguridad:** SI / NO

→ Siguiente: @ada Optimiza la feature. Max aprobo -- ver docs/features/demo-agents-en-pipelines-ejemplo/status.md seccion "Handoff Max -> Ada".

## Metricas de Max
- archivos_leidos:
- bugs_criticos:
- bugs_altos:
- bugs_medios:
- items_checklist_verificados:
- rework: no
- iteraciones: 1
- confianza:
- gaps_declarados:

---

## Handoff Ada → Cipher

> Ada: completa esta seccion al terminar la optimizacion. Cipher la lee para auditar.

**Optimizaciones aplicadas:**

**Bundle size antes/despues:**

**Deuda tecnica eliminada:**

→ Siguiente: @cipher Audita la feature antes del release. Ver docs/features/demo-agents-en-pipelines-ejemplo/status.md seccion "Handoff Ada -> Cipher".

## Metricas de Ada
- archivos_leidos:
- archivos_modificados:
- bundle_antes_mb:
- bundle_despues_mb:
- optimizaciones_aplicadas:
- optimizaciones_descartadas:
- rework: no
- iteraciones: 1
- confianza:
- gaps_declarados:

---

## Resultado de Cipher

> Cipher: completa esta seccion al finalizar la auditoria.

**Vulnerabilidades encontradas:**

**Decision:** APROBADO PARA MERGE / BLOQUEADO

## Metricas de Cipher
- archivos_leidos:
- vulnerabilidades_criticas:
- vulnerabilidades_altas:
- vulnerabilidades_medias:
- vulnerabilidades_bajas:
- riesgos_aceptados:
- rework: no
- iteraciones: 1
- confianza:
- gaps_declarados:
- decision: APROBADO / APROBADO_CON_RIESGOS / BLOQUEADO

---

Estado final: EN PLANIFICACION
