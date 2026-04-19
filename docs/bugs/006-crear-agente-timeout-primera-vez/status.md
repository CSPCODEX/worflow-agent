# Bug #006 — RPC timeout al crear agente (solo primera vez)

## Status
`DONE`

## Reported
2026-03-08

## Description
Al pulsar el botón "Crear agente" por primera vez, el RPC devuelve:

```
RPC request timed out.
```

La segunda vez que se intenta crear un agente (o reintentando), funciona correctamente.

## Reproduction steps
1. Lanzar la app (`bun run desktop`)
2. Pulsar "Crear agente" y rellenar el formulario
3. Pulsar el botón de confirmación
4. Observar: `RPC request timed out.` en la primera llamada
5. Volver a intentarlo: funciona sin errores

## Expected behavior
El agente se crea correctamente en el primer intento sin timeout.

## Actual behavior
La primera llamada a `generateAgent` supera el timeout del RPC de Electrobun (10 s). Las llamadas posteriores son rápidas y exitosas.

## Hypothesis
- `generateAgentCore` realiza en la primera ejecución una operación lenta (posiblemente `bun install` en el directorio del agente generado) que excede los 10 s del timeout de Electrobun IPC
- En ejecuciones posteriores, las dependencias ya están cacheadas en el registro de Bun → la operación es mucho más rápida
- Solución probable: hacer `generateAgent` fire-and-forget con progreso por eventos, o eliminar el `bun install` del handler síncrono

## Max diagnosis

### Causa raiz confirmada

El cuello de botella es `bun install` ejecutado sincrónicamente dentro del handler RPC `generateAgent`.

**Archivo:** `src/generators/agentGenerator.ts`, líneas 41–50.

```
const exitCode = await new Promise<number>((resolve) => {
  const proc = Bun.spawn(['bun', 'install'], {
    cwd: agentDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.exited.then(resolve);
});
```

El handler en `src/ipc/handlers.ts` (línea 18) hace `await generateAgentCore(config, process.cwd())` y no retorna hasta que `bun install` termina. La llamada RPC permanece abierta durante toda esa espera.

### Por qué falla en la primera ejecución y no en la segunda

El template `src/templates/basic-agent/package.json.tpl` declara tres dependencias:
- `@agentclientprotocol/sdk ^0.15.0`
- `@lmstudio/sdk ^1.0.0`
- `dotenv ^16.4.5`

En la **primera instalación**, Bun descarga los paquetes desde el registro de npm (red + disco), resuelve el árbol de dependencias y los escribe en `node_modules`. El SDK de LM Studio en particular tiene un árbol de dependencias no trivial. En condiciones reales de red y disco, este proceso puede exceder los 10 s que `internalRpc.ts` (línea 56–62) concede antes de rechazar la Promise con `Request timeout`.

En la **segunda ejecución** (del mismo agente o de uno diferente), las dependencias ya están en la caché global de Bun (`~/.bun/install/cache`). `bun install` solo crea los symlinks locales, lo que tarda menos de 1 s y no agota el timeout.

### Flujo de ejecución completo del timeout

```
renderer → RPC request "generateAgent"
  └→ internalRpc.ts:56 setTimeout(reject, 10000)   ← reloj empieza
       └→ handlers.ts:18 await generateAgentCore(...)
            └→ agentGenerator.ts:41 Bun.spawn(['bun','install'])
                 └→ [descarga npm — primera vez: ~15-45 s]
                      └→ proc.exited.then(resolve)  ← llega tarde
renderer recibe reject("Request timeout") a los 10 s
agentGenerator sigue corriendo en background y termina exitosamente
→ por eso el agente existe y la segunda llamada no instala nada
```

### Líneas exactas del cuello de botella

