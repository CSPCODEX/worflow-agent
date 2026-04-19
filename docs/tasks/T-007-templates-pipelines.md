# T-007 — Templates predefinidos de pipelines

**Status:** DONE
**Phase:** Fase 1
**Agente responsable:** Cloe
**Depende de:** T-001
**Esfuerzo estimado:** 2 días

## Descripción

Crear los 4 templates predefinidos de pipelines (Content Creator, Code Review, Data Analyst, Traductor) como archivos JSON y sembrarlos en la DB al instalar la app por primera vez.

## Solución técnica

**1. Crear archivos JSON de templates**

```
src/templates/pipelines/
  content-creator.json
  code-review.json
  data-analyst.json
  translator.json
```

Estructura de cada JSON según `PipelineTemplate` definido en `docs/product/SPECIFICATIONS.md` sección 2.1. Los prompts exactos están en `docs/product/SPECIFICATIONS.md` secciones 1.1–1.4.

Cada template incluye:
- `name`, `description`, `category`
- `variables`: array de `TemplateVariable` con `name`, `label`, `type`, `required`, `placeholder`
- `steps`: array de `TemplateStep` con `order`, `name`, `agentRoleHint`, `inputTemplate`, `description`

**2. Seed en DB al arrancar**

En `src/db/database.ts` (o en la migración v4), después de crear las tablas, insertar los 4 templates con `is_builtin = 1` si no existen aún:

```typescript
const existingTemplates = db.query('SELECT COUNT(*) as count FROM pipeline_templates').get();
if (existingTemplates.count === 0) {
  // insertar los 4 templates
}
```

Leer los JSON desde el filesystem en tiempo de build o embebidos como imports estáticos.

**3. Añadir etiqueta de modelo recomendado**

Cada template incluye un campo `recommendedModel` (string) con el mínimo recomendado, según `docs/product/SPECIFICATIONS.md` sección 6.4:
- Content Creator: `"13B+"`
- Code Review: `"7B (code fine-tuned)"`
- Data Analyst: `"13B+"`
- Traductor: `"7B+"`

## Criterios de aceptación

- [ ] Los 4 archivos JSON existen en `src/templates/pipelines/`
- [ ] Los prompts de cada template coinciden con los de SPECIFICATIONS.md secciones 1.1–1.4
- [ ] Al arrancar la app por primera vez, los 4 templates aparecen en `pipeline_templates` con `is_builtin = 1`
- [ ] Si la app se reinicia, los templates no se duplican (seed idempotente)
- [ ] `listPipelineTemplates` IPC devuelve los 4 templates correctamente
- [ ] `getPipelineTemplate` devuelve el template completo con variables y steps parseados

## Subtareas

- [ ] Crear `src/templates/pipelines/content-creator.json` con prompts de SPECIFICATIONS.md 1.1
- [ ] Crear `src/templates/pipelines/code-review.json` con prompts de SPECIFICATIONS.md 1.2
- [ ] Crear `src/templates/pipelines/data-analyst.json` con prompts de SPECIFICATIONS.md 1.3
- [ ] Crear `src/templates/pipelines/translator.json` con prompts de SPECIFICATIONS.md 1.4
- [ ] Añadir lógica de seed en `src/db/database.ts` (idempotente)
- [ ] Verificar que `pipelineTemplateRepository.getTemplate()` parsea correctamente los JSON

## Notas

- Los templates builtin no se pueden borrar desde la UI (el handler debe rechazarlo).
- El campo `agentRoleHint` en cada step sirve para sugerir qué agente asignar — no es obligatorio en el MVP, pero hay que incluirlo para V1.
- Los prompts en inglés/español son decisión de diseño: usar español ya que el público objetivo es hispanohablante según VISION.md.
