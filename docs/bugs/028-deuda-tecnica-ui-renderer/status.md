# Bug #028 — Deuda técnica UI renderer — confirm dialog duplicado, const en switch sin scope, imports redundantes

Estado: RESUELTO
Rama: bug/028-deuda-tecnica-ui-renderer
Fecha apertura: 2026-04-19
Fecha resolución: 2026-04-19

---

## Info del bug

**Descripcion:** Tres issues de limpieza en el renderer. (1) src/renderer/views/pipeline-list.ts líneas 15-52: showConfirm duplicado — el proyecto ya tiene src/renderer/components/confirm-dialog.ts para este propósito. Dos implementaciones del mismo patrón divergerán. (2) src/renderer/views/onboarding.ts línea 99: const dentro de un switch case sin bloque de scope ({ }). const hasProvider = ... en case 3 sin llaves. Tolerable en Bun/TypeScript pero genera warnings de linter estándar. (3) src/ipc/handlerLogic.ts líneas 48-58: dos imports del mismo módulo agentRepository — uno como tipo y uno como valor — innecesariamente verboso.

**Como reproducir:**
Para issue #1: Revisar pipeline-list.ts — showConfirm inline (líneas 15-52) duplica confirm-dialog.ts.
Para issue #2: Revisar onboarding.ts línea 99 — const hasProvider en case 3 sin llaves rodeando el bloque.
Para issue #3: Revisar handlerLogic.ts líneas 48-58 — dos sentencias import para el mismo módulo agentRepository.

**Comportamiento esperado:** Un solo componente confirm-dialog reutilizado. Switch cases con const envueltos en llaves. Un único import consolidado por módulo.

**Comportamiento actual:** Dos implementaciones paralelas del confirm dialog. const en switch sin scope. Dos imports separados del mismo módulo.

**Severidad:** BAJA

**Tiene implicaciones de seguridad:** NO

---

## Handoff Max → Cloe

> Diagnostico completado por Max.

**Causa raiz:** Deuda tecnica acumulada. Los tres archivos fueron editados de forma independiente y ninguna revision detecto las duplicaciones.

---

### Issue 1 — confirm dialog duplicado

**Archivo:** `src/renderer/views/pipeline-list.ts:15-52`
**Evidencia:** `showConfirm` inline retorna `Promise<boolean>`, mientras `confirm-dialog.ts:10` exporta `showConfirmDialog` (void, callbacks). Dos APIs distintas para el mismo proposito.

**Differencia relevante:** El `showConfirm` inline en `pipeline-list.ts:19` usa `innerHTML` con `escapeHtml` solo en title/message pero no en la estructura estatica del dialogo. El componente existente `confirm-dialog.ts:28-31` usa `textContent` para todos los textos — es mas seguro contra XSS y tiene `role="dialog"`, `aria-modal="true"`, `aria-labelledby` y focus al abrir.

**Fix en pipeline-list.ts:**
1. Eliminar la funcion `showConfirm` inline (lineas 15-52)
2. Importar `showConfirmDialog` desde `../components/confirm-dialog`
3. En `renderPipelineItems()` linea 153, cambiar:
   ```ts
   // ANTES (Promise-based):
   const confirmed = await showConfirm('Eliminar Pipeline', `...`);
   if (!confirmed) return;
   // llamo a rpc.request.deletePipeline...

   // DESPUES (callback-based):
   showConfirmDialog({
     title: 'Eliminar Pipeline',
     message: `Estas seguro de que quieres eliminar "${pipeline?.name || id}"? Esta accion no se puede deshacer.`,
     onConfirm: async () => {
       try {
         const result = await rpc.request.deletePipeline({ pipelineId: id });
         if (result.success) await loadPipelines();
       } catch (e: any) {
         console.error('Error deleting pipeline:', e);
       }
     },
     onCancel: () => {},
   });
   ```
4. Agregar `return` inmediato tras invocar `showConfirmDialog` para no ejecutar el flujo de borrado sincronamente.

---

### Issue 2 — const en switch sin scope de bloque

**Archivo:** `src/renderer/views/onboarding.ts:98-104`
**Evidencia:** `case 3:` en la funcion `getStepHtml()` no tiene llaves `{ }`. La declaracion `const hasProvider = providersDetected.some(...)` queda en scope de toda la funcion `getStepHtml`, no limitada al case 3.

**Fix en onboarding.ts:**
```ts
// ANTES (lineas 98-104):
case 3:
  const hasProvider = providersDetected.some((p) => p.available);
  const providerLabels = ...
  ...

// DESPUES:
case 3: {
  const hasProvider = providersDetected.some((p) => p.available);
  const providerLabels = ...
  ...
  break;
}
```

---

### Issue 3 — imports redundantes del mismo modulo

**Archivo:** `src/ipc/handlerLogic.ts`
**Lineas afectadas:** 48 y 51
**Evidencia:**
- Linea 48: `import type { agentRepository as AgentRepo } from '../db/agentRepository';`
- Linea 51: `import { agentRepository } from '../db/agentRepository';`

Ambas importan del mismo modulo. Se usan en las interfaces `GenerateAgentDeps` (linea 64), `CreateSessionDeps` (linea 80) y `DeleteAgentDeps` (linea 85) — todas referencian `AgentRepo` como tipo.

**Fix en handlerLogic.ts:**
Reemplazar las dos lineas de import por:
```ts
import AgentRepository, { type AgentRepository as AgentRepo } from '../db/agentRepository';
```
Y actualizar las referencias de `agentRepository` (valor, linea 51) a `AgentRepository` en todas sus usages (lineas 151, 167, 190, 392).

---

## Criterios de verificacion para Max (post-fix)

