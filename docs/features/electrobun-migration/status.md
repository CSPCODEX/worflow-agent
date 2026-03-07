# Status — electrobun-migration

## Estado actual

**Fase:** Diseño completado — pendiente implementacion
**Agente activo:** Cloe

---

## Handoff de Leo → Cloe

**Que hacer:** Implementar la app desktop Electrobun sobre el codebase existente. El CLI terminal NO se toca.

**Reglas estrictas:**
- `src/index.ts`, `src/client.ts` y el modo TTY de agentes generados — NO MODIFICAR
- `AgentConfig` viene de `src/cli/prompts.ts` — no duplicar el tipo
- Los handlers IPC nunca lanzan excepciones — capturan y retornan `{ success: false, error }`
- Validar params en el handler antes de cualquier file system op o spawn

**Archivos a crear en orden de prioridad:**

1. `src/types/ipc.ts` — contratos tipados (ver abajo)
2. `src/generators/agentGenerator.ts` — añadir export `generateAgentCore(config, baseDir)` sin spinner
3. `src/ipc/acpManager.ts` — gestiona sesiones ACP activas
4. `src/ipc/handlers.ts` — registra los 4 handlers RPC
5. `src/main.ts` — entry point Electrobun
6. `electrobun.config.ts` — config build
7. `package.json` — añadir electrobun + script `desktop`
8. `src/renderer/index.html`
9. `src/renderer/app.ts`
10. `src/renderer/views/create-agent.ts`
11. `src/renderer/views/chat.ts`
12. `src/renderer/components/agent-list.ts`
13. `src/renderer/style.css`

**Contratos IPC que debes implementar en `src/types/ipc.ts`:**

```typescript
export type { AgentConfig } from '../cli/prompts';

export interface GenerateAgentResult { success: boolean; agentDir?: string; error?: string; }

export interface AgentInfo { name: string; description: string; hasWorkspace: boolean; path: string; }
export interface ListAgentsResult { agents: AgentInfo[]; }

export interface CreateSessionParams { agentName: string; }
export interface CreateSessionResult { success: boolean; sessionId?: string; error?: string; }

export interface SendMessageParams { sessionId: string; message: string; }
export interface SendMessageResult { success: boolean; error?: string; }

export interface AgentMessageChunk { sessionId: string; text: string; }
export interface AgentMessageEnd { sessionId: string; }
export interface AgentError { sessionId: string; error: string; }
```

**Como implementar `acpManager.ts`:** Basate en `src/client.ts` existente. La logica es la misma — spawn del proceso, ndJsonStream, ClientSideConnection, handshake ACP. La diferencia: en vez de un REPL en terminal, emites eventos al renderer. Guarda sesiones en `Map<sessionId, { process, connection }>`. Implementa `closeAll()` para limpiar al cerrar la app.

**Como implementar IPC en Electrobun:**
```typescript
// main.ts
electrobun.handle('generateAgent', async (config: AgentConfig): Promise<GenerateAgentResult> => { ... });
// renderer
const result = await electrobun.invoke('generateAgent', config);
```

### Metricas de Leo
```
archivos_leidos: 6
archivos_escritos: 5
rework: no
iteraciones: 1
notas: primera sesion, sin contexto previo
```

---

## Handoff de Cloe → Max

> Pendiente

```
archivos_creados:
archivos_modificados:
decisiones_tomadas:
advertencias_para_max:
```

### Metricas de Cloe
```
archivos_leidos:
archivos_creados:
archivos_modificados:
rework: si/no — motivo:
iteraciones:
bloqueantes_encontrados:
```

---

## Handoff de Max → Ada

> Pendiente

```
checklist_aprobado: 0/7
bugs_criticos:
bugs_menores:
advertencias_para_ada:
```

### Metricas de Max
```
archivos_revisados:
bugs_encontrados:
rework_solicitado: si/no — motivo:
iteraciones:
```

---

## Handoff de Ada → Cipher

> Pendiente

```
optimizaciones_aplicadas:
bundle_antes:
bundle_despues:
advertencias_para_cipher:
```

### Metricas de Ada
```
archivos_modificados:
mejora_bundle:
rework: si/no — motivo:
iteraciones:
deuda_tecnica_pendiente:
```

---

## Resultado de Cipher

> Pendiente

```
vulnerabilidades_criticas:
vulnerabilidades_medias:
riesgos_aceptados:
decision: pendiente
```

### Metricas de Cipher
```
archivos_auditados:
vulnerabilidades_encontradas:
rework_solicitado: si/no — motivo:
iteraciones:
```
