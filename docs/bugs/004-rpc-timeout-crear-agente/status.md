# Bug #004 — RPC request timed out al crear un agente

## Status
`resolved`

## Reported
2026-03-08

## Description
Al intentar crear un agente desde la aplicación desktop (Electrobun), la solicitud RPC falla con el error "RPC request timed out".

## Reproduction steps
1. Abrir la app desktop (`bun run desktop`)
2. Completar el formulario de creación de agente
3. Confirmar la creación
4. Observar el error: "RPC request timed out"

## Expected behavior
El agente se crea exitosamente y aparece en la lista de agentes.

## Actual behavior
La solicitud RPC hace timeout antes de completarse.

## Environment
- Platform: Windows 11 Pro
- Runtime: Bun + Electrobun

## Diagnosis (Max)

**Causa raíz: `spawnSync` bloqueando el event loop del main process de Electrobun.**

### Flujo completo del bug

```
Renderer (create-agent.ts)
  └─ rpc.request.generateAgent(config)         [await — espera respuesta del main process]
       │
       ▼
Main process (handlers.ts → generateAgent handler)
  └─ await generateAgentCore(config, cwd)      [llamada async]
       │
       ▼
agentGenerator.ts → generateAgentCore()
  ├─ createDirectory / copyTemplateAndInject   [async OK]
  └─ spawnSync('bun', ['install'], ...)        ← BLOQUEO TOTAL
```

### Análisis detallado

El handler `generateAgent` en `src/ipc/handlers.ts` (línea 18) llama a `generateAgentCore()` que está definido en `src/generators/agentGenerator.ts`.

Dentro de `generateAgentCore()`, el último paso (línea 41) es:

```typescript
const result = spawnSync('bun', ['install'], { cwd: agentDir, stdio: 'pipe' });
```

`spawnSync` es una llamada **sincrónica y bloqueante** de Node.js/Bun. Congela completamente el hilo del main process de Electrobun mientras `bun install` corre. En un proyecto con dependencias reales (`@agentclientprotocol/sdk`, `@lmstudio/sdk`), esta operación tarda entre 5 y 30+ segundos en la primera ejecución, dependiendo de la red y la caché de Bun.

Electrobun implementa un timeout interno para las solicitudes RPC. Cuando el main process está bloqueado por `spawnSync`, es incapaz de procesar el tick del event loop que respondería al webview. El webview espera hasta que el timeout se dispara y lanza el error "RPC request timed out", aunque el `bun install` eventualmente pueda completarse.

### Archivo y línea exacta

- **Archivo:** `src/generators/agentGenerator.ts`, línea 41
- **Código problemático:** `spawnSync('bun', ['install'], { cwd: agentDir, stdio: 'pipe' })`
- **Contexto:** Solo existe en `generateAgentCore()`, la variante usada por el IPC. La variante CLI `generateAgent()` también usa `spawnSync` (línea 97) pero esto no causa timeout en CLI porque no hay un RPC handler esperando respuesta.

### Por qué no falla en el CLI

En el flujo CLI (`bun run dev`), `generateAgent()` corre directamente en el hilo principal del proceso de terminal. No hay ningún sistema de RPC con timeout esperando. El bloqueo es perceptible para el usuario (la terminal se congela) pero no causa fallo funcional.

### Verificación del timeout de Electrobun

El renderer en `src/renderer/views/create-agent.ts` (línea 62) hace:

```typescript
const result = await rpc.request.generateAgent({ ... });
```

Este `await` espera la resolución del IPC. Si el main process no responde dentro del timeout de Electrobun (configurado internamente por el framework, generalmente 5–10 segundos), el SDK del webview rechaza la promesa con "RPC request timed out".

### Lo que debe corregir Cloe

**En `src/generators/agentGenerator.ts`, función `generateAgentCore()`:**

Reemplazar `spawnSync` por su equivalente asíncrono no bloqueante. Las opciones son:

1. **Opción preferida — usar `spawn` de Bun con una Promise:**
   Envolver `spawn` (o `Bun.spawn`) en una Promise que resuelva cuando el proceso hijo emita `close`, capturando el exit code. Esto devuelve el control al event loop de Electrobun mientras `bun install` corre en segundo plano.

2. **Opción alternativa — usar `execa` o el helper async de `child_process`:**
   `child_process.spawn` con Promise wrapper, o la API `promisify` sobre `execFile`.

**Importante:** La función `generateAgent()` (variante CLI, líneas 47–114) también usa `spawnSync`. Aunque no causa el bug reportado, Cloe debería evaluar unificarla o dejarla intacta según el contrato definido en CLAUDE.md ("Do NOT modify `src/index.ts`, `src/client.ts`"). La función CLI no está en la lista de archivos protegidos, pero el cambio en `generateAgentCore` es el fix mínimo y suficiente.

**Restricción:** `generateAgentCore` es la única función que el IPC invoca. El fix debe quedar dentro de esa función. No es necesario tocar `handlers.ts`, `acpManager.ts`, ni el renderer.

## Fix (Cloe)

**Fecha:** 2026-03-08
**Archivo modificado:** `src/generators/agentGenerator.ts`

**Cambio realizado:** Reemplazado `spawnSync('bun', ['install'], ...)` en `generateAgentCore()` (línea 41) por `Bun.spawn` envuelto en una Promise que resuelve con el exit code cuando el proceso hijo termina.

```typescript
// Antes (bloqueante)
const result = spawnSync('bun', ['install'], { cwd: agentDir, stdio: 'pipe' });
if (result.status !== 0) {
  throw new Error('bun install failed in agent directory');
}

// Después (no bloqueante)
const exitCode = await new Promise<number>((resolve) => {
  const proc = Bun.spawn(['bun', 'install'], {
    cwd: agentDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.exited.then(resolve);
});
if (exitCode !== 0) {
  throw new Error('bun install failed in agent directory');
}
```

**Por qué funciona:** `Bun.spawn` lanza el proceso hijo de forma no bloqueante. La Promise se resuelve cuando el proceso hijo cierra (via `proc.exited`), devolviendo el control al event loop de Electrobun mientras `bun install` corre. Esto permite que el main process siga procesando ticks del IPC y responda al webview sin disparar el timeout de RPC.

**Restricciones respetadas:**
- Solo se modificó `generateAgentCore()`. La variante CLI `generateAgent()` (línea 97) conserva su `spawnSync` intacto.
- El import de `child_process` se mantiene porque `generateAgent()` lo sigue usando.
- El comportamiento es idéntico: si `bun install` retorna exit code distinto de 0, se lanza el mismo error.

## Verification (Max)

**Fecha:** 2026-03-08
**Veredicto: APROBADO**

### Puntos verificados

**1. `generateAgentCore()` ya no usa `spawnSync` — CORRECTO**

El bloque de instalacion de dependencias en `generateAgentCore()` (lineas 41-50) usa `Bun.spawn` con `proc.exited.then(resolve)` dentro de una Promise wrapper. El `await` sobre esa Promise devuelve el control al event loop entre ciclos, eliminando el bloqueo que causaba el timeout RPC.

**2. Exit code validado — CORRECTO**

```typescript
if (exitCode !== 0) {
  throw new Error('bun install failed in agent directory');
}
```

El comportamiento de error es identico al original: si `bun install` falla, se lanza una excepcion que el handler IPC puede capturar y propagar al renderer.

**3. `generateAgent()` (variante CLI) no fue tocada — CORRECTO**

La funcion `generateAgent()` en lineas 53-120 conserva su `spawnSync` en linea 103. El CLI no tiene RPC con timeout, por lo que esta variante no requeria cambios y el contrato de CLAUDE.md queda intacto.

**4. Sin regresiones — CORRECTO**

- El import de `spawnSync` en linea 2 permanece necesario: lo usa `generateAgent()`. No es codigo muerto.
- Los pasos previos de `generateAgentCore()` (createDirectory, copyTemplateAndInject, writeFile) son identicos al original.
- La firma de la funcion `async (config, baseDir): Promise<void>` no cambio.

### Observacion de estilo (no bloqueante)

El patron `proc.exited.then(resolve)` dentro del constructor de la Promise es funcionalmente identico a hacer `const exitCode = await proc.exited` directamente sin el wrapper. Ambas formas son correctas. La variante de Cloe es mas verbosa pero no introduce riesgo.

### Archivos no modificados (confirmado)
- `src/ipc/handlers.ts` — sin cambios, no necesario
- `src/ipc/acpManager.ts` — sin cambios, no necesario
- `src/renderer/` — sin cambios, no necesario

### Conclusion

El fix es minimo, preciso y correcto. Resuelve la causa raiz (bloqueo sincrono del event loop) sin tocar la variante CLI ni ningun otro archivo. No se detectaron regresiones.

## Security implications
_None identified._