1. `pipeline-list.ts` no tiene funcion `showConfirm` inline; importa `showConfirmDialog` de `../components/confirm-dialog`
2. El dialogo de confirmacion al eliminar un pipeline sigue funcionando igual (mismo texto, mismo comportamiento)
3. `onboarding.ts` tiene el bloque `case 3: { ... break; }` con llaves
4. `handlerLogic.ts` tiene un solo import de agentRepository (consolidado)
5. `bun run tsc --noEmit` pasa sin errores nuevos
6. No hay cambios funcionales en el comportamiento de los tres archivos

---

## Metricas de Max
- archivos_leidos: 4 (status.md, pipeline-list.ts, onboarding.ts, handlerLogic.ts, confirm-dialog.ts)
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 0
- bugs_bajos: 3
- items_checklist_verificados: 3/3 issues
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Handoff Cloe -> Max

### Checklist Cloe
- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Leo (o documentado por que difieren)
- [x] bun run tsc --noEmit ejecutado - 0 errores nuevos antes de entregar
- [x] Strings que viajan por IPC son ASCII puro (solo comentarios non-ASCII, no datos IPC)
- [x] Fire-and-forget en todos los handlers IPC que lanzan subprocesos (no aplica - no hay spawn en estos archivos)
- [x] Input validation en todos los IPC handlers que tocan filesystem o spawn (no aplica)
- [x] DB: no aplica
- [x] initDatabase() en try/catch (no aplica)
- [x] Sin `any` sin justificacion escrita (no hay `any` en los cambios)
- [x] Labels HTML: no aplica (no se modificaron templates HTML)
- [x] Vistas existentes reutilizan CSS existente (confirm-dialog ya estaba en uso)

### Manifiesto de archivos
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| src/renderer/views/pipeline-list.ts | modificado | 1-13 (imports + interfaz), 109-128 (delete handler) |
| src/renderer/views/onboarding.ts | modificado | 98-132 (case 3 con llaves) |
| src/ipc/handlerLogic.ts | modificado | 48 (consolidado import), 64-89 (interfaces actualizadas con typeof agentRepository) |
| src/db/agentRepository.ts | modificado | 34-36 (agregado type alias AgentRepository = AgentRecord para soportar el import de Max) |

### Nota sobre Issue 3
El fix de Max decia: `import AgentRepository, { type AgentRepository as AgentRepo } from '../db/agentRepository'` - pero `AgentRepository` NO existe como export en agentRepository.ts (solo existe `AgentRecord` como interface y `agentRepository` como const). Para que compile, se implemento:
1. Agregar `export type AgentRepository = AgentRecord` a agentRepository.ts (linea 35)
2. Consolidar a: `import { agentRepository, type AgentRepository as AgentRepo } from '../db/agentRepository'`
3. En las interfaces, cambiar `typeof AgentRepo` por `typeof agentRepository` (ya que `AgentRepo` ahora es un tipo, no un valor)

### Gaps y dudas de Cloe
- [gap 1: No se pudo verificar manualmente el dialogo de confirmacion en pipeline-list porque requiere entorno desktop con Electrobun]
- [gap 2: El type alias AgentRepository = AgentRecord en agentRepository.ts es un workaround necesario para el import de Max - funciona pero semanticamente es un alias, no el tipo original]
Confianza en la implementacion: alta

---

## Verificacion final Max (QA aprobado)

### Checklist Max — [ESTATICO]

- [x] No existe funcion `showConfirm` inline en pipeline-list.ts — evidencia: grep retorna 0 matches en archivo
- [x] `case 3:` en onboarding.ts tiene llaves de bloque — evidencia: `onboarding.ts:98` (getStepHtml) y `onboarding.ts:184` (attachEvents) ambos muestran `case 3: {`
- [x] Imports de agentRepository consolidados — evidencia: `handlerLogic.ts:48` importa de '../db/agentRepository' en una sola sentencia
- [x] TSC limpio (0 errores nuevos en archivos modificados) — evidencia: todos los errores TSC son preexistentes en node_modules, scripts/, tests/, y otros archivos no tocados por este fix
- [x] Sin cambios funcionales en los tres archivos — evidencia: solo refactor/cleanup, ninguna logica de negocio alterada
- [x] `AgentRepository` type exportado desde agentRepository.ts linea 35 para soportar el import consolidado

### No verificado por Max
<!-- Declara explicitamente lo que NO pudiste verificar y por que. Si verificaste todo, escribe "Ninguno." -->
- Dialogo de confirmacion de Eliminacion en pipeline-list: No se pudo verificar manualmente porque requiere entorno desktop con Electrobun. Se verfico via codigo review que showConfirmDialog es invocado con los mismos parametros (title, message, onConfirm, onCancel) y el codigo de confirm callback es identico al original.
Confianza en la verificacion: alta

### Requiere auditoria de Cipher: NO

---

## Metricas de Max (post-verificacion)
- archivos_leidos: 5 (status.md, pipeline-list.ts, onboarding.ts, handlerLogic.ts, agentRepository.ts)
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 0
- bugs_bajos: 0 (resueltos)
- items_checklist_verificados: 6/6
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 1 (test manual de dialogo eliminado, verificado via code review)

→ QA aprobado — listo para merge.

## Commit

Archivos en el commit:
- `src/renderer/views/pipeline-list.ts` — eliminado showConfirm inline, importado showConfirmDialog
- `src/renderer/views/onboarding.ts` — case 3: envuelto en llaves de bloque
- `src/ipc/handlerLogic.ts` — imports agentRepository consolidados en una sentencia
- `src/db/agentRepository.ts` — export type AgentRepository = AgentRecord
- `docs/bugs/028-deuda-tecnica-ui-renderer/status.md` — marcado RESUELTO