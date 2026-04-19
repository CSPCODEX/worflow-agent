---
name: electrobun-ipc
description: Guía paso a paso para crear un canal RPC tipado entre main process y webview en Electrobun. Usar cuando Cloe necesita nueva comunicación IPC entre capas.
---

# Skill: electrobun-ipc

Procedimiento para crear un canal RPC tipado entre el main process y el webview en Electrobun. Seguir este flujo cada vez que se necesita una nueva comunicacion entre capas.

## Procedimiento

### 1. Definir el contrato de tipos (primero siempre los tipos)

Crear o actualizar `src/types/ipc.ts` con la firma de la nueva operacion:

```typescript
// Ejemplo: operacion para generar un agente
export interface GenerateAgentParams {
  name: string;
  description: string;
  role: string;
  needsWorkspace: boolean;
}

export interface GenerateAgentResult {
  success: boolean;
  agentDir?: string;
  error?: string;
}
```

Todos los parametros y retornos deben ser tipos serializables a JSON (no funciones, no clases, no Promises anidadas).

### 2. Registrar el handler en el main process

En `src/ipc/handlers.ts`, registrar el handler RPC usando la API de Electrobun:

```typescript
import type { GenerateAgentParams, GenerateAgentResult } from '../types/ipc';
import { generateAgent } from '../generators/agentGenerator';

// Registrar antes de crear la ventana
electrobun.handle('generateAgent', async (params: GenerateAgentParams): Promise<GenerateAgentResult> => {
  try {
    await generateAgent(params);
    return { success: true, agentDir: params.name };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});
```

Reglas del handler:
- Siempre async
- Siempre captura errores y los retorna como parte del resultado (no lanza excepciones al renderer)
- Valida los params antes de usarlos en operaciones de file system o spawn

### 3. Invocar desde el renderer

En el archivo de vista correspondiente en `src/renderer/views/`:

```typescript
import type { GenerateAgentParams, GenerateAgentResult } from '../../types/ipc';

async function onSubmitForm(params: GenerateAgentParams) {
  const result: GenerateAgentResult = await electrobun.invoke('generateAgent', params);

  if (result.success) {
    showSuccess(`Agente creado en ${result.agentDir}`);
  } else {
    showError(result.error ?? 'Error desconocido');
  }
}
```

### 4. Verificar el canal

Checklist antes de dar por finalizado:
- [ ] Los tipos estan en `src/types/ipc.ts`, no inline
- [ ] El handler valida los params (no usa directamente input del usuario en file system o spawn)
- [ ] El renderer maneja tanto el caso exitoso como el error
- [ ] El handler no lanza excepciones no capturadas
- [ ] El nombre del canal es descriptivo en camelCase (`generateAgent`, no `gen_agent` ni `generate-agent`)

### 5. Actualizar memoria

Registrar en `.claude/agent-memory/cloe/MEMORY.md` el nuevo canal IPC creado con su firma de tipos.
