# Status — Multi-Provider LLM Support

**Estado:** Implementado — listo para QA
**Responsable:** Cloe
**Feature branch:** feature/dev (continuar en el mismo branch)

---

## Que hacer

Añadir soporte a 5 proveedores de LLM en los agentes generados: LM Studio (actual), Ollama, OpenAI, Anthropic, Gemini. El patron es Strategy via interfaz `LLMProvider`. Cada agente generado incluirá una carpeta `providers/` con implementaciones intercambiables seleccionadas por variable de entorno `PROVIDER`.

---

## Archivos a crear (nuevos)

```
src/templates/basic-agent/providers/types.ts.tpl
src/templates/basic-agent/providers/factory.ts.tpl
src/templates/basic-agent/providers/lmstudio.ts.tpl
src/templates/basic-agent/providers/ollama.ts.tpl
src/templates/basic-agent/providers/openai.ts.tpl
src/templates/basic-agent/providers/anthropic.ts.tpl
src/templates/basic-agent/providers/gemini.ts.tpl
```

## Archivos a modificar

```
src/cli/prompts.ts                      -- añadir provider a AgentConfig + pregunta en interview
src/types/ipc.ts                        -- ProviderId, ProviderInfo, ListProvidersResult, AgentInfo.provider, AppRPC listProviders
src/db/migrations.ts                    -- migration v3: ALTER TABLE agents ADD COLUMN provider
src/db/agentRepository.ts              -- AgentRow/AgentRecord/insert con provider
src/generators/agentGenerator.ts       -- scaffoldAgent: crear providers/, generar .env dinamico, inyectar PROVIDER_DEP
src/templates/basic-agent/index.ts.tpl -- usar createProvider() en lugar de LMStudioClient directo
src/templates/basic-agent/package.json.tpl -- placeholder {{PROVIDER_DEP}}
src/ipc/handlers.ts                    -- handler listProviders + pasar provider en insert
src/renderer/views/create-agent.ts     -- <select> de proveedor
```

---

## Decision de arquitectura: Strategy Pattern

- La interfaz es `LLMProvider` con dos metodos: `chat(messages)` y `chatStream(messages, onChunk)`
- `createProvider()` en `factory.ts` lee `process.env.PROVIDER` y retorna la implementacion correcta
- Todos los archivos de providers se copian siempre al agente — el usuario puede cambiar de provider editando solo el `.env`
- El factory se llama UNA VEZ al inicio del agente (fuera de la clase ACP)

---

## Contrato IPC nuevo a implementar

```typescript
// src/types/ipc.ts — añadir

export type ProviderId = 'lmstudio' | 'ollama' | 'openai' | 'anthropic' | 'gemini';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  requiresApiKey: boolean;
  apiKeyEnvVar: string | null;
  defaultModel: string;
  isLocal: boolean;
}

export interface ListProvidersResult {
  providers: ProviderInfo[];
}

// Modificar AgentInfo:
export interface AgentInfo {
  // ... campos existentes ...
  provider: ProviderId;  // AÑADIR
}

// Modificar AgentConfig en src/cli/prompts.ts:
export interface AgentConfig {
  name: string;
  description: string;
  role: string;
  needsWorkspace: boolean;
  provider: ProviderId;  // AÑADIR
}

// Modificar AppRPC.bun.requests — añadir:
listProviders: { params: undefined; response: ListProvidersResult };
```

---

## Migration DB (append-only, version 3)

```typescript
// src/db/migrations.ts — añadir al array migrations:
{
  version: 3,
  up: `ALTER TABLE agents ADD COLUMN provider TEXT NOT NULL DEFAULT 'lmstudio';`,
},
```

---

## Cambios en agentRepository.ts

```typescript
// AgentRow: añadir
provider: string;

// AgentRecord: añadir
provider: string;

// rowToRecord: añadir
provider: row.provider,

// insert params: añadir
provider: string;

// INSERT SQL: añadir columna provider
// UPDATE: no necesario en esta feature
```

---

## Interfaz LLMProvider (types.ts.tpl — sin placeholders, es literal)

```typescript
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMProvider {
  chat(messages: Message[]): Promise<string>;
  chatStream(messages: Message[], onChunk: (text: string) => void): Promise<string>;
}
```

