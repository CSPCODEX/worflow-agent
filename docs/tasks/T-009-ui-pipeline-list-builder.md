# T-009 — UI — Pipeline list y pipeline builder

**Status:** TODO
**Phase:** Fase 1
**Agente responsable:** Cloe
**Depende de:** T-006, T-007
**Esfuerzo estimado:** 6 días

## Descripción

Implementar las vistas de lista de pipelines y el editor de pipelines (builder). El usuario debe poder listar, crear, editar y eliminar pipelines con sus pasos desde la UI, incluyendo selección desde template.

## Solución técnica

Crear en `src/renderer/views/`:

**`pipeline-list.ts`** — Vista principal de pipelines
- Lista los pipelines existentes (llamada a `listPipelines` IPC)
- Cada item muestra: nombre, descripción, nº de pasos, última ejecución
- Botón "Nuevo pipeline" → abre builder vacío
- Click en pipeline → abre detalle (pipeline-builder en modo edición o vista)
- Botón "Ejecutar" en cada item → navega a T-010

**`pipeline-builder.ts`** — Editor de pipeline
- Modo creación y modo edición
- Paso 1: selección de template (modal) o empezar vacío
- Formulario: nombre (input), descripción (textarea)
- Lista de pasos editable:
  - Cada paso: nombre (input), selector de agente (dropdown con `listAgents`), input template (textarea)
  - Botones: subir, bajar, eliminar paso
  - Botón "Añadir paso"
- Botones: Cancelar, Guardar
- Al guardar: `createPipeline` o `updatePipeline` según modo

**`pipeline-template-selector.ts`** — Modal de selección de template
- Llama a `listPipelineTemplates` IPC
- Muestra cards con nombre, descripción, categoría, etiqueta de modelo recomendado
- Click → carga el template en el builder

Actualizar `src/renderer/app.ts`:
- Sidebar izquierdo: sección "Pipelines" con lista y botón nuevo
- Sección "Agentes" existente se mantiene
- Routing entre vistas

## Criterios de aceptación

- [ ] La lista de pipelines se muestra al abrir la sección "Pipelines"
- [ ] "Nuevo pipeline" → modal de selección de template → builder pre-llenado
- [ ] "Nuevo pipeline" → "Desde cero" → builder vacío
- [ ] El builder permite añadir, reordenar (botones arriba/abajo) y eliminar pasos
- [ ] El selector de agente muestra todos los agentes disponibles
- [ ] Guardar un pipeline nuevo llama a `createPipeline` y lo muestra en la lista
- [ ] Editar un pipeline existente llama a `updatePipeline` con los cambios
- [ ] Eliminar un pipeline muestra confirmación antes de llamar a `deletePipeline`
- [ ] El template selector muestra la etiqueta de modelo recomendado por template

## Subtareas

- [ ] Crear `src/renderer/views/pipeline-template-selector.ts` (modal)
- [ ] Crear `src/renderer/views/pipeline-builder.ts` (editor completo)
- [ ] Crear `src/renderer/views/pipeline-list.ts` (lista con acciones)
- [ ] Actualizar `src/renderer/app.ts` con routing y nueva sección en sidebar
- [ ] Actualizar `src/renderer/style.css` con estilos para las nuevas vistas
- [ ] Probar flujo completo: crear pipeline desde template → guardar → ver en lista

## Notas

- El renderer usa TypeScript vanilla sin framework (ver ARCHITECTURE.md Decision 5). No añadir React ni Vue.
- El drag-and-drop de reordenación de pasos queda para V1 (ROADMAP 2.3). En MVP: botones arriba/abajo.
- El input template de cada paso debe mostrar un hint con las variables disponibles (ej: `{{tema}}`, `{{output_paso_1}}`).
