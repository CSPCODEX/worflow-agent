# Bug #020 — [SEGURIDAD] openExternal acepta protocolos arbitrarios del renderer sin validación

Estado: RESUELTO
Rama: feature/dev
Fecha apertura: 2026-04-19
Fecha cierre: 2026-04-19

---

## Info del bug

**Descripcion:** src/ipc/handlers.ts líneas 268-275: el handler openExternal recibe una URL del renderer y la pasa directamente a Utils.openExternal() sin validar el protocolo. Un atacante con ejecución en el webview puede invocar protocolos del OS arbitrarios: file:///etc/passwd, smb://attacker.com/share, javascript:... Esto es un bloqueante de release según Cipher (único issue no aceptado).

**Como reproducir:**
1. Desde el renderer, invocar el handler openExternal con url='file:///etc/passwd'
2. Observar que el OS intenta abrir el archivo directamente
3. Probar con smb://attacker.com/share para verificar que también se acepta

**Comportamiento esperado:** Solo URLs con protocolo http:// y https:// son permitidas. Cualquier otro protocolo retorna `{ success: false }`.

**Comportamiento actual:** Cualquier protocolo es aceptado y pasado directamente al OS, permitiendo la apertura de archivos locales, recursos SMB, y potencialmente otros vectores de ataque.

**Severidad:** ALTA

**Tiene implicaciones de seguridad:** SI

---

## Diagnóstico de Max

### Evidencia confirmada

**Archivo afectado — única superficie de ataque:**

`src/ipc/handlers.ts:268-275` — handler `openExternal` pasa la URL sin validación:

```typescript
openExternal: async (params: { url: string }) => {
  try {
    Utils.openExternal(params.url);   // ← cualquier protocolo llega aquí
    return { success: true };
  } catch (e: any) {
    return { success: false };
  }
},
```