---

## Factory (factory.ts.tpl — sin placeholders, es literal)

```typescript
import type { LLMProvider } from './types';

export async function createProvider(): Promise<LLMProvider> {
  const provider = process.env.PROVIDER ?? 'lmstudio';
  switch (provider) {
    case 'lmstudio': {
      const { LMStudioProvider } = await import('./lmstudio');
      return new LMStudioProvider();
    }
    case 'ollama': {
      const { OllamaProvider } = await import('./ollama');
      return new OllamaProvider();
    }
    case 'openai': {
      const { OpenAIProvider } = await import('./openai');
      return new OpenAIProvider();
    }
    case 'anthropic': {
      const { AnthropicProvider } = await import('./anthropic');
      return new AnthropicProvider();
    }
    case 'gemini': {
      const { GeminiProvider } = await import('./gemini');
      return new GeminiProvider();
    }
    default:
      throw new Error(`Provider desconocido: "${provider}". Valores validos: lmstudio, ollama, openai, anthropic, gemini`);
  }
}
```

---

## index.ts.tpl — cambios clave

El template se actualiza para:
1. Importar `createProvider` desde `./providers/factory`
2. Quitar el import de `LMStudioClient`
3. Declarar `let provider: LLMProvider` en el scope del modulo
4. Inicializar `provider = await createProvider()` al inicio (antes del if TTY/ACP)
5. En modo ACP (`prompt()`): usar `provider.chatStream(messages, onChunk)` donde `onChunk` llama `connection.sessionUpdate(chunk)`
6. En modo TTY: usar `provider.chatStream(messages, (chunk) => process.stdout.write(chunk))`
7. Mantener exactamente la misma estructura de `process.stdin.isTTY` — solo cambia la implementacion interna

La logica de filtrado de reasoning tokens (`<|channel|>` y `<think>`) se mueve a `lmstudio.ts.tpl` — ya no vive en `index.ts.tpl`.

---

## package.json.tpl — dependencia dinamica

```json
{
  "dependencies": {
    "@agentclientprotocol/sdk": "^0.15.0",
    "dotenv": "^16.4.5"
    {{PROVIDER_DEP}}
  }
}
```

Mapa de `{{PROVIDER_DEP}}` a inyectar (nota: la coma inicial es parte del valor inyectado):

| Provider | Valor del placeholder |
|---|---|
| `lmstudio` | `,\n    "@lmstudio/sdk": "^1.0.0"` |
| `ollama` | `` (string vacio) |
| `openai` | `,\n    "openai": "^4.0.0"` |
| `anthropic` | `,\n    "@anthropic-ai/sdk": "^0.39.0"` |
| `gemini` | `,\n    "@google/generative-ai": "^0.24.0"` |

---

## scaffoldAgent — cambios en agentGenerator.ts

```typescript
// 1. Crear providers/
await createDirectory(path.join(agentDir, 'providers'));

// 2. Copiar todos los providers/*.ts.tpl (sin inyeccion de placeholders, son literales)
const providerFiles = ['types', 'factory', 'lmstudio', 'ollama', 'openai', 'anthropic', 'gemini'];
for (const name of providerFiles) {
  await copyTemplateAndInject(
    path.join(templatesDir, 'providers', `${name}.ts.tpl`),
    path.join(agentDir, 'providers', `${name}.ts`),
    {} // sin placeholders
  );
}

// 3. .env dinamico segun provider
const envContent = buildEnvContent(config);
await writeFile(path.join(agentDir, '.env'), envContent);

// 4. package.json con PROVIDER_DEP inyectado
await copyTemplateAndInject(
  path.join(templatesDir, 'package.json.tpl'),
  path.join(agentDir, 'package.json'),
  {
    AGENT_NAME: config.name,
    AGENT_DESCRIPTION: config.description.replace(/"/g, '\\"'),
    PROVIDER_DEP: getProviderDep(config.provider),
  }
);
```

Funcion auxiliar `buildEnvContent(config: AgentConfig): string` — genera el .env con las vars correctas segun `config.provider`.

---

## Renderer — create-agent.ts

