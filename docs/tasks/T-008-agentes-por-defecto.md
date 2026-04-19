# T-008 — Agentes por defecto pre-instalados

**Status:** TODO
**Phase:** Fase 1
**Agente responsable:** Cloe
**Depende de:** T-003
**Esfuerzo estimado:** 1 día

## Descripción

Sembrar en la DB los 6 agentes predefinidos que vienen con la app (Investigador, Redactor, Revisor, Traductor, Programador, Analista) marcados con `is_default = 1`.

## Solución técnica

En `src/db/database.ts`, después del seed de templates (T-007), insertar los 6 agentes si la tabla `agents` no tiene registros con `is_default = 1`:

```typescript
const defaultAgents = db.query(
  'SELECT COUNT(*) as count FROM agents WHERE is_default = 1'
).get();

if (defaultAgents.count === 0) {
  // insertar los 6 agentes
}
```

Los 6 agentes y sus system prompts están en `docs/product/SPECIFICATIONS.md` sección 4.3:

| Nombre | System prompt (resumen) |
|---|---|
| Investigador | Analiza el tema, devuelve puntos clave estructurados |
| Redactor | Escribe contenido claro y bien estructurado |
| Revisor | Revisa y mejora estructura, claridad, gramática y estilo |
| Traductor | Traduce manteniendo tono y precisión del original |
| Programador | Analiza, escribe y refactoriza código con buenas prácticas |
| Analista | Identifica patrones, tendencias y genera insights de datos |

Cada agente se crea con:
- `provider`: el provider por defecto de Settings (o `lmstudio` si no hay configurado)
- `is_default = 1`
- `model`: null (usa el modelo cargado en el provider)

## Criterios de aceptación

- [ ] Al arrancar la app por primera vez, los 6 agentes existen en `agents` con `is_default = 1`
- [ ] El seed es idempotente (no duplica agentes si la app se reinicia)
- [ ] Los 6 agentes aparecen en `listAgents` IPC
- [ ] No se puede borrar ninguno de los 6 desde la UI (handler rechaza con error descriptivo)
- [ ] El usuario puede editar el system prompt de los agentes por defecto (solo borrado está bloqueado)

## Subtareas

- [ ] Añadir lógica de seed de los 6 agentes en `src/db/database.ts`
- [ ] Escribir los system prompts completos basándose en SPECIFICATIONS.md sección 4.3
- [ ] Verificar que `deleteAgent` en `handlerLogic.ts` rechaza agentes con `is_default = 1`
- [ ] Verificar que los 6 agentes aparecen en la UI de gestión de agentes (T-011)

## Notas

- El sistema prompt completo (no el resumen) hay que escribirlo con cuidado — son los prompts que los usuarios van a usar directamente con modelos locales. Deben ser directivos y específicos, no abiertos (ver ARCHITECTURE.md Decision 6 y VISION.md sobre calidad de modelos locales).
- El usuario puede editar estos agentes. Si los edita y quiere recuperar el original, no hay "reset" en MVP — queda para V1.