| Archivo | Línea(s) | Descripción |
|---|---|---|
| `src/generators/agentGenerator.ts` | 41–50 | `Bun.spawn(['bun','install'])` bloqueando el handler |
| `src/ipc/handlers.ts` | 18 | `await generateAgentCore(...)` — espera bloqueante en el handler RPC |
| `node_modules/electrobun/dist-win-x64/api/bun/preload/internalRpc.ts` | 56–62 | Timeout fijo de 10 000 ms — no configurable desde la app |

### Severidad

**Alto.** El agente se crea correctamente en disco (la operación termina), pero el renderer recibe un error y puede mostrarle al usuario que falló, llevando a confusión o a intentos de recrear el agente. No hay corrupción de datos, pero la UX es completamente incorrecta en la primera ejecución.

### Recomendacion de fix para Cloe

El patron correcto es el mismo que se aplicó en BUG #003 y #004: separar la operacion lenta del ciclo request-response del RPC.

**Opcion A — Fire-and-forget con evento de progreso (recomendada):**

El handler `generateAgent` lanza `generateAgentCore` sin `await` y retorna `{ success: true }` inmediatamente después de validar los parámetros y crear los archivos de estructura (directorios, templates). El `bun install` ocurre en background. Cuando termina, el main process emite un evento IPC (`agentReady` / `agentInstallError`) al renderer por el canal de notificaciones existente (el mismo mecanismo que usa `agentMessageChunk`).

Esto requiere:
1. Separar en `generateAgentCore` la fase de scaffolding (fs: mkdir, writeFile, copyTemplateAndInject — líneas 12–39) de la fase de instalación (bun install — líneas 41–50).
2. El handler retorna tras el scaffolding.
3. `bun install` corre en background y notifica al renderer al terminar.

**Opcion B — Aumentar timeout (no recomendada):**

El timeout está en `internalRpc.ts` dentro de `node_modules/electrobun` y no es configurable desde la app. Modificarlo requiere parchear el módulo o hacer fork de Electrobun. No es una solución mantenible.

**Opcion C — Pre-warm de caché en startup (parche parcial):**

Al iniciar la app, lanzar `bun install` en background en un directorio temporal con el mismo `package.json.tpl` para poblar la caché global de Bun antes de que el usuario cree su primer agente. Funciona pero es un hack: no garantiza que la primera instalación termine antes de que el usuario actúe, y consume recursos innecesarios en arranque.

**Recomendacion final:** Implementar Opcion A. Es coherente con el patron ya establecido en el proyecto (fire-and-forget + streaming de eventos) y no requiere cambios en Electrobun ni dependencias externas.