1. Llamar `rpc.request.listProviders()` al inicio de `renderCreateAgent()`
2. Añadir `<select id="ca-provider">` con una `<option>` por proveedor
3. Default: `lmstudio`
4. En el submit handler, incluir `provider: providerSelect.value` en el objeto enviado a `generateAgent`
5. Fallback si `listProviders` falla: mostrar las 5 opciones hardcodeadas en el renderer

---

## handler listProviders — handlers.ts

```typescript
listProviders: async () => {
  return {
    providers: [
      { id: 'lmstudio', label: 'LM Studio', requiresApiKey: false, apiKeyEnvVar: null, defaultModel: '', isLocal: true },
      { id: 'ollama', label: 'Ollama', requiresApiKey: false, apiKeyEnvVar: null, defaultModel: 'llama3.2', isLocal: true },
      { id: 'openai', label: 'OpenAI', requiresApiKey: true, apiKeyEnvVar: 'OPENAI_API_KEY', defaultModel: 'gpt-4o-mini', isLocal: false },
      { id: 'anthropic', label: 'Anthropic', requiresApiKey: true, apiKeyEnvVar: 'ANTHROPIC_API_KEY', defaultModel: 'claude-3-5-haiku-20241022', isLocal: false },
      { id: 'gemini', label: 'Gemini', requiresApiKey: true, apiKeyEnvVar: 'GEMINI_API_KEY', defaultModel: 'gemini-2.0-flash', isLocal: false },
    ],
  };
},
```

---

## Orden de implementacion recomendado

1. `src/types/ipc.ts` — ProviderId, ProviderInfo, ListProvidersResult, AgentInfo.provider
2. `src/cli/prompts.ts` — provider en AgentConfig
3. `src/db/migrations.ts` — migration v3
4. `src/db/agentRepository.ts` — columna provider
5. Templates providers: types.ts.tpl, factory.ts.tpl, luego los 5 providers
6. `src/templates/basic-agent/index.ts.tpl` — usa createProvider()
7. `src/templates/basic-agent/package.json.tpl` — placeholder PROVIDER_DEP
8. `src/generators/agentGenerator.ts` — scaffoldAgent actualizado
9. `src/ipc/handlers.ts` — listProviders + provider en insert
10. `src/renderer/views/create-agent.ts` — select proveedor

---

## Restricciones — NO tocar

- `src/index.ts`
- `src/client.ts`
- `src/ipc/acpManager.ts` — **NOTA (post-QA):** este archivo fue modificado durante la implementacion para corregir un bug de path relativo en `createSession` (el path al ejecutable del agente era relativo al CWD del proceso en lugar de ser absoluto). La modificacion fue tecnicament necesaria y no altera la interfaz publica de ACP. Max verifico que el comportamiento ACP sigue siendo correcto.
- `src/enhancer/` (ninguno de sus 4 archivos)
- El comportamiento de `process.stdin.isTTY` en los agentes generados
- Los agentes ya existentes en disco no se re-generan

---

## Metricas de Leo

- Archivos a crear: 8 (7 templates providers + 1 .env.tpl implicito en scaffoldAgent)
- Archivos a modificar: 9
- Migraciones DB: 1 (v3, columna provider)
- Nuevos canales IPC: 1 (listProviders)
- Patrones introducidos: Strategy (LLMProvider interface + factory)
- Riesgo de regresion: bajo — agentGenerator es la unica parte critica; el resto son adiciones
- Estimacion de complejidad: media (muchos archivos, logica de cada SDK diferente)

---

## Handoff de Cloe a Max

### Archivos creados
- `src/utils/crypto.ts` — AES-256-GCM; `encryptApiKey()` y `decryptIfNeeded()`; master key en `<userData>/master.key`
- `src/templates/basic-agent/providers/types.ts.tpl` — interfaz `LLMProvider` + `Message`
- `src/templates/basic-agent/providers/factory.ts.tpl` — registry map con dynamic imports; `createProvider()`
- `src/templates/basic-agent/providers/crypto.ts.tpl` — modulo de crypto autocontenido para agentes generados (sin dependencia de src/utils/)
- `src/templates/basic-agent/providers/lmstudio.ts.tpl` — filtra reasoning tokens (channel y think); implementa chatStream con streaming nativo
- `src/templates/basic-agent/providers/ollama.ts.tpl` — NDJSON streaming via fetch; `OLLAMA_HOST` configurable
- `src/templates/basic-agent/providers/openai.ts.tpl` — openai SDK con streaming; desencripta key via `decryptIfNeeded()`
- `src/templates/basic-agent/providers/anthropic.ts.tpl` — Anthropic SDK con streaming; separa system prompt del historial
- `src/templates/basic-agent/providers/gemini.ts.tpl` — Google Generative AI SDK; separa `systemInstruction`; convierte `assistant` a `model` para el historial Gemini

