# T-003 — Refactor agentes como roles reutilizables

**Status:** DONE
**Phase:** Fase 0.2
**Agente responsable:** Cloe
**Depende de:** T-001
**Esfuerzo estimado:** 3 días

## Descripción

Adaptar el sistema de agentes existente para que un agente pueda ser usado en múltiples pipelines simultáneamente sin conflictos. Añadir el campo `is_default` para distinguir los agentes pre-instalados de los creados por el usuario.

## Solución técnica

**1. Añadir `is_default` a la tabla `agents`**

Migración v4 (puede ir en el mismo bloque que T-001 o como v5):
```sql
ALTER TABLE agents ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
```

Actualizar `src/db/agentRepository.ts`:
- Añadir `isDefault` al tipo `Agent`
- Añadir `createDefaultAgent(data)` que setea `is_default = 1`
- `deleteAgent`: rechazar si `is_default = 1` con error descriptivo

**2. Provider config global**

El provider de un agente actualmente se guarda por agente. Para el MVP, los pipelines usan el provider configurado en Settings globalmente. El override por agente se añade en V1.

- `settingsRepository.ts`: añadir keys `default_provider` y `default_provider_config` (JSON con apiKey si aplica)
- Al ejecutar un paso de pipeline, el PipelineRunner lee el provider de Settings, no del agente

**3. Desacoplar ejecución de agente de su configuración persistida**

Al ejecutar un pipeline, el PipelineRunner construye la config del agente en memoria (a partir de los datos en DB) sin mutar el registro del agente. La config se pasa a `acpManager.createSession()` como parámetro, no se lee de un archivo en disco durante la ejecución.

## Criterios de aceptación

- [x] La tabla `agents` tiene columna `is_default` (INTEGER, default 0)
- [x] `agentRepository` expone `isDefault` en el tipo `Agent`
- [x] No se puede borrar un agente con `is_default = 1` (error claro)
- [x] `settingsRepository` tiene métodos para leer/escribir `default_provider`
- [x] Un agente puede estar asignado a 2+ pipelines distintos sin conflicto en DB (FK permite repetición)

## Subtareas

- [x] Añadir `ALTER TABLE agents ADD COLUMN is_default` en la migración v5
- [x] Actualizar tipo `Agent` en `agentRepository.ts` para incluir `isDefault`
- [x] Añadir guard en `deleteAgent` para rechazar agentes por defecto
- [x] Añadir `default_provider` y `default_provider_config` en `settingsRepository.ts`
- [ ] Documentar en `handlerLogic.ts` cómo el PipelineRunner debe leer el provider

## Notas

- El campo `is_default` protege los agentes pre-instalados (T-008) de borrado accidental.
- El override de provider por agente queda para V1 (ROADMAP Fase 2). No implementar ahora.
- La "clonación" del agente mencionada en el ROADMAP se implementa en el PipelineRunner (T-004), no en el repositorio.
