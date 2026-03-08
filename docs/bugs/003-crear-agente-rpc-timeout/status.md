# Bug #003 — "Crear agente" produce RPC request timed out

Estado: EN PROGRESO
Rama: bug/003-crear-agente-rpc-timeout
Fecha apertura: 2026-03-07

---

## Info del bug

**Descripcion:** Al pulsar el botón "Crear agente" en la interfaz desktop, la operación falla con el error "RPC request timed out." en lugar de crear el agente exitosamente.

**Como reproducir:**
1. Arrancar la app con `bun run desktop`
2. Pulsar "Nuevo agente" en la barra lateral
3. Rellenar los campos: Nombre, Descripción, System Prompt
4. Pulsar "Crear agente"
5. Observar que el formulario muestra "RPC request timed out." tras el timeout del IPC

**Comportamiento esperado:** El agente se crea en disco, `bun install` se ejecuta en el directorio del agente, y el renderer recibe `{ success: true, agentDir: "..." }` con el mensaje "Agente creado correctamente."

**Comportamiento actual:** El renderer espera la respuesta del RPC request `generateAgent` pero nunca la recibe dentro del timeout. La operación aborta con "RPC request timed out." El directorio del agente puede haber quedado parcialmente creado en disco.

**Severidad:** ALTA — el flujo principal de la aplicación (crear agente) es completamente inutilizable desde la UI desktop.

**Tiene implicaciones de seguridad:** NO — el bug es funcional, no expone datos ni rutas de ejecución privilegiadas.

---

## Handoff Max → Cloe

> Causa raiz identificada y fix propuesto. Cloe implementa.

**Causa raiz identificada:**

`generateAgentCore` en `src/generators/agentGenerator.ts` (linea 41) llama a `spawnSync('bun', ['install'])`. `spawnSync` es síncrono y bloquea el hilo principal de Bun (el proceso Electrobun) durante toda la ejecución de `bun install`.

El handler RPC `generateAgent` en `src/ipc/handlers.ts` llama a `await generateAgentCore(...)`, pero el `await` no tiene efecto sobre código síncrono bloqueante — `spawnSync` bloquea el event loop antes de que Electrobun pueda procesar y enviar la respuesta IPC.

Mientras el hilo está bloqueado, Electrobun no puede despachar la respuesta al renderer. El renderer espera con un timeout de IPC configurado por Electrobun (< 30 s típicamente), y `bun install` en un directorio nuevo con dependencias de red puede tardar ese tiempo o más, especialmente en primera instalación o conexión lenta.

Resultado: el renderer agota el timeout y rechaza la Promise con "RPC request timed out." antes de que `spawnSync` retorne.

**Archivos involucrados:**

- `src/generators/agentGenerator.ts` — linea 41: `spawnSync('bun', ['install'], ...)` dentro de `generateAgentCore`
- `src/ipc/handlers.ts` — handler `generateAgent` que llama a `generateAgentCore`

**Fix propuesto:**

Sustituir `spawnSync` por `spawn` de forma async dentro de `generateAgentCore`. La función ya es `async`, por lo que basta envolver el spawn en una Promise que resuelva cuando el proceso termine (exit code 0) o rechace si falla.

Patron correcto:

```typescript
// En generateAgentCore, reemplazar spawnSync por:
await new Promise<void>((resolve, reject) => {
  const proc = spawn('bun', ['install'], { cwd: agentDir, stdio: 'pipe' });
  proc.on('close', (code) => {
    if (code === 0) resolve();
    else reject(new Error('bun install failed in agent directory'));
  });
  proc.on('error', reject);
});
```

Importar `spawn` (no `spawnSync`) desde `'child_process'`. El import de `spawnSync` puede eliminarse si no se usa en otro lugar del archivo (en `generateAgent` CLI también usa `spawnSync`, así que mantener ambos imports o cambiar solo el usado por `generateAgentCore`).

**Reglas que Cloe debe respetar:**

- No romper el flujo CLI existente (`bun run dev`, `bun run chat`) — `generateAgent` (la version con spinners para CLI) puede seguir usando `spawnSync` o migrarse también, pero no debe quedar roto.
- Solo modificar `generateAgentCore` — es la función que usa el IPC handler. La función `generateAgent` (CLI) puede actualizarse opcionalmente si Cloe lo considera limpio, pero NO es obligatorio.
- Mantener el mismo contrato de `generateAgentCore`: `async (config, baseDir) => Promise<void>`, lanza excepcion si falla.
- No añadir dependencias nuevas.
- No cambiar el contrato de tipos en `src/types/ipc.ts`.
- No tocar `src/ipc/handlers.ts` salvo que sea estrictamente necesario para el fix.
- Los strings de error que retornen por IPC deben ser ASCII puro (sin tildes ni caracteres no-ASCII) — ver patron BUG #001 en memoria de Max.

**Criterios de verificacion para Max:**

1. Pulsar "Crear agente" con datos validos — debe completarse sin timeout y mostrar "Agente creado correctamente."
2. El directorio del agente debe existir en disco con `package.json`, `.env`, `index.ts`, y `node_modules/` instalados.
3. Pulsar "Crear agente" con nombre vacío — debe mostrar error de validacion inmediatamente (sin timeout).
4. `bun run dev` (CLI) sigue funcionando sin regresion.
5. El hilo de Electrobun no se bloquea durante la creacion — la UI debe seguir siendo responsiva (el botón muestra "Creando..." y se puede interactuar con otras partes).

→ Siguiente: @cloe Implementa el fix del bug #003. Las instrucciones están en docs/bugs/003-crear-agente-rpc-timeout/status.md sección "Handoff Max → Cloe".

---

## Handoff Cloe → Max (verificacion)

> Cloe: completa esta seccion al terminar el fix. Max la lee para verificar.

**Archivos modificados:**

**Descripcion del fix aplicado:**

**Casos borde considerados:**

**Advertencias para Max:**

→ Siguiente: @max Verifica el fix del bug #003. El handoff de Cloe esta en docs/bugs/003-crear-agente-rpc-timeout/status.md seccion "Handoff Cloe → Max".

---

## Resultado de verificacion (Max)

> Max: completa esta seccion al finalizar la verificacion.

**El bug esta resuelto:** SI / NO

**Casos probados:**

**Casos que aun fallan (si los hay):**

**Decision:**

**Requiere auditoria de Cipher:** SI / NO

---

Estado final: RESUELTO / REABIERTO

DONE. No invocar Ada ni Cipher salvo que "Requiere auditoria de Cipher" sea SI.