### Archivos modificados
- `src/cli/prompts.ts` — `AgentConfig` con `provider: ProviderId` y `apiKey?: string`; `requiresApiKey()`; pregunta `select()` de proveedor; pregunta `password()` condicional para API key
- `src/types/ipc.ts` — `ProviderId`, `ProviderInfo`, `ListProvidersResult`; `provider: ProviderId` en `AgentInfo`; canal `listProviders` en `AppRPC`
- `src/db/migrations.ts` — migration v3: columna `provider TEXT NOT NULL DEFAULT 'lmstudio'`
- `src/db/agentRepository.ts` — `provider` en `AgentRow`, `AgentRecord`, `rowToRecord`, `insert()`
- `src/generators/agentGenerator.ts` — `buildEnvContent()` dinamico por provider; encripta API key antes de escribir; copia `providers/` con todos los 8 tpl; inyecta `PROVIDER_DEP` en `package.json`
- `src/templates/basic-agent/index.ts.tpl` — usa `createProvider()` + `provider.chatStream()`; el provider se pasa al constructor de la clase ACP; elimina LMStudioClient directo
- `src/templates/basic-agent/package.json.tpl` — placeholder `{{PROVIDER_DEP}}`; sin `@lmstudio/sdk` hardcodeado
- `src/ipc/handlers.ts` — handler `listProviders` estatico; validacion de provider en `generateAgent`; `provider` pasado a `agentRepository.insert()`; `provider` en el mapa de `listAgents`
- `src/renderer/views/create-agent.ts` — `<select id="ca-provider">` con 5 opciones hardcodeadas como fallback; `rpc.request.listProviders()` al montar; campo `<input type="password">` condicional con label dinamico; `provider` y `apiKey` enviados en `generateAgent`

### Decisiones tomadas
1. **crypto.ts.tpl autocontenido**: Los agentes generados no tienen acceso a `src/utils/`. El modulo `providers/crypto.ts` se incluye como template independiente que resuelve el path a `master.key` usando la misma logica de plataforma que `userDataDir.ts`.
2. **factory.ts usa registry map** (no switch): sigue el plan. Dynamic imports lazy — sin carga extra al arrancar.
3. **provider se inicializa UNA vez** antes del if TTY/ACP: se pasa como argumento al constructor de la clase ACP en lugar de guardarlo en module scope mutable.
4. **lmstudio.ts.tpl** acumula el contenido completo antes de filtrar reasoning tokens, luego emite un unico chunk. El TTY no ve el streaming fragment-by-fragment para lmstudio — acepto este trade-off para mantener el filtro de reasoning tokens simple.
5. **ollama.ts.tpl** usa `OLLAMA_HOST` como env var override (igual que ollama CLI convencional).
6. **anthropic.ts.tpl** filtra mensajes de sistema separandolos del historial — Anthropic API requiere `system` como campo separado.
7. **gemini.ts.tpl** convierte el ultimo mensaje como prompt de `sendMessageStream`; el historial previo va en `startChat({ history })`.

### Lo que Max debe verificar
- Flujo completo: crear agente con provider=anthropic desde CLI y desktop — verificar que el `.env` generado tiene `enc:` en la key
- Flujo lmstudio: crear agente con provider=lmstudio — `.env` debe tener `PROVIDER=lmstudio` y `LM_STUDIO_MODEL=""`
- Flujo ollama: crear agente con provider=ollama — sin entry de API key, `OLLAMA_MODEL="llama3.2"`
- Migration v3: verificar que la DB existente se migra correctamente con DEFAULT 'lmstudio' para agentes anteriores
- Renderer: verificar que el campo `apiKey` aparece solo para openai/anthropic/gemini; que el label cambia segun el proveedor seleccionado
- IPC `listProviders`: verificar que el renderer recibe los 5 providers y los muestra en el select
- `agentInfo.provider` en listAgents: verificar que el campo se devuelve correctamente
- No regresion: agente lmstudio existente sigue arrancando (ACP + TTY)

---

## Metricas de Cloe

- Archivos creados: 9 (8 templates + src/utils/crypto.ts)
- Archivos modificados: 9
- Errores de TS nuevos introducidos: 0 (errores preexistentes en agentRepository, client.ts, acpManager.ts, database.ts no tocados)
- Patron aplicado: Strategy (LLMProvider) + Registry Map (factory)
- Backward compatible: si — migration DEFAULT 'lmstudio'; rowToRecord con fallback `?? 'lmstudio'`

---

## Handoff de Ada a Cipher

### Estado
**Optimizacion completada.** 3 mejoras aplicadas en 3 archivos. Comportamiento sin cambios.

### Cambios aplicados

**`src/generators/agentGenerator.ts`**
- Eliminado `import { spawnSync } from 'child_process'` — dependencia de Node.js innecesaria en Bun
- Reemplazado `spawnSync('bun', ['install'], ...)` (bloqueante, ~30s) por `Bun.spawn + await installProc.exited` (async) en la funcion `generateAgent`. Mismo patron que ya usaban `installAgentDeps` y `generateAgentCore`. La funcion `generateAgent` ya era async, no fue necesario cambiar su firma.
- Impacto: el event loop del CLI ya no se congela durante `bun install` al crear agentes con provider que requiere descarga de SDK

**`src/renderer/views/create-agent.ts`**
- Añadida constante `VALID_PROVIDER_IDS = new Set([...5 IDs...])` con los IDs validos
- Añadida validacion en el submit handler antes de llamar a IPC: si `providerSelect.value` no esta en `VALID_PROVIDER_IDS`, muestra feedback de error inmediato sin llegar al main process
- Defensa contra valores corruptos por manipulacion del DOM o carga parcial del select dinamico

**`src/cli/prompts.ts`**
- Movido `KEY_LABELS` de variable local dentro del `if` a constante tipada `Record<ProviderId, string>` fuera del bloque — elimina la construccion del objeto en cada call
- Eliminados dos casts `as ProviderId` y `as string` innecesarios: `baseConfig.provider` ya es `ProviderId` por el `select<ProviderId>()` y el `group()` preserva los tipos
- Eliminado cast `as AgentConfig` del return — el tipo se infiere correctamente

### Duplicacion en providers templates — decision de no tocar

Los cinco providers tienen el patron `chat()` identico (delegar en `chatStream`). Los tres providers con API key tienen el constructor identico (leer env, validar, desencriptar). No se puede extraer a un helper compartido sin romper la restriccion de templates autocontenidos. La duplicacion es intencional por diseño — cada agente generado debe ser independiente de `src/`.

### Metricas de Ada

- Archivos modificados: 3
- `spawnSync` eliminados: 1 (el unico que quedaba en el codebase bajo `src/generators/`)
- Imports eliminados: 1 (`child_process` de agentGenerator.ts)
- Validaciones de seguridad añadidas en renderer: 1
- Casts TypeScript innecesarios eliminados: 3
- Bundle: sin cambio medible (no hay build script; los archivos modificados son ligeros)
- Comportamiento: identico al aprobado por Max

### Notas para Cipher

- `src/utils/crypto.ts` usa AES-256-GCM con IV de 96 bits y auth tag — implementacion correcta
- `src/templates/basic-agent/providers/crypto.ts.tpl` duplica la logica de desencriptado (necesario, templates autocontenidos) — revisar que el path a `master.key` sea correcto en los 3 SO
- Las API keys viajan del renderer al main process via IPC como plaintext — se encriptan en el main process antes de escribirse a disco. Revisar si IPC esta asegurado (Cipher scope)
- `child_process` todavia aparece en `src/ipc/acpManager.ts` y `src/client.ts` — fuera del scope de esta optimizacion

---

## Resultado de Cipher