**Llamadas desde el renderer (todas usan https:// hardcodeadas — no son el vector):**
- `src/renderer/views/onboarding.ts:174` — `openExternal({ url: 'https://lmstudio.ai' })`
- `src/renderer/views/onboarding.ts:179` — `openExternal({ url: 'https://ollama.com' })`
- `src/renderer/views/settings.ts:402` — `openExternal({ url: 'https://flowteam.dev/docs' })`

Estas llamadas son seguras en el código actual, pero el handler no protege contra una llamada arbitraria desde el webview comprometido. La validación debe estar en el handler (main process), no en el caller (renderer).

**Contrato IPC:**
`src/types/ipc.ts:516` — `openExternal: { params: { url: string }; response: { success: boolean } }` — el tipo acepta cualquier string; no requiere cambio de tipo, la validación es de runtime.

**No hay otros puntos de llamada a `Utils.openExternal` en el codebase** — confirmado con grep de `openExternal|Utils\.openExternal` en `src/`.

### Causa raíz

El handler confía en que el renderer enviará solo URLs legítimas. En un modelo de seguridad correcto para apps Electron/Electrobun, el main process debe validar todo input del renderer como si fuera untrusted. Un XSS en el webview o cualquier inyección de código en el renderer puede invocar este handler con `file://`, `smb://`, `javascript:` o cualquier protocolo del OS.

### Fix exacto a implementar

En `src/ipc/handlers.ts`, reemplazar el handler `openExternal` (líneas 268-275) con:

```typescript
openExternal: async (params: { url: string }) => {
  try {
    const parsed = new URL(params.url);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      return { success: false };
    }
    Utils.openExternal(params.url);
    return { success: true };
  } catch {
    return { success: false };
  }
},
```

El bloque `try/catch` existente ya captura `new URL()` cuando la URL está malformada — el catch retorna `{ success: false }`, que es el comportamiento correcto. Solo se añade la comprobación de protocolo dentro del try, antes de llamar a `Utils.openExternal`.

**No requiere cambios en:**
- `src/types/ipc.ts` — el contrato `{ url: string }` se mantiene
- `src/renderer/views/onboarding.ts` — las URLs son hardcodeadas con https://
- `src/renderer/views/settings.ts` — la URL es hardcodeada con https://

**Scope del cambio: 1 archivo, 1 bloque de ~8 líneas.**

---

## Handoff Max → Cloe

**Causa raiz identificada:** El handler `openExternal` en `src/ipc/handlers.ts:268-275` no valida el protocolo de la URL recibida antes de invocar `Utils.openExternal()`. Cualquier string es aceptado sin restricción.

**Archivos a modificar:**
- `src/ipc/handlers.ts` — líneas 268-275 (único cambio necesario)

**Fix exacto a implementar:**

Reemplazar el handler completo (líneas 268-275) por:

```typescript
openExternal: async (params: { url: string }) => {
  try {
    const parsed = new URL(params.url);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      return { success: false };
    }
    Utils.openExternal(params.url);
    return { success: true };
  } catch {
    return { success: false };
  }
},
```

**Criterios de verificación para Max (post-fix):**
1. `openExternal({ url: 'https://example.com' })` retorna `{ success: true }`
2. `openExternal({ url: 'http://example.com' })` retorna `{ success: true }`
3. `openExternal({ url: 'file:///etc/passwd' })` retorna `{ success: false }` sin abrir el archivo
4. `openExternal({ url: 'smb://attacker.com' })` retorna `{ success: false }`
5. `openExternal({ url: 'javascript:alert(1)' })` retorna `{ success: false }`
6. `openExternal({ url: 'not-a-url' })` retorna `{ success: false }` (URL malformada — capturada por catch)
7. `bun run tsc --noEmit` — 0 errores nuevos tras el cambio

**Nota:** Los tres call-sites del renderer (`onboarding.ts:174`, `onboarding.ts:179`, `settings.ts:402`) usan URLs https:// hardcodeadas y no requieren cambio — seguirán funcionando correctamente.

→ Siguiente: @cloe Implementa el fix del bug #020. El único cambio necesario es en `src/ipc/handlers.ts` líneas 268-275: añadir validación de protocolo antes de llamar a `Utils.openExternal()`. El fix exacto está documentado en `docs/bugs/020-openexternal-sin-validacion-protocolo/status.md`.

---

## Handoff Cloe → Max

**Fix implementado:** Validacion de protocolo en el handler `openExternal` — unico cambio, archivo unico, bloque unico.

### Descripcion del cambio

En `src/ipc/handlers.ts` lineas 268-279: se anade `new URL(params.url)` para parsear la URL recibida, se verifica que el protocolo sea exactamente `'https:'` o `'http:'`, y se retorna `{ success: false }` para cualquier otro protocolo. La variable `e: any` del catch se elimina ya que no se usa (catch sin binding). URL malformada sigue siendo capturada por el catch existente y retorna `{ success: false }`.

### Manifiesto de archivos

| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| `src/ipc/handlers.ts` | modificado | 268-279 |

### Checklist Cloe

- [x] Manifiesto completo: 1 archivo modificado, lineas 268-279
- [x] Tipos TypeScript implementados segun contrato de Max — sin cambio de tipos, validacion de runtime
- [x] bun run tsc --noEmit ejecutado — 0 errores en handlers.ts (errores preexistentes en src/db/ no relacionados)
- [x] Strings que viajan por IPC son ASCII puro — solo se anade logica de validacion, no strings nuevos
- [x] Fix quirurgico: solo el handler openExternal, ningun otro archivo tocado
- [x] Sin `any` — se elimino el `e: any` innecesario del catch original
- [x] No hay labels HTML ni vistas nuevas — no aplica el check CSS

### Auto-verificacion

```
# Check 1 — chars no-ASCII en el handler modificado
grep -Pn "[^\x00-\x7E]" src/ipc/handlers.ts → 0 matches (solo comentarios en español preexistentes)

# Check 2 — TypeScript
bun run tsc --noEmit → 0 errores en handlers.ts (errores preexistentes en scripts/ y src/db/, sin relacion con este fix)
```

### Gaps y dudas de Cloe

Sin gaps porque: cambio de 5 lineas en un handler aislado, sin nueva logica de negocio, tsc limpio en el archivo modificado, validacion identica al fix documentado por Max.

Confianza en la implementacion: alta

---

## Metricas de Cloe

- archivos_leidos: 2
- archivos_creados: 0
- archivos_modificados: 1
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

Sin gaps porque: cambio de 5 lineas en un handler aislado, tsc limpio en el archivo modificado, logica identica al fix documentado por Max.

---

## Verificacion final de Max

### Checklist Max — [bloques activos: ESTATICO | IPC]

## ESTATICO (siempre obligatorio)
- [x] Archivo del manifiesto verificado con file:line — evidencia: `src/ipc/handlers.ts:268-279` leido directamente, diff confirmado con `git diff`
- [x] bun run tsc --noEmit — 0 errores nuevos — evidencia: todos los errores son preexistentes en `scripts/`, `node_modules/electrobun/`, `src/db/` (no tocados por este fix); `src/ipc/handlers.ts` limpio
- [x] Sin logica de negocio rota en archivos modificados — evidencia: handlers adyacentes `encryptApiKey` (linea 281), `getPipelineSnapshot` (286), `getHistory` (291) verificados — sin cambios, sin regresiones

## IPC (cambios en src/ipc/handlers.ts)
- [x] Inputs validados antes de filesystem ops o spawn — evidencia: `src/ipc/handlers.ts:270-273` — `new URL()` + whitelist de protocolo antes de cualquier llamada a `Utils.openExternal()`
- [x] Strings IPC son ASCII puro — evidencia: `grep -Pn "[^\x00-\x7E]" src/ipc/handlers.ts` → 0 matches en codigo activo (solo comentarios en espanol preexistentes)
- [x] Fire-and-forget no aplica — handler retorna `{ success: boolean }` sincrono, no lanza subprocesos

### Criterios de verificacion documentados (7/7 verificados)

Verificacion ejecutada mediante simulacion de la logica identica al codigo implementado:

| Criterio | URL | Resultado esperado | Resultado obtenido | Estado |
|----------|-----|-------------------|-------------------|--------|
| 1 | `https://example.com` | `{ success: true }` | `{ success: true }` | PASS |
| 2 | `http://example.com` | `{ success: true }` | `{ success: true }` | PASS |
| 3 | `file:///etc/passwd` | `{ success: false }` | `{ success: false }` | PASS |
| 4 | `smb://attacker.com` | `{ success: false }` | `{ success: false }` | PASS |
| 5 | `javascript:alert(1)` | `{ success: false }` | `{ success: false }` | PASS |
| 6 | `not-a-url` | `{ success: false }` | `{ success: false }` | PASS |
| 7 | tsc --noEmit | 0 errores nuevos | 0 errores nuevos | PASS |

Evidencia criterio 7: output de `bun run tsc --noEmit` — ningun error en `src/ipc/handlers.ts`; errores en `scripts/metrics.ts`, `scripts/verify-monitor.ts`, `src/db/`, `node_modules/electrobun/` son preexistentes y no relacionados con el fix.

### Observacion sobre agentRepository.ts

El git status muestra `src/db/agentRepository.ts` como modificado. El diff confirma que es un cambio independiente del bug #020: corrige `.get([name])` → `.get(name)` en queries SQLite y protege `existsSync` para agentes `is_default`. No fue introducido por Cloe y no constituye regresion del fix verificado.

### No verificado por Max

- Ejecucion en runtime real con Electrobun levantado: entorno de escritorio no disponible en este contexto. La verificacion se realizo mediante simulacion de la logica identica.

Confianza en la verificacion: alta

---

## Handoff Max → Cipher

**Fix verificado:** El handler `openExternal` en `src/ipc/handlers.ts:268-279` implementa correctamente la validacion de protocolo. Los 7 criterios documentados pasan. Sin regresiones detectadas.

**Requiere auditoria de Cipher: SI** — bug de seguridad (protocolo arbitrario desde renderer), fix resuelve el unico issue bloqueante identificado por Cipher en el ciclo anterior.

**Archivos modificados por el fix:**
- `src/ipc/handlers.ts` lineas 268-279 — unico cambio

**Alcance de auditoria sugerido para Cipher:**
1. Confirmar que la whitelist `['https:', 'http:']` es suficiente y no requiere agregar `'ftp:'` u otros
2. Verificar que `new URL()` en Node/Bun se comporta como esperado para `javascript:alert(1)` (protocolo = `'javascript:'`)
3. Confirmar que no existen otros handlers en `src/ipc/handlers.ts` o `src/ipc/handlerLogic.ts` que llamen a APIs del OS con input no validado del renderer

---

## Metricas de Max (verificacion final)

- archivos_leidos: 4
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 0
- items_checklist_verificados: 6/6
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 1

---

## Auditoria Cipher — Bug #020

### Checklist Cipher

- [x] Sin secrets en codigo fuente — evidencia: ningun secret introducido por el fix; unico cambio es logica de validacion de protocolo en `src/ipc/handlers.ts:268-279`
- [x] .env en .gitignore y no commiteado — evidencia: no aplica a este fix; no se crearon ni modificaron archivos .env
- [x] agentName validado con /^[a-z0-9-]+$/ antes de path.join — evidencia: `src/ipc/handlerLogic.ts:98` — `validateAgentName(config.name)` antes de scaffoldAgent; `src/ipc/handlerLogic.ts:206` — `validateAgentName(params.agentName.trim())` antes de createSession. No afectado por este fix.
- [x] Inputs del webview validados antes de filesystem ops — evidencia: `src/ipc/handlers.ts:270-273` — `new URL(params.url)` + whitelist `['https:', 'http:']` antes de `Utils.openExternal()`. Es exactamente el fix auditado.
- [x] Spawn de agentes usa rutas absolutas, no interpolacion de user input — evidencia: `src/ipc/acpManager.ts:41-42` — `agentEntry = path.join(agentDir, 'index.ts')` donde `agentDir` viene de `agent.path` (dato de DB, no del renderer); spawn usa array `['run', agentEntry]` sin interpolacion de input del renderer.
- [x] Sin innerHTML con user input sin sanitizar — evidencia: el fix no toca ningun renderer; los call-sites del renderer (`onboarding.ts:174,179`, `settings.ts:402`) usan URLs literales hardcodeadas, no input del usuario.
- [x] DevTools deshabilitados en build de produccion — evidencia: no afectado por este fix; estado previo verificado en auditoria MVP-audit-completo 2026-04-19.
- [x] CSP configurado en el webview — evidencia: no afectado por este fix; CSP verificada en auditoria devtools-csp-produccion 2026-03-14.
- [x] No se expone process.env completo al renderer via IPC — evidencia: no afectado por este fix; el handler openExternal retorna solo `{ success: boolean }`, ningun dato del entorno.
- [x] Cierre limpio de subprocesos al cerrar la app — evidencia: no afectado por este fix; openExternal no lanza subprocesos.

### Verificacion de la whitelist ['https:', 'http:']

**Pregunta 1 — Es suficiente la whitelist?**

Si. El modelo de amenaza es: renderer comprometido intentando invocar protocolos del OS (file:, smb:, javascript:, ftp:, mailto:, etc.). La whitelist `['https:', 'http:']` cubre el unico uso legitimo de `openExternal` en este proyecto: abrir URLs de documentacion externa en el navegador del sistema. `ftp:` NO debe incluirse — ninguno de los tres call-sites lo usa y exponer FTP amplía la superficie sin beneficio.

**Pregunta 2 — Se comporta new URL() correctamente para javascript:alert(1)?**

Si. El estandar WHATWG URL (implementado por Node.js y Bun) parsea `javascript:alert(1)` con `protocol = 'javascript:'`. No esta en la whitelist, retorna `{ success: false }`. Confirmado por comportamiento documentado de Node.js URL API (identico al de navegadores).

**Pregunta 3 — Existen otros handlers en src/ipc/ que llamen APIs del OS con input no validado?**

Auditado `src/ipc/handlers.ts` y `src/ipc/handlerLogic.ts` completos. Resultado:
- `Utils.openExternal` — unica llamada en `handlers.ts:274`, ahora protegida.
- `rmSync` — `handlerLogic.ts:125,257` — opera sobre `agentDir` derivado de `scaffoldAgent()` o `agent.path` (DB), nunca input directo del renderer.
- `mkdirSync` — `handlerLogic.ts:108` — opera sobre `AGENTS_DIR` (constante del proceso), no input del renderer.
- `spawn('bun', ['run', agentEntry])` — `acpManager.ts:67` — `agentEntry` es `path.join(agentDir, 'index.ts')` donde `agentDir` viene de `agent.path` (DB). El agentName que llega del renderer se valida con `/^[a-z0-9-]+$/` antes de usarse en cualquier path.
- No hay otras llamadas a APIs del OS con input directo del renderer en estos archivos.

### Verificacion del diff

`git diff HEAD~1 src/ipc/handlers.ts` confirma exactamente el fix documentado:
- Se añaden 4 lineas: `const parsed = new URL(params.url)`, guard de whitelist, y `return { success: false }`
- Se elimina `e: any` del catch (mejora de codigo — sin impacto en seguridad)
- Ningun otro handler tocado

### Riesgos aceptados por Cipher

Ninguno nuevo introducido por este fix. Los riesgos aceptados del ciclo anterior de auditoria MVP se mantienen sin cambio.

Confianza en la auditoria: alta

---

## Metricas de Cipher

- archivos_leidos: 5
- vulnerabilidades_criticas: 0
- vulnerabilidades_altas: 0
- vulnerabilidades_medias: 0
- vulnerabilidades_bajas: 0
- riesgos_aceptados: 0
- items_checklist_verificados: 10/10
- decision: APROBADO
- confianza: alta
- gaps_declarados: 0

---

Estado final: CERRADO — Cipher: APROBADO
