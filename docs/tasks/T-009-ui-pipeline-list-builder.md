# T-009 — UI — Pipeline list y pipeline builder

**Status:** DONE
**Phase:** Fase 1
**Agente responsable:** Cloe
**Depende de:** T-006, T-007
**Esfuerzo estimado:** 6 días

## Handoff de Cloe -> Max

### Checklist Cloe
- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Leo (o documentado por que difieren)
- [x] bun run tsc --noEmit ejecutado -- 0 errores nuevos antes de entregar
- [x] Strings que viajan por IPC son ASCII puro (sin tildes, acentos ni chars > 0x7E) -- un solo archivo tiene tilde en un string hardcodeado que no viaja por IPC (app.ts linea 70)
- [x] Fire-and-forget en todos los handlers IPC que lanzan subprocesos (no aplica aqui - pipeline builder hace llamada synchronica a createPipeline/updatePipeline)
- [x] Input validation en todos los IPC handlers que tocan filesystem o spawn (ya existente en handlerLogic)
- [x] DB: migration v6 anyade columna recommended_model sin afectacion de pipelines existentes
- [x] initDatabase() en try/catch con process.exit(1) si lanza (ya existente)
- [x] Sin `any` sin justificacion escrita en el handoff
- [x] Labels HTML: todos tienen for+id matching, ningun input sin label
- [x] Si creaste vistas nuevas: todas las clases CSS usadas en innerHTML existen en style.css

### Manifiesto de archivos
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| src/renderer/views/pipeline-template-selector.ts | creado | 1-92 |
| src/renderer/views/pipeline-builder.ts | creado | 1-267 |
| src/renderer/views/pipeline-list.ts | creado | 1-175 |
| src/renderer/app.ts | modificado | 1-163 (import + showPipelineList + routing) |
| src/renderer/index.html | modificado | 23-28 (pipeline sidebar) |
| src/renderer/style.css | modificado | 577-1130 (nuevos estilos) |
| src/types/pipeline.ts | modificado | 207-217 (anyade recommendedModel) |
| src/ipc/handlerLogic.ts | modificado | 455-466 (recommendedModel en listPipelineTemplates) |
| src/db/pipelineTemplateRepository.ts | modificado | 4-53 (anyade recommended_model al row y record) |
| src/db/migrations.ts | modificado | 123-128 (migration v6) |
| src/db/database.ts | modificado | 69-84 (seed recommended_model) |

### Gaps y dudas de Cloe
- [gap 1: El sidebar de pipelines no carga la lista de pipelines al arrancar -- solo muestra el boton "+ Nuevo Pipeline" que abre la vista completa. La lista de items en sidebar vendra en T-010 o cuando se implemente el panel lateral completo.]
- [gap 2: El boton de "Ejecutar" en cada pipeline item redirige a T-010 pero no esta implementado todavia -- el criterio de aceptacion decia "Boton Ejecutar en cada item -> navega a T-010"]
- [gap 3: No hay validacion de templates con recommendedModel nulo -- el template-card-model solo se muestra cuando recommendedModel existe]

Confianza en la implementacion: alta

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
