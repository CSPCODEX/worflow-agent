---
name: acp-debug
description: Diagnóstico paso a paso cuando un agente ACP falla, no responde o produce errores NDJSON. Usar cuando hay problemas de comunicación entre el main process y un agente.
---

# Skill: acp-debug

Procedimiento de diagnostico cuando un agente ACP no responde, falla al conectar, o produce errores en la comunicacion NDJSON. Seguir en orden hasta encontrar el problema.

## Procedimiento

### 1. Verificar que LM Studio esta corriendo

```bash
curl http://localhost:1234/v1/models
```

- Si falla: LM Studio no esta corriendo o no escucha en el puerto esperado
- Si responde: confirmar que hay al menos un modelo cargado en la lista

### 2. Verificar que el proceso del agente arranca

Ejecutar el agente manualmente y observar stderr (los logs del agente van a stderr):

```bash
cd <nombre-agente> && bun run index.ts
```

Resultado esperado en stderr:
```
[<nombre>] Agente ACP listo. Esperando conexion via stdin/stdout...
```

Si no aparece ese mensaje, el agente falla al arrancar. Ver el error y verificar:
- Dependencias instaladas: `bun install`
- Archivo `.env` presente con `LM_STUDIO_MODEL=""`
- Sin errores de TypeScript en `index.ts`

### 3. Verificar el spawn desde el cliente

En `src/client.ts` el agente se lanza con:
```typescript
const agentProcess = spawn('bun', ['run', agentEntry], {
  stdio: ['pipe', 'pipe', 'inherit'],
  cwd: agentDir,
});
```

Verificar:
- `agentEntry` apunta a un archivo que existe
- `agentDir` es el directorio correcto del agente
- `bun` esta disponible en el PATH del proceso padre

### 4. Inspeccionar mensajes NDJSON

Si el proceso arranca pero la comunicacion falla, añadir logs temporales para ver los mensajes raw:

En el cliente, antes de crear el `ndJsonStream`:
```typescript
agentProcess.stdout.on('data', (chunk) => {
  console.error('[DEBUG raw stdout]', chunk.toString());
});
```

Cada mensaje valido debe ser una linea JSON completa terminada en `\n`. Si el JSON esta malformado o fragmentado, el stream fallara.

### 5. Verificar el protocolo ACP

El handshake ACP sigue este orden obligatorio:
1. `initialize` — cliente envia version del protocolo, agente responde con capabilities
2. `newSession` — cliente solicita sesion, agente responde con `sessionId`
3. `setSessionMode` — configura el modo de la sesion
4. `prompt` — primer mensaje del usuario

Si cualquier paso falla o se salta, la conexion se rompe. Verificar que `src/client.ts` sigue este orden exacto.

### 6. Detectar procesos zombie

Si el agente falla y se relanza repetidamente pueden quedar procesos colgados:

```bash
# macOS/Linux
ps aux | grep "bun run index.ts"
```

Matar los procesos huerfanos antes de reintentar.

### 7. Verificar version del SDK

Confirmar que el agente y el cliente usan la misma version de `@agentclientprotocol/sdk`:

```bash
cat <agente>/package.json | grep agentclientprotocol
cat package.json | grep agentclientprotocol
```

Versiones distintas pueden causar incompatibilidades de protocolo.

## Reporte de resultados

Indicar en que paso fallo, el error exacto, y la solucion aplicada.
Actualizar `.claude/agent-memory/max/MEMORY.md` con el problema y la solucion para no repetir el diagnostico.