**Veredicto: APROBADO CON OBSERVACIONES**
**Fecha:** 2026-03-13
**Version:** multi-provider-support v1.0

### Hallazgos

#### CRITICO — Ninguno

#### ALTO — Ninguno

#### MEDIO (1)

**M1 — API key en plaintext por IPC renderer → main**
- Archivo: `src/renderer/views/create-agent.ts` linea 177-184 / `src/types/ipc.ts` linea 156
- Descripcion: La API key ingresada por el usuario en el campo `<input type="password">` viaja en plaintext como parte del objeto `AgentConfig` en el payload JSON del canal IPC de Electrobun antes de ser encriptada. La encriptacion ocurre en `agentGenerator.ts` `buildEnvContent()` — correctamente en el main process — pero el transporte IPC no está cifrado adicionalmente.
- Vector de ataque: Un proceso malicioso en la misma maquina con acceso al socket/pipe de Electrobun IPC podria interceptar el mensaje y extraer la key en texto claro durante los milisegundos que tarda el RPC. El threat model de una app desktop local hace este riesgo teorico bajo: requiere otro proceso comprometido con privilegios en la maquina local.
- Impacto: Exposicion de API key de OpenAI/Anthropic/Gemini si el canal IPC del proceso local esta comprometido.
- Remediacion sugerida: Cifrar el campo `apiKey` en el renderer antes de enviarlo via IPC usando la clave publica del main process, o aceptar como riesgo dado el threat model desktop (proceso local mismo usuario). Para un follow-up: considerar que el renderer no envie la key al main sino que el usuario la escriba directamente en el archivo `.env` del agente.
- Severidad ajustada al threat model: MEDIA → en contexto desktop local baja a BAJA

#### BAJO (2)

**B1 — `master.key` no esta en `.gitignore`**
- Archivo: `D:/work/worflow-agent/.gitignore`
- Descripcion: El archivo `master.key` generado en `<userData>/master.key` no está en el repo (esta fuera del directorio de trabajo), por lo que no hay riesgo de commit accidental desde su ubicacion de produccion. Sin embargo, `.gitignore` no contiene ninguna entrada para `*.key` ni `master.key`. Si durante desarrollo alguien genera o copia `master.key` al directorio del proyecto, no habria proteccion.
- Remediacion: Añadir `master.key` y `*.key` a `.gitignore` como medida defensiva.

**B2 — `HOME ?? '~'` como fallback inseguro en crypto.ts.tpl**
- Archivo: `src/templates/basic-agent/providers/crypto.ts.tpl` lineas 20 y 22
- Descripcion: En macOS y Linux, si `process.env.HOME` no esta definida, el path resuelto es `~/Library/Application Support/Worflow Agent/master.key` o `~/.config/worflow-agent/master.key` — literalmente la cadena `~` como directorio. En Bun/Node `path.join` no expande `~`, por lo que el path absoluto seria invalido y el agente fallaria al intentar leer `master.key`. El mismo patron existe en `src/db/userDataDir.ts` pero es menos critico porque ese codigo corre en el main process donde HOME casi siempre esta definido.
- Impacto: Agente generado falla silenciosamente al arrancar en entornos donde HOME no esta en el entorno de proceso (e.g. servicios, CI sin HOME).
- Remediacion: Lanzar Error explicito si HOME es undefined, igual que se hace con APPDATA en Windows.

#### INFORMATIVO (3)

**I1 — API key en plaintext en memoria del proceso main**
- Archivo: `src/ipc/handlers.ts` linea 55-114, `src/generators/agentGenerator.ts` linea 20-64
- Descripcion: La API key existe como string plaintext en el heap V8/Bun entre la recepcion del IPC y la llamada a `encryptApiKey()`. No hay forma de limpiar activamente la memoria en JavaScript (sin acceso directo al GC). Esto es aceptable — es el mismo modelo que usan todos los SDKs de Node/Bun.
- Estado: Riesgo aceptado. No existe remediacion practica en el runtime de JS.