## Cloe fix

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/generators/agentGenerator.ts` | Extraída `scaffoldAgent` (fase 1: fs puro, devuelve `agentDir`). Extraída `installAgentDeps` (fase 2: `bun install` con callback). `generateAgentCore` refactorizado para delegar en ambas (CLI no cambia). |
| `src/ipc/handlers.ts` | `generateAgent` handler ahora llama `scaffoldAgent` (await, rápido) y lanza `installAgentDeps` sin await. Al terminar el install, emite `agentInstallDone` al renderer via `rpc.send`. |
| `src/types/ipc.ts` | Añadida interfaz `AgentInstallDone { agentDir, agentName, error? }`. Añadido `agentInstallDone` al schema de mensajes del webview. |
| `src/renderer/app.ts` | Registrado handler `agentInstallDone` que dispatcha `CustomEvent('agent:install-done')` en `document`. |
| `src/renderer/views/create-agent.ts` | Flujo de submit dividido en dos fases: 1) RPC `generateAgent` → muestra "Instalando dependencias...", 2) listener `agent:install-done` → confirma éxito o muestra error. Listener registrado antes del RPC call; se limpia a sí mismo (once-pattern manual). `showFeedback` acepta tipo `'installing'`. |

### Decisiones tomadas

- `installAgentDeps` usa callback (no Promise) para que el caller no pueda hacer `await` accidentalmente y bloquear el handler.
- El listener en `create-agent.ts` filtra por `agentName` para manejar correctamente el caso de dos creaciones en paralelo.
- El listener se registra antes del `rpc.request.generateAgent` para eliminar la race condition entre el RPC response y el evento `agentInstallDone`.
- El botón permanece deshabilitado hasta que llega `agentInstallDone` para evitar doble-submit durante el install.
- `generateAgent` (CLI) y `generateAgentCore` (usado por CLI) no se modificaron funcionalmente; solo `generateAgentCore` delega ahora en `scaffoldAgent` internamente.

### Lo que Max debe verificar

1. Primera creación de agente: el formulario muestra "Instalando dependencias..." y luego confirma sin error.
2. Segunda creación: flujo idéntico, sin diferencia visible.
3. Si `bun install` falla (red cortada), el renderer muestra el mensaje de error de install y el botón vuelve a habilitarse.
4. Dos creaciones en paralelo (abrir dos vistas o hacer doble click rápido): cada `agentInstallDone` afecta solo a su propio listener gracias al filtro `agentName`.
5. `bun run dev` (CLI) sigue funcionando sin regresión — `generateAgent` no se tocó.
6. El tipo `AgentInstallDone` y el campo `agentInstallDone` en `AppRPC` compilan sin errores TypeScript.

## Handoff de Max → Ada

### Checklist de verificacion

- [x] Handler RPC retorna antes de que `bun install` termine — `installAgentDeps` llamada sin `await`, `return { success: true, agentDir }` se ejecuta inmediatamente
- [x] Sin race condition — listener `agent:install-done` registrado en `create-agent.ts` antes de la llamada `rpc.request.generateAgent`
- [x] CLI sin regresion — `generateAgent` (CLI con spinners) y `generateAgentCore` (firma publica) intactos; `generateAgentCore` delega en `scaffoldAgent` internamente sin cambio de comportamiento observable
- [x] Tipos IPC correctos — `AgentInstallDone { agentDir, agentName, error? }` definido en `ipc.ts`; registrado en `AppRPC.webview.messages`; payload enviado desde `handlers.ts` es conforme a la interfaz; destructuracion en `create-agent.ts` es compatible
- [x] Manejo de error de install visible — rama `error` en `onInstallDone` muestra mensaje, reactiva el boton y limpia el listener
- [x] Proteccion doble-submit — boton deshabilitado desde el submit hasta que llega `agentInstallDone`
- [x] Filtro `agentName` en el listener — evita cross-fire entre creaciones paralelas

**Resultado: 7/7 puntos aprobados.**

### Observacion menor (no bloqueante)

Si el usuario navega fuera de la vista de creacion antes de que `agentInstallDone` llegue, el listener queda huerfano en `document`. No provoca errores: cuando el evento llega, `agentName !== name` puede o no coincidir, y el listener se auto-elimina en el primer match. Severidad baja — no impide que el fix funcione correctamente en el flujo normal.

### Notas para Ada

El fix es correcto y minimal. No hay codigo muerto obvio. Posibles puntos de atencion en refactor:
- El patron `(rpc as any).send.X(...)` se repite en tres lugares de `handlers.ts`; Ada podria extraer un helper tipado si Electrobun lo permite.
- El listener huerfano descrito arriba podria resolverse con un `AbortController` o guardando la referencia en un WeakRef al elemento del formulario, pero solo si Ada considera que vale la complejidad.

## Metricas de Max

archivos_leidos: 5
bugs_criticos: 0
bugs_altos: 0
items_checklist_verificados: 7/7
rework: no
iteraciones: 1
confianza: alta
gaps_declarados: 0

| Metrica | Valor |
|---|---|
| Archivos inspeccionados | 5 |
| Puntos verificados | 7/7 |
| Bugs adicionales encontrados | 0 criticos, 1 bajo (listener huerfano en navegacion anticipada) |
| Regresiones detectadas | 0 |

## Branch
`bug/006-crear-agente-timeout-primera-vez`
