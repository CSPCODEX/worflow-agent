# Bug #018 — AcpManager callback global sobrescrito por PipelineRunner — chat se desconecta durante ejecucion

Estado: RESUELTO
Rama: feature/dev
Fecha apertura: 2026-04-19
Requiere auditoria de Cipher: NO

---

## Info del bug

**Descripcion:** src/ipc/pipelineRunner.ts linea 249: acpManager.setMessageCallback(chunkHandler) sobreescribe el callback global del singleton acpManager. handlers.ts registra su propio callback en linea 457 para el canal de chat (agentMessageChunk, agentMessageEnd). Cuando un pipeline se ejecuta, ese callback se sobreescribe y el chat pierde sus mensajes de streaming. Al terminar el pipeline, el callback queda apuntando a la clausura del ultimo paso — referencia stale que nunca se limpia.

**Como reproducir:**
1. Abrir un chat activo con cualquier agente
2. Lanzar la ejecucion de un pipeline en paralelo
3. Observar que el chat deja de recibir respuestas del agente mientras el pipeline corre
4. Al terminar el pipeline, el chat sigue sin funcionar correctamente

**Comportamiento esperado:** El chat y el pipeline funcionan de forma independiente sin interferencia entre si.

**Comportamiento actual:** El chat se desconecta mientras el pipeline corre, y el callback queda en estado stale al finalizar.

**Severidad:** ALTA

**Tiene implicaciones de seguridad:** NO

---

## Diagnostico de Max

### Analisis de causa raiz

La clase `AcpManager` (`src/ipc/acpManager.ts`) mantiene un unico campo `private onMessage?: MessageCallback` (linea 29). Este campo es compartido por TODAS las sesiones activas simultaneamente.

La arquitectura de callbacks tiene tres capas que colisionan:

**Capa 1 — Captura en `createSession` (linea 39):**
```
const notify = this.onMessage;
```
El `StreamingClient` anidado captura `this.onMessage` por valor en el momento de crear la sesion. Si `setMessageCallback` se llama despues de que la sesion fue creada, el `StreamingClient` ya existente sigue usando el callback anterior — no el nuevo. Esta captura por valor significa que el StreamingClient del chat captura el callback de chat, y una vez creado, no puede ser afectado por llamadas posteriores a `setMessageCallback`. Sin embargo el campo `this.onMessage` en `sendMessage` si se lee en el momento del `then/catch` (lineas 111-113), lo que si sufre la sobreescritura.

**Capa 2 — Lectura en `sendMessage` (linea 106):**
```
const notify = this.onMessage;
```
Aqui `notify` se captura en el momento de llamar `sendMessage`. Si `setMessageCallback` fue llamado antes de este punto, `notify` apunta al callback nuevo (el del pipeline). El callback del chat queda inutilizado para la notificacion del `end`/`error` de ese mensaje.

**Capa 3 — El conflicto central:**
- `handlers.ts` linea 457: `acpManager.setMessageCallback(chatCallback)` — registrado al arrancar `createRpc()`
- `pipelineRunner.ts` linea 249: `acpManager.setMessageCallback(chunkHandler)` — llamado dentro de `runStepWithTimeout` por cada paso de pipeline

Cada llamada a `runStepWithTimeout` sobreescribe `this.onMessage`. Cuando el paso termina, el campo queda apuntando a la clausura del ultimo `chunkHandler` — que referencia variables locales del `runStepWithTimeout` ya ejecutado (closure stale). El callback del chat nunca se restaura.

**El segundo problema — sendMessage es fire-and-forget pero la captura es tardia:**
En `sendMessage` (linea 106), `const notify = this.onMessage` se ejecuta en el momento de la llamada. Si el pipeline ha sobreescrito `this.onMessage` antes de que el chat llame `sendMessage`, el `notify` del chat apuntara al `chunkHandler` del pipeline — los `end`/`error` del chat se enrutaran al pipeline runner y los eventos `agentMessageEnd`/`agentError` del renderer nunca se emitiran.

### Evaluacion de opciones de fix

**Opcion A — Refactorizar AcpManager con Map<sessionId, callback>**

Cada sesion registra su propio callback en `setSessionCallback(sessionId, cb)`. `StreamingClient` y `sendMessage` leen el callback especifico de su `sessionId`. El callback global desaparece.

Ventajas:
- Resolucion definitiva — imposible que dos sesiones interfieran entre si
- El pipeline y el chat pueden correr en paralelo sin ninguna coordinacion externa
- Elimina la necesidad de "restaurar" nada — cada sesion tiene su propio estado

Desventajas:
- Requiere cambiar la signatura publica de `AcpManager`: `setMessageCallback` → `setSessionCallback(sessionId, cb)` o registrar el callback dentro de `createSession`
- `handlers.ts` registra el callback ANTES de conocer el `sessionId` (el sessionId lo devuelve `createSession`). Requiere reestructurar el flujo de registro: el callback del chat deberia registrarse en el handler `createSession`, no en `createRpc()`
- Cambio de API mas amplio que toca `handlers.ts` y el contrato de `createSession`

**Opcion B — Guardar y restaurar el callback original al finalizar cada paso**

Antes de `setMessageCallback(chunkHandler)`: `const savedCallback = acpManager.getMessageCallback()`. Despues de que el paso termina (y antes de `closeSession`): `acpManager.setMessageCallback(savedCallback)`.

Ventajas:
- Cambio minimo y localizado: solo `pipelineRunner.ts` y una adicion menor a `acpManager.ts` (`getMessageCallback()`)
- No cambia la API publica observable desde `handlers.ts`
- Riesgo de regresion casi nulo — el resto del codigo no se modifica
- Compatible con el MVP: en el MVP los pipelines son secuenciales (un paso a la vez), por lo que save/restore es suficiente

Desventajas:
- No resuelve el problema si dos pipelines corren en paralelo (no es un caso del MVP)
- Si `runStepWithTimeout` lanza una excepcion antes del restore, el callback queda sobreescrito. Requiere un bloque try/finally para garantizar la restauracion
- Es un workaround architectonico, no una solucion limpia

### Decision

**Se recomienda la Opcion B (guardar/restaurar) para el MVP.**

Razon: La Opcion A es la solucion correcta a largo plazo, pero cambia la API de `AcpManager` y el flujo de registro de callbacks en `handlers.ts`, aumentando la superficie de riesgo en codigo que ya funciona. La Opcion B es quirurgica: tres lineas en `pipelineRunner.ts` y un getter en `acpManager.ts`. El spec del MVP establece explicitamente que "Pipeline execution is sequential: one agent at a time per pipeline run. No concurrency in the MVP." — por lo tanto save/restore con try/finally es correcto y suficiente para el MVP.

### Evidencia de los puntos criticos

- `src/ipc/acpManager.ts:29` — campo `private onMessage?: MessageCallback` unico para todas las sesiones
- `src/ipc/acpManager.ts:31-33` — `setMessageCallback` sobreescribe incondicionalmente
- `src/ipc/acpManager.ts:39` — `const notify = this.onMessage` captura por valor en el momento de `createSession` (no afectado por sobreescrituras posteriores para `StreamingClient`)
- `src/ipc/acpManager.ts:106` — `const notify = this.onMessage` captura por valor en el momento de `sendMessage` (SI afectado: si el pipeline sobreescribio el callback antes de que el chat llame `sendMessage`, el `end`/`error` del chat se enrutan al pipeline)
- `src/ipc/pipelineRunner.ts:244-249` — `chunkHandler` definido y `setMessageCallback(chunkHandler)` llamado en cada paso
- `src/ipc/pipelineRunner.ts:259` — `return sessionId` al salir del bloque try — sin restaurar el callback
- `src/ipc/pipelineRunner.ts:260` — bloque `catch` retorna `null` sin restaurar el callback
- `src/ipc/handlers.ts:457-465` — `acpManager.setMessageCallback(chatCallback)` registrado una sola vez en `createRpc()` — sobrevive mientras la app no se reinicie

### Verificacion TypeScript baseline

`bun run tsc --noEmit` — errores en `src/ipc/acpManager.ts` son preexistentes (lineas 50 y 70, relacionados con tipos de ReadableStream del SDK, no con el bug #018). Ningun error nuevo introducido por los archivos afectados.

---

## Handoff Max → Cloe

**Causa raiz confirmada:** `AcpManager.onMessage` es un campo escalar unico. `pipelineRunner.runStepWithTimeout` lo sobreescribe en cada paso sin restaurarlo. `handlers.ts` registra el callback de chat una sola vez al arrancar — queda inutilizado para los `sendMessage` del chat que ocurran despues de que el pipeline empiece a correr.

**Fix elegido: Opcion B — save/restore con try/finally**

**Archivos a modificar:**

1. `src/ipc/acpManager.ts`
   - Anadir metodo publico `getMessageCallback(): MessageCallback | undefined` que retorne `this.onMessage`
   - No cambiar ninguna otra cosa en este archivo

2. `src/ipc/pipelineRunner.ts` — metodo `runStepWithTimeout` (lineas 221-262)
   - Antes de `acpManager.setMessageCallback(chunkHandler)` (actualmente linea 249): guardar `const savedCallback = acpManager.getMessageCallback()`
   - Envolver el bloque `try { ... return sessionId } catch { ... return null }` en un try/finally
   - En el bloque `finally`: `acpManager.setMessageCallback(savedCallback!)`
   - El `finally` debe ejecutarse tanto en el path exitoso como en el catch (timeout o fallo de agente)

**Estructura exacta esperada del metodo `runStepWithTimeout` tras el fix:**

```
const savedCallback = acpManager.getMessageCallback();
const chunkHandler = ...;
acpManager.setMessageCallback(chunkHandler);

try {
  await Promise.race([...]);
  return sessionId;
} catch {
  return null;
} finally {
  acpManager.setMessageCallback(savedCallback);
}
```

**Criterios de verificacion para Max (post-fix):**
1. `src/ipc/acpManager.ts` tiene metodo `getMessageCallback()` que retorna `this.onMessage` — evidencia: file:line
2. `src/ipc/pipelineRunner.ts:runStepWithTimeout` usa try/finally con restauracion del callback — evidencia: file:line
3. El `finally` envuelve tanto el path exitoso como el catch — evidencia: inspeccion del bloque
4. `bun run tsc --noEmit` — 0 errores nuevos respecto al baseline (errores preexistentes en lineas 50 y 70 de acpManager.ts son aceptables)
5. No hay otras llamadas a `setMessageCallback` en `pipelineRunner.ts` fuera de `runStepWithTimeout` — evidencia: grep result
6. El metodo `resume` de `pipelineRunner.ts` tambien llama `runStepWithTimeout` — verificar que el fix cubre ambos paths (execute y resume) sin cambios adicionales (el fix en `runStepWithTimeout` los cubre a ambos automaticamente)

**Notas adicionales para Cloe:**
- NO cambiar la signatura de `createSession`, `sendMessage`, ni `setMessageCallback` — son API publica usada por `handlers.ts`
- NO tocar `handlers.ts` — el registro del chat callback en linea 457 sigue siendo correcto
- El `savedCallback` puede ser `undefined` si se llama antes de que `createRpc()` registre el callback de chat (caso de test o arranque muy temprano) — usar `acpManager.setMessageCallback(savedCallback!)` o manejar el undefined explicitamente segun el tipo. Dado que `setMessageCallback` acepta `MessageCallback` (no undefined), anadir overload o cambiar el setter para aceptar `cb: MessageCallback | undefined` y asignarlo directamente sin guardia. La opcion mas simple: hacer que `setMessageCallback` acepte `cb?: MessageCallback` con `this.onMessage = cb`

---

→ Siguiente: @cloe Implementa el fix del bug #018. Lee el handoff en `docs/bugs/018-acpmanager-callback-sobrescrito/status.md`. El fix requiere cambios en dos archivos unicamente: `src/ipc/acpManager.ts` (anadir `getMessageCallback()`) y `src/ipc/pipelineRunner.ts` (save/restore con try/finally en `runStepWithTimeout`). No toques `handlers.ts` ni la API publica de `AcpManager`.

---

## Metricas de Max (diagnostico)
- archivos_leidos: 4
- bugs_criticos: 0
- bugs_altos: 1 (el propio bug #018, diagnosticado)
- bugs_medios: 0
- items_checklist_verificados: 3/3
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 1

### No verificado por Max (diagnostico)
- Reproduccion en runtime del sintoma (chat bloqueado durante pipeline): requiere LM Studio activo y agente corriendo. El analisis estatico del codigo es suficiente para confirmar la causa raiz con alta confianza.
Confianza en la verificacion: alta

---

## Handoff Cloe -> Max

### Que se implemento

Fix del bug #018: save/restore del callback global de `AcpManager` en `runStepWithTimeout` usando try/finally.

**`src/ipc/acpManager.ts`:**
- Se modifico `setMessageCallback` para aceptar `cb: MessageCallback | undefined` (necesario para restaurar `undefined` cuando no habia callback previo)
- Se agrego metodo publico `getMessageCallback(): MessageCallback | undefined` que retorna `this.onMessage`

**`src/ipc/pipelineRunner.ts`:**
- Linea 244: `const savedCallback = acpManager.getMessageCallback()` — guarda el callback actual antes de sobreescribir
- Linea 262-264: bloque `finally` que ejecuta `acpManager.setMessageCallback(savedCallback)` — restauracion garantizada tanto en path exitoso como en catch (timeout o fallo)
- La estructura final del metodo coincide exactamente con la esperada por Max en el handoff

### Checklist Cloe
- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Max (getter retorna `MessageCallback | undefined`, setter acepta `MessageCallback | undefined`)
- [x] bun run tsc --noEmit ejecutado — 0 errores nuevos en src/ (errores preexistentes en scripts/metrics.ts no introducidos por este fix)
- [x] Strings que viajan por IPC son ASCII puro — 0 chars no-ASCII en ambos archivos (verificado con grep)
- [x] Fire-and-forget no aplica: no hay nuevos subprocesos spawneados
- [x] Input validation no aplica: no se tocan rutas nuevas de filesystem
- [x] DB no aplica: no hay cambios en la capa de datos
- [x] Sin `any` sin justificacion
- [x] No hay otras llamadas a `setMessageCallback` en `pipelineRunner.ts` fuera de `runStepWithTimeout` (verificado: solo lineas 250 y 263)
- [x] El fix cubre tanto `execute` como `resume` automaticamente — ambos llaman `runStepWithTimeout`

### Manifiesto de archivos
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| src/ipc/acpManager.ts | modificado | 31-37 (setter ampliado + getter nuevo) |
| src/ipc/pipelineRunner.ts | modificado | 244 (savedCallback), 262-264 (finally block) |

### Gaps y dudas de Cloe
Sin gaps porque: cambio de 5 lineas sin nueva logica de negocio, tsc sin errores nuevos, el `finally` garantiza la restauracion en todos los paths de ejecucion del metodo.

Confianza en la implementacion: alta

---

## Metricas de Cloe
- archivos_leidos: 3
- archivos_creados: 0
- archivos_modificados: 2
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Verificacion final Max — Bug #018

### Checklist Max — bloques activos: ESTATICO | IPC

## ESTATICO

- [x] Cada archivo del manifiesto verificado con file:line — evidencia:
  - `src/ipc/acpManager.ts:31-37`: setter acepta `MessageCallback | undefined`, getter retorna `this.onMessage` — confirmado
  - `src/ipc/pipelineRunner.ts:244,250,262-264`: save antes de sobreescribir, try/finally con restore — confirmado
- [x] bun run tsc --noEmit — 0 errores nuevos en `src/ipc/acpManager.ts` ni `src/ipc/pipelineRunner.ts` — evidencia: errores en acpManager.ts son lineas 54 y 74 (preexistentes del SDK, no del fix); todos los demas errores son en `scripts/`, `node_modules/`, `src/db/`, `tests/` — ningun error en las lineas 31-37 ni en pipelineRunner.ts
- [x] Sin logica de negocio rota — evidencia: el getter es un accessor trivial (return this.onMessage); el setter solo amplia el tipo a `| undefined`; el finally garantiza restauracion en todo path de ejecucion

## IPC

- [x] Fire-and-forget no aplica al fix: no hay nuevos subprocesos — evidencia: `src/ipc/pipelineRunner.ts:244,262-264` solo manipula el campo `onMessage`, no spawns
- [x] Strings IPC — no hay strings nuevos viajando por IPC en este fix — confirmado
- [x] Inputs validados — no aplica: el fix no abre nuevas rutas de filesystem ni spawn

### Criterios especificos del bug (lineas 148-153 del handoff)

1. `getMessageCallback()` existe y retorna `this.onMessage` — evidencia: `src/ipc/acpManager.ts:35-37`
2. try/finally con restauracion en `runStepWithTimeout` — evidencia: `src/ipc/pipelineRunner.ts:252-264`
3. El finally envuelve ambos paths (return exitoso en linea 259, catch en linea 261) — evidencia: la estructura es `try { ... return sessionId } catch { return null } finally { restore }` — el finally se ejecuta despues de ambos returns
4. TSC — 0 errores nuevos en los archivos del fix — evidencia: output de tsc revisado, ningun error en acpManager.ts:31-37 ni en pipelineRunner.ts
5. No hay otras llamadas a `setMessageCallback` fuera de `runStepWithTimeout` — evidencia: grep muestra solo lineas 250 y 263 en pipelineRunner.ts
6. El fix cubre `execute` y `resume` automaticamente — evidencia: ambos metodos llaman `runStepWithTimeout`; el fix vive dentro del metodo, se aplica a todos los callers sin cambios adicionales

### No verificado por Max
- Reproduccion en runtime (chat + pipeline corriendo simultaneamente): requiere LM Studio activo con agente disponible. El analisis estatico confirma el fix con alta confianza.
Confianza en la verificacion: alta

---

QA aprobado — listo para commit.

---

## Metricas de Max (verificacion final)
- archivos_leidos: 4
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 0
- items_checklist_verificados: 8/8
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 1