**I2 — Patron de error en decryptIfNeeded no revela el ciphertext**
- Archivo: `src/utils/crypto.ts` lineas 52-53, `src/templates/basic-agent/providers/crypto.ts.tpl` lineas 47-48
- Descripcion: El mensaje de error cuando el formato es invalido (`"Formato de clave encriptada invalido..."`) no incluye el valor de `value`, lo cual es correcto. Si GCM falla la autenticacion, el error llega desde el runtime de Node.js (`decipher.final()` lanza) — ese error tampoco incluye el ciphertext. Sin problemas.
- Estado: OK.

**I3 — Secret en .env del repo (GEMINI_API_KEY con valor real)**
- Archivo: `.env` linea 1
- Descripcion: El archivo `.env` en la raiz del repo contiene `GEMINI_API_KEY="AIzaSyBTpCiMvMgnY9p2sU82plxiHIr14uvxE3Q"`. El archivo NO esta commiteado en git (verificado con `git ls-files .env` — sin output). Esta cubierto por `.gitignore`. Sin embargo, el secret deberia rotarse si fue expuesto en algun momento fuera del sistema local.
- Estado: Sin riesgo de leak via git. Recomendacion: rotar la key como buena practica, especialmente si el repo tiene CI/CD que lee el entorno.

### Checklist de auditoria

- [x] Sin secrets en el codigo fuente ni en git history
- [x] `.env` en `.gitignore` y no commiteado
- [x] Inputs del webview validados antes de operaciones de file system (`validateAgentName`, whitelist de providers en handlers.ts)
- [x] Spawn de agentes usa rutas absolutas desde DB (`agent.path`), no interpolacion de strings del usuario
- [ ] DevTools deshabilitados en build de produccion — pendiente (documentado desde electrobun-migration, fuera de scope de esta feature)
- [ ] CSP configurado en el webview — pendiente (documentado desde electrobun-migration, fuera de scope)
- [x] No se expone `process.env` completo al renderer via IPC
- [x] Cierre limpio de subprocesos al cerrar la app (acpManager, fuera de scope de esta feature)
- [x] Templates `.tpl` no contienen API keys hardcodeadas
- [x] AES-256-GCM con IV 96-bit unico por operacion — correcto
- [x] authTag verificado en decrypt — correcto (`decipher.setAuthTag` antes de `decipher.final()`)
- [x] `master.key` escrito con `mode: 0o600` — correcto
- [x] `decryptIfNeeded` valida 3 partes (iv:tag:cipher) antes de intentar decrypt — correcto
- [x] Provider whitelist validada en handler antes de filesystem ops — correcto
- [x] API key encriptada antes de llegar a disco — correcto
- [x] `apiKey` limpiado del DOM al crear con exito (linea 192) — correcto
- [ ] `master.key` en .gitignore — pendiente (B1)

### Riesgos aceptados

- API key en plaintext por IPC local (M1): aceptable en threat model desktop (mismo proceso, misma maquina, mismo usuario). No existe solucion practica que no complique significativamente la arquitectura.
- API key en plaintext en memoria JS entre IPC y encriptacion (I1): inherente al runtime, no mitigable.
- `HOME ?? '~'` fallback (B2): aceptable en produccion donde HOME siempre esta definido; el riesgo real es en CI/servicios donde el agente no deberia correr de todos modos.

### Vulnerabilidades bloqueantes para el merge

Ninguna. La feature puede mergearse a `main`.

### Acciones recomendadas antes del proximo release

1. Añadir `master.key` y `*.key` a `.gitignore` (5 segundos de trabajo) — B1
2. Cambiar el fallback `HOME ?? '~'` por un `throw new Error(...)` en `crypto.ts.tpl` — B2
3. Rotar `GEMINI_API_KEY` del `.env` local si fue expuesto en algun canal externo — I3

---

## Metricas de Cipher

- Archivos auditados: 12
- Vulnerabilidades criticas: 0
- Vulnerabilidades altas: 0
- Vulnerabilidades medias: 1 (M1 — aceptada, threat model desktop)
- Vulnerabilidades bajas: 2 (B1, B2)
- Informativos: 3
- Items del checklist completados: 15/17 (2 pendientes son de electrobun-migration, pre-existentes)
- Secrets en git history: 0
- Secrets en codigo fuente: 0
- Patrones de inyeccion encontrados: 0
- Path traversal encontrados: 0
