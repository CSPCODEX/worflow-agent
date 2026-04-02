# Plan — Ordenar features por fecha de apertura

## Contexto

El tab **Pipeline** del monitor (`src/monitor/ui/monitor-view.ts`) renderiza una tabla con todas las features del snapshot enviado por el poller. El orden actual no es claro — las features no aparecen ordenadas por `openedAt`.

## Decisión arquitectónica: ¿Dónde ordenar?

**Opción A — Ordenar en el poller/core al construir el snapshot:**
- El poller lee los `status.md` de cada feature, extrae `openedAt`, y ordena el array `features[]` antes de enviarlo.
- ✅ El renderer no necesita cambios; siempre recibe datos ordenados.
- ✅ Consistente para cualquier consumidor del snapshot.
- ❌ El poller tiene más lógica de presentación.

**Opción B — Ordenar en el renderer al renderizar:**
- `renderFeaturesTable()` recibe `features[]` y las ordena antes de mapearlas a HTML.
- ✅ Lógica de presentación cerca del render — separación más limpia.
- ❌ Cada consumidor del snapshot (si hay más de uno) tendría que ordenar por su cuenta.

**Decisión: Opción A (poller/core).** El snapshot es la fuente de verdad; el renderer solo presenta. Ordenar en un solo lugar evita inconsistencias. Además, `renderFeaturesTable()` ya hace filter por `state` — el sort es una transformación de datos, no de presentación, y pertenece al lugar donde se construye el snapshot.

## Archivos a modificar

1. **`src/monitor/core/poller.ts`** — Donde se construye `PipelineSnapshotIPC.features`:
   - Después de collecting all features, hacer `features.sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt))`
   - `openedAt` viene del frontmatter del `status.md` — verificar que el poller ya lo extraiga o añadirlo si falta.

2. **`src/monitor/ui/monitor-view.ts`** — `renderFeaturesTable()`:
   - Opcionalmente hacer sort defensivo aquí también (para cuando el snapshot venga de otras fuentes).
   - No romper el filter existente.

## openedAt en FeatureRecordIPC

Verificar que `FeatureRecordIPC` tenga el campo `openedAt`. Si no lo tiene, añadirlo en `src/types/ipc.ts`.

## Preguntas resueltas

**¿El tab Historial también se ordena por fecha?** No aplica — el historial usa paginación y se ordena por `recordedAt` (fecha del evento), no por `openedAt` de la feature.

**¿El tab Agentes también se ordena?** No aplica — el tab Agentes muestra cards de agentes, no features individuales. No hay `openedAt` por agente.

**¿Los bugs también se ordenan?** Los bugs tienen un `id` con formato `001`, `002`. Se podrían ordenar por `id` desc (más reciente primero). Esto está fuera del scope de esta feature — se deja como mejora futura si el usuario lo pide.

## Priority list

1. **[Critical]** Verificar que `FeatureRecordIPC` tenga `openedAt: string` en `src/types/ipc.ts`
2. **[Critical]** Verificar que el poller extraiga `openedAt` del frontmatter del `status.md`
3. **[Critical]** Añadir sort en el poller antes de enviar el snapshot
4. **[Minor]** Añadir sort defensivo en `renderFeaturesTable()` por si el snapshot llega desordenado de otra fuente

## Testing

- Verificar que las features del tab Pipeline aparezcan ordenadas por `openedAt` descendente (más reciente primero) al abrir el monitor.
- Verificar que el filtro por estado siga funcionando correctamente después del sort.
- Verificar que la columna "Abierta" muestre los valores tal cual.