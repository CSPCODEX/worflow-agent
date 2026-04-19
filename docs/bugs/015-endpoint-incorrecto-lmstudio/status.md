# Bug #015 — Endpoint incorrecto de LM Studio en detección de providers

Estado: RESUELTO
Rama: bug/015-endpoint-incorrecto-lmstudio
Fecha apertura: 2026-04-19
Diagnosticado por: Max
Resuelto por: Cloe
Verificado por: Max

---

## Info del bug

**Descripcion:** handleDetectLocalProviders en src/ipc/handlerLogic.ts línea 604 usa el endpoint `/api/tags` para LM Studio (que es el endpoint de Ollama). LM Studio expone `/v1/models` siguiendo la especificación OpenAI. El mismo error está en handleValidateProviderConnection en línea 630. Resultado: LM Studio siempre aparece offline aunque esté corriendo.

**Como reproducir:**
1. Tener LM Studio corriendo en 127.0.0.1:1234
2. Abrir la app y navegar a Settings o Onboarding
3. Pulsar "Detectar providers"
4. Observar que LM Studio aparece como offline

**Comportamiento esperado:** LM Studio aparece como detectado y disponible si está corriendo en 127.0.0.1:1234.

**Comportamiento actual:** LM Studio siempre aparece como "no disponible" aunque esté corriendo, porque se consulta `/api/tags` (endpoint de Ollama) en lugar de `/v1/models` (endpoint de LM Studio).

**Severidad:** ALTA

**Tiene implicaciones de seguridad:** NO

---

## Diagnóstico de Max — CONFIRMADO

**Causa raiz verificada con evidencia de código:**

`src/ipc/handlerLogic.ts:604` — `handleDetectLocalProviders`:
```
const res = await fetch(p.host + '/api/tags', { signal: controller.signal });
```
Esta línea itera sobre `providers` (que incluye tanto `lmstudio` como `ollama`) y usa el mismo endpoint `/api/tags` para ambos. LM Studio no expone este endpoint, por lo que la petición falla y `lmstudio` siempre queda como `available: false`.

`src/ipc/handlerLogic.ts:630` — `handleValidateProviderConnection`:
```
const res = await fetch(localHost + '/api/tags', { signal: controller.signal });
```
Aquí el mismo error se aplica a todos los providers locales (`lmstudio` y `ollama`) sin distinguir entre ellos.

**Grep confirma exactamente 2 ocurrencias del error, ninguna otra en el codebase:**
- `src/ipc/handlerLogic.ts:604`
- `src/ipc/handlerLogic.ts:630`

**TSC sobre handlerLogic.ts:** 0 errores nuevos. Los errores de TSC existentes están en `node_modules/electrobun` y `scripts/metrics.ts` — pre-existentes y no relacionados con este bug.

---

## Handoff Max → Cloe

**Archivos a modificar:** `src/ipc/handlerLogic.ts` (un solo archivo)

**Cambio 1 — línea 604 (handleDetectLocalProviders):**

El problema es que la función usa el mismo endpoint para todos los providers locales. Hay que distinguir el endpoint según el provider. El mapa de providers ya tiene el `id` disponible como `p.id`.

Reemplazar:
```typescript
const res = await fetch(p.host + '/api/tags', { signal: controller.signal });
```
Por:
```typescript
const endpoint = p.id === 'lmstudio' ? '/v1/models' : '/api/tags';
const res = await fetch(p.host + endpoint, { signal: controller.signal });
```

**Cambio 2 — línea 630 (handleValidateProviderConnection):**

La función usa un `Record<string, string>` para los hosts locales pero no distingue endpoints. Hay que añadir un mapa de endpoints igual de localizado.

Reemplazar (línea 630):
```typescript
const res = await fetch(localHost + '/api/tags', { signal: controller.signal });
```
Por:
```typescript
const localEndpoints: Record<string, string> = {
  lmstudio: '/v1/models',
  ollama: '/api/tags',
};
const endpoint = localEndpoints[params.providerId] ?? '/api/tags';
const res = await fetch(localHost + endpoint, { signal: controller.signal });
```

**Restricciones:**
- No modificar la firma de ninguna de las dos funciones exportadas.
- No modificar el timeout (3000ms), la lógica de AbortController, ni el resto del handler.
- No tocar la sección de cloud providers (línea 638 en adelante).
- El comportamiento de Ollama no debe cambiar: sigue usando `/api/tags`.

---

## Criterios de verificación para Max (post-fix)

1. **Grep confirma que `/api/tags` ya no se usa para lmstudio** — `grep -n "api/tags" src/ipc/handlerLogic.ts` solo debe aparecer en contextos de Ollama.
2. **Grep confirma que `/v1/models` aparece correctamente en ambas funciones** — una ocurrencia en `handleDetectLocalProviders` y una en `handleValidateProviderConnection`.
3. **handleDetectLocalProviders devuelve `available: true` para lmstudio cuando está activo** — evidencia por lectura del código con el endpoint correcto.
4. **handleValidateProviderConnection devuelve `{ success: true }` para lmstudio cuando usa `/v1/models`** — evidencia por lectura del código.
5. **Ollama sigue intacto** — `handleDetectLocalProviders` usa `/api/tags` para `ollama` y `handleValidateProviderConnection` usa `/api/tags` para `ollama`.
6. **TSC sobre handlerLogic.ts: 0 errores nuevos** tras el cambio.

---

## Handoff Cloe → Max

**Estado:** IMPLEMENTADO

### Cambios realizados

**Cambio 1 — handleDetectLocalProviders (linea 604):**

Reemplazado:
```typescript
const res = await fetch(p.host + '/api/tags', { signal: controller.signal });
```
Por:
```typescript
const endpoint = p.id === 'lmstudio' ? '/v1/models' : '/api/tags';
const res = await fetch(p.host + endpoint, { signal: controller.signal });
```

**Cambio 2 — handleValidateProviderConnection (linea 630):**

Reemplazado:
```typescript
const res = await fetch(localHost + '/api/tags', { signal: controller.signal });
```
Por:
```typescript
const localEndpoints: Record<string, string> = {
  lmstudio: '/v1/models',
  ollama: '/api/tags',
};
const endpoint = localEndpoints[params.providerId] ?? '/api/tags';
const res = await fetch(localHost + endpoint, { signal: controller.signal });
```

### Checklist Cloe
- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Leo (o documentado por que difieren)
- [x] bun run tsc --noEmit ejecutado — 0 errores nuevos antes de entregar
- [x] Strings que viajan por IPC son ASCII puro (sin tildes, acentos ni chars > 0x7E)
- [x] Fire-and-forget en todos los handlers IPC que lanzan subprocesos (Bun.spawn sin await) — N/A, no hay spawn
- [x] Input validation en todos los IPC handlers que tocan filesystem o spawn — N/A, no hay filesystem ni spawn
- [x] DB: si INSERT falla despues de scaffold, rollback del directorio creado — N/A
- [x] initDatabase() en try/catch con process.exit(1) si lanza — N/A
- [x] Sin `any` sin justificacion escrita en el handoff — N/A, no se introdujo ninguno
- [x] Labels HTML: todos tienen for+id matching — N/A, no hay HTML
- [x] Si creaste vistas nuevas: todas las clases CSS usadas en innerHTML existen en style.css — N/A

### Manifiesto de archivos
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| src/ipc/handlerLogic.ts | modificado | 604 (+1 linea), 630-636 (+4 lineas) |

### Auto-verificacion activa
- grep `/api/tags` — solo aparece en contextos de Ollama (linea 604 como valor del ternario, linea 633 en el mapa, linea 635 en el fallback). LM Studio ya no usa este endpoint.
- grep `/v1/models` — aparece en linea 604 (handleDetectLocalProviders) y linea 632 (handleValidateProviderConnection). Correcto.
- bun run tsc --noEmit — 0 errores nuevos. Errores pre-existentes en scripts/metrics.ts y node_modules/electrobun sin relacion con el fix.
- Chars no-ASCII — pre-existentes en comentarios del archivo, no en codigo funcional ni strings IPC.

### Gaps y dudas de Cloe
Sin gaps porque: fix de 5 lineas sobre logica de endpoint, sin nueva logica, tsc limpio, sin cambios en firmas ni en flujo de datos.

Confianza en la implementacion: alta

## Metricas de Cloe
- archivos_leidos: 2
- archivos_creados: 0
- archivos_modificados: 1
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Verificacion final de Max

### Checklist Max — bloques activos: ESTATICO | IPC

## ESTATICO
- [x] Archivo del manifiesto verificado: `src/ipc/handlerLogic.ts` lineas 604 y 631-636 — evidencia: lectura directa confirmada
- [x] bun run tsc --noEmit — 0 errores nuevos en handlerLogic.ts — evidencia: output de tsc sin ninguna linea que mencione handlerLogic
- [x] Sin logica de negocio rota — evidencia: firmas de ambas funciones intactas, timeout 3000ms intacto, AbortController intacto, seccion cloud providers desde linea 644 sin modificar

## IPC
- [x] Fire-and-forget no aplica — estas funciones no lanzan subprocesos
- [x] Strings IPC ASCII puro — los nuevos strings son `/v1/models` y `/api/tags`, todos ASCII 0x20-0x7E — evidencia: confirmado por inspeccion directa
- [x] Inputs validados — handleValidateProviderConnection ya tenia validacion de providerId en linea 618; el nuevo mapa no requiere validacion adicional

### Criterios de verificacion — todos cumplidos

1. **`/api/tags` ya no se asocia a lmstudio** — VERIFICADO
   - Evidencia: grep output: linea 604 es `p.id === 'lmstudio' ? '/v1/models' : '/api/tags'` — cuando p.id es lmstudio, el ternario resuelve a `/v1/models`, nunca a `/api/tags`
   - linea 633: `ollama: '/api/tags'` — solo en el mapa de ollama
   - linea 635: fallback `?? '/api/tags'` — solo si providerId no existe en el mapa (ni lmstudio ni ollama)
   - Grep de `lmstudio.*api/tags` en todo src/: una sola ocurrencia (linea 605) que confirma que lmstudio NO usa ese endpoint

2. **`/v1/models` aparece en ambas funciones** — VERIFICADO
   - Evidencia: grep output:
     - `handlerLogic.ts:604` — `p.id === 'lmstudio' ? '/v1/models' : '/api/tags'` (handleDetectLocalProviders)
     - `handlerLogic.ts:632` — `lmstudio: '/v1/models'` (handleValidateProviderConnection, mapa localEndpoints)
   - Las otras dos ocurrencias son en cloud providers (openai y gemini en lineas 658 y 673) — no relacionadas con el fix

3. **handleDetectLocalProviders retorna `available: true` para lmstudio si esta activo** — VERIFICADO por codigo
   - Evidencia: `handlerLogic.ts:604-607` — endpoint resuelve a `/v1/models` para lmstudio; `res.ok` es `true` si LM Studio responde 200; retorna `{ ...p, available: true }`

4. **handleValidateProviderConnection retorna `{ success: true }` para lmstudio** — VERIFICADO por codigo
   - Evidencia: `handlerLogic.ts:631-638` — `localEndpoints['lmstudio']` = `/v1/models`; `endpoint` = `/v1/models`; `fetch(localHost + '/v1/models')` con localHost = `http://127.0.0.1:1234`; retorna `{ success: res.ok }`

5. **Ollama sigue intacto** — VERIFICADO
   - handleDetectLocalProviders linea 604: ternario devuelve `/api/tags` cuando `p.id !== 'lmstudio'` (incluye ollama)
   - handleValidateProviderConnection linea 633: `ollama: '/api/tags'` en el mapa — sin cambio funcional

6. **TSC sobre handlerLogic.ts: 0 errores nuevos** — VERIFICADO
   - Evidencia: `bun run tsc --noEmit 2>&1 | grep "handlerLogic"` retorna vacio — cero errores en el archivo modificado

### No verificado por Max
- Ejecucion runtime en entorno real con LM Studio activo: entorno no disponible en la sesion de QA. La verificacion es por analisis estatico del codigo.

Confianza en la verificacion: alta

Requiere auditoria de Cipher: NO

---

## Metricas de Max (verificacion final)
- archivos_leidos: 3
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 0
- items_checklist_verificados: 6/6
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 1

---

QA aprobado con gaps conocidos: ejecucion runtime con LM Studio activo no verificable en este entorno. La logica del fix es correcta por analisis estatico — ambas funciones usan `/v1/models` para lmstudio y `/api/tags` para ollama, sin regresiones introducidas.
