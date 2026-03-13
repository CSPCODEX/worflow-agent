# Plan — Multi-Provider LLM Support

## Objetivo

Añadir soporte a múltiples proveedores de LLM (LM Studio, Gemini, Anthropic, OpenAI, Ollama) en los agentes generados, manteniendo:
- El modo TTY interactivo intacto
- El modo ACP via stdin/stdout intacto
- El CLI `bun run dev` intacto
- El flujo del desktop app sin regresiones

---

## Análisis del estado actual

### Qué está fijo hoy

1. `src/templates/basic-agent/index.ts.tpl` — usa `LMStudioClient` hardcodeado, sin abstracción
2. `src/templates/basic-agent/package.json.tpl` — depende de `@lmstudio/sdk` exclusivamente
3. `src/generators/agentGenerator.ts` (`scaffoldAgent`) — escribe `.env` con solo `LM_STUDIO_MODEL=""`
4. `src/cli/prompts.ts` — `AgentConfig` no tiene campo `provider`
5. `src/types/ipc.ts` — `AgentConfig` (re-exportado) no incluye `provider`
6. `src/renderer/views/create-agent.ts` — formulario sin selector de proveedor
7. `src/db/migrations.ts` — tabla `agents` sin columna `provider`

### Qué no debe tocarse

- `src/index.ts` — entrypoint CLI
- `src/client.ts` — cliente ACP del CLI
- La lógica de `process.stdin.isTTY` en los agentes generados
- `src/ipc/acpManager.ts` — el manager de sesiones ACP

---

## Evaluación de patrones de diseño

### Opciones evaluadas

**Adapter Pattern**
- Envuelve una interfaz externa incompatible en una interfaz común
- Problema: cada provider SDK tiene una API muy diferente — el adapter se vuelve grueso y acopla la lógica de llamada al template

**Bridge Pattern**
- Separa abstracción de implementación
- Demasiado complejo para este caso; implica dos jerarquías de clases

**Strategy Pattern**
- Define una familia de algoritmos intercambiables, cada uno encapsulado en su propia clase/módulo
- El "algoritmo" aquí es "llamar a un LLM dado un historial y devolver texto"
- La selección de strategy se hace en tiempo de construcción (via `.env`)
- Extensible: nuevo proveedor = nuevo archivo que implementa la interfaz `LLMProvider`

**Decision: Strategy Pattern**

Justificación:
- La interfaz de interacción con un LLM es uniforme: recibir historial de mensajes + system prompt, devolver texto (posiblemente streaming)
- El provider se selecciona UNA VEZ al arrancar el agente (via `PROVIDER` en `.env`), no cambia en runtime
- Añadir un nuevo proveedor = crear un archivo que implemente `LLMProvider`, registrarlo en el factory — sin tocar ningún otro archivo
- Los templates generados quedan limpios: solo importan `createProvider()` y llaman `provider.chat()`

---

## Interfaz central: LLMProvider

```typescript
// En el agente generado: providers/types.ts
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMProvider {
  /**
   * Envía un historial de mensajes al modelo y devuelve el texto completo de la respuesta.
   * La implementación interna puede ser streaming o no; el contrato externo es una Promise<string>.
   */
  chat(messages: Message[]): Promise<string>;

  /**
   * Igual que chat() pero emite fragmentos via callback (para TTY streaming).
   * Implementaciones que no soporten streaming pueden emitir un único chunk con el texto completo.
   */
  chatStream(messages: Message[], onChunk: (text: string) => void): Promise<string>;
}
```

Esta interfaz es la misma para todos los proveedores. El template del agente solo llama `provider.chatStream(...)` — nunca sabe qué SDK hay debajo.

---

## Proveedores soportados

| ID (`PROVIDER=`) | SDK / API | API Key en .env | Modelo en .env | Notas |
|---|---|---|---|---|
| `lmstudio` | `@lmstudio/sdk` | No (local) | `LM_STUDIO_MODEL` | Default — sin cambios funcionales |
| `ollama` | HTTP REST `localhost:11434` | No (local) | `OLLAMA_MODEL` | Sin SDK externo; fetch nativo |
| `openai` | `openai` npm package | `OPENAI_API_KEY` | `OPENAI_MODEL` | Compat. OpenAI API |
| `anthropic` | `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` | Claude API |
| `gemini` | `@google/generative-ai` | `GEMINI_API_KEY` | `GEMINI_MODEL` | Google AI |

---

## Estructura de archivos en el agente generado

Los agentes generados incluirán una subcarpeta `providers/`:

```
<agent-name>/
├── index.ts              # Punto de entrada — sin cambios estructurales
├── package.json          # Dependencias dinámicas según provider elegido
├── .env                  # PROVIDER + variables del proveedor elegido
├── providers/
│   ├── types.ts          # Interfaz LLMProvider + Message
│   ├── factory.ts        # createProvider() — lee PROVIDER del .env
│   ├── lmstudio.ts       # Implementación LM Studio
│   ├── ollama.ts         # Implementación Ollama (HTTP local)
│   ├── openai.ts         # Implementación OpenAI
│   ├── anthropic.ts      # Implementación Anthropic
│   └── gemini.ts         # Implementación Gemini
└── workspace/            # Opcional
```

El `factory.ts` usa un **registro declarativo** (lookup map) en lugar de un switch. Añadir un proveedor nuevo = una línea en el mapa, sin tocar la lógica de la función:

```typescript
// providers/factory.ts
import type { LLMProvider } from './types';

type ProviderFactory = () => Promise<LLMProvider>;

const REGISTRY: Record<string, ProviderFactory> = {
  lmstudio:  () => import('./lmstudio').then(m => new m.LMStudioProvider()),
  ollama:    () => import('./ollama').then(m => new m.OllamaProvider()),
  openai:    () => import('./openai').then(m => new m.OpenAIProvider()),
  anthropic: () => import('./anthropic').then(m => new m.AnthropicProvider()),
  gemini:    () => import('./gemini').then(m => new m.GeminiProvider()),
};

export async function createProvider(): Promise<LLMProvider> {
  const name = process.env.PROVIDER ?? 'lmstudio';
  const factory = REGISTRY[name];
  if (!factory) {
    throw new Error(
      `Provider desconocido: "${name}". Válidos: ${Object.keys(REGISTRY).join(', ')}`
    );
  }
  return factory();
}
```

**Por qué registry map y no switch:**
- Switch crece linealmente con cada proveedor — difícil de mantener
- El mapa es declarativo: la estructura de datos comunica las opciones, no la lógica
- Añadir proveedor = 1 línea; el mensaje de error se genera automáticamente desde las keys del mapa
- Los imports son lazy (dynamic) igual que con switch — sin penalización de rendimiento

**Nota:** Todos los archivos de providers se incluyen en el agente generado siempre — no se excluyen los no usados. Esto simplifica el generador y permite al usuario cambiar de proveedor editando solo el `.env` sin re-generar el agente.

---

## Cambios en el sistema de generación

### 1. `AgentConfig` — campos nuevos `provider` y `apiKey`

```typescript
// src/cli/prompts.ts
export interface AgentConfig {
  name: string;
  description: string;
  role: string;
  needsWorkspace: boolean;
  provider: 'lmstudio' | 'ollama' | 'openai' | 'anthropic' | 'gemini'; // NUEVO
  apiKey?: string; // NUEVO — solo para proveedores que la requieren
}
```

Los proveedores locales (`lmstudio`, `ollama`) no requieren API key — `apiKey` queda `undefined`.
Los proveedores privados (`openai`, `anthropic`, `gemini`) sí la requieren.

Helper para determinar si un proveedor requiere key:

```typescript
const REQUIRES_API_KEY = new Set(['openai', 'anthropic', 'gemini']);
export const requiresApiKey = (provider: AgentConfig['provider']) =>
  REQUIRES_API_KEY.has(provider);
```

El CLI `bun run dev` preguntará al usuario qué proveedor quiere y, si requiere API key, pedirá la key en el siguiente paso. El desktop app lo gestiona via formulario condicional.

### 2. Templates — nueva estructura

Los archivos de template existentes se actualizan y se añaden nuevos:

```
src/templates/basic-agent/
├── index.ts.tpl              # ACTUALIZADO — usa createProvider(), elimina LMStudioClient directo
├── package.json.tpl          # ACTUALIZADO — dependencias dinámicas via {{PROVIDER_DEPS}}
├── providers/
│   ├── types.ts.tpl          # NUEVO — interfaz LLMProvider (sin placeholders, copiado literal)
│   ├── factory.ts.tpl        # NUEVO — createProvider() con registry map (sin placeholders, copiado literal)
│   ├── lmstudio.ts.tpl       # NUEVO — implementación LM Studio
│   ├── ollama.ts.tpl         # NUEVO — implementación Ollama
│   ├── openai.ts.tpl         # NUEVO — implementación OpenAI
│   ├── anthropic.ts.tpl      # NUEVO — implementación Anthropic
│   └── gemini.ts.tpl         # NUEVO — implementación Gemini
└── .env.tpl                  # NUEVO — template de .env con variables del proveedor elegido
```

### 3. `scaffoldAgent` — crea subcarpeta `providers/`

- Crea `providers/` dentro del agente
- Copia todos los archivos `providers/*.ts.tpl` al destino
- El `.env` generado incluye `PROVIDER={{PROVIDER}}` y las variables correspondientes al proveedor elegido
- Usa el placeholder `{{PROVIDER_DEPS}}` en `package.json.tpl` para inyectar solo la dependencia del proveedor elegido (optimiza el `bun install`)

### 4. `package.json.tpl` — dependencias por proveedor

Solo se instala la dependencia del proveedor elegido. Mapa:

| Provider | Dependencia npm |
|---|---|
| `lmstudio` | `"@lmstudio/sdk": "^1.0.0"` |
| `ollama` | *(ninguna — usa fetch nativo de Bun)* |
| `openai` | `"openai": "^4.0.0"` |
| `anthropic` | `"@anthropic-ai/sdk": "^0.39.0"` |
| `gemini` | `"@google/generative-ai": "^0.24.0"` |

### 5. `.env` generado — variables por proveedor

La API key se recoge durante la creación, se **encripta antes de escribir** al disco, y se almacena con el prefijo `enc:`. Los proveedores locales no tienen key.

```
# lmstudio  →  sin API key
PROVIDER=lmstudio
LM_STUDIO_MODEL=""

# ollama  →  sin API key
PROVIDER=ollama
OLLAMA_MODEL="llama3.2"

# openai  →  key encriptada
PROVIDER=openai
OPENAI_API_KEY="enc:a1b2c3...:d4e5f6...:7890ab..."
OPENAI_MODEL="gpt-4o-mini"

# anthropic  →  key encriptada
PROVIDER=anthropic
ANTHROPIC_API_KEY="enc:a1b2c3...:d4e5f6...:7890ab..."
ANTHROPIC_MODEL="claude-3-5-haiku-20241022"

# gemini  →  key encriptada
PROVIDER=gemini
GEMINI_API_KEY="enc:a1b2c3...:d4e5f6...:7890ab..."
GEMINI_MODEL="gemini-2.0-flash"
```

El formato `enc:<iv_hex>:<authTag_hex>:<ciphertext_hex>` es opaco y compatible hacia atrás — si el valor no empieza por `enc:`, se usa tal cual (permite migración manual).

Si el usuario deja la key vacía durante la creación, se escribe vacía — el agente fallará al llamar al proveedor con un error claro (`ANTHROPIC_API_KEY is not set`), no silenciosamente.

---

## Cambios en la DB

Nueva migración (version 3) para añadir columna `provider` a la tabla `agents`:

```sql
ALTER TABLE agents ADD COLUMN provider TEXT NOT NULL DEFAULT 'lmstudio';
```

El `agentRepository` recibe el nuevo campo en `insert()` y en `AgentRecord`.

---

## Cambios en el desktop (IPC + renderer)

### IPC

`AgentConfig` ya es el type compartido entre CLI y IPC. Al añadir `provider` a `AgentConfig` en `src/cli/prompts.ts`, el contrato IPC se actualiza automáticamente.

Se añade un nuevo canal de solo lectura para que el renderer pueda obtener la lista de proveedores disponibles:

```typescript
listProviders: { params: undefined; response: ListProvidersResult };
```

### Renderer — formulario

`src/renderer/views/create-agent.ts` añade:
1. Un `<select>` con las 5 opciones de proveedor
2. Un campo `<input type="password" placeholder="API Key">` que se muestra/oculta condicionalmente — solo visible cuando el proveedor seleccionado es `openai`, `anthropic` o `gemini`

El label del campo cambia según el proveedor: `"OpenAI API Key"`, `"Anthropic API Key"`, `"Gemini API Key"`.

Ambos valores (`provider` + `apiKey`) se envían en el `AgentConfig` al llamar `generateAgent`.

---

## Encriptación de API keys

### Algoritmo

**AES-256-GCM** via `node:crypto` (built-in en Bun, sin dependencias extra). GCM proporciona encriptación autenticada — detecta si el valor fue manipulado.

### Master key

- Generada una sola vez (32 bytes aleatorios) y guardada en `<userData>/master.key`
- `userData` es el mismo directorio donde vive la base de datos SQLite del app (`src/db/database.ts` ya lo calcula)
- El archivo `master.key` vive **fuera** de los agentes generados — nunca entra a git
- Si no existe al arrancar, se genera automáticamente

### Módulo `src/utils/crypto.ts`

```typescript
// Encripta una API key antes de escribirla al .env
export function encryptApiKey(plaintext: string): string
// → "enc:<iv_hex>:<authTag_hex>:<ciphertext_hex>"

// Desencripta si el valor tiene prefijo "enc:", lo devuelve tal cual si no
export function decryptIfNeeded(value: string): string
// → plaintext original
```

### Flujo completo

```
[usuario introduce key] → encryptApiKey() → "enc:..." → .env del agente
                                                              ↓
[agente arranca]    → process.env.ANTHROPIC_API_KEY → decryptIfNeeded() → SDK
```

### Dónde se llama cada función

| Función | Llamada desde |
|---|---|
| `encryptApiKey()` | `scaffoldAgent()` en `agentGenerator.ts`, antes de escribir el `.env` |
| `decryptIfNeeded()` | Cada implementación de proveedor (`anthropic.ts`, `openai.ts`, `gemini.ts`) al leer su env var |

Los proveedores locales (`lmstudio`, `ollama`) no leen ninguna API key — no llaman a `decryptIfNeeded`.

---

## Compatibilidad con el enhancer de prompts

El módulo `src/enhancer/` actualmente usa LM Studio para mejorar prompts. Esto es independiente del proveedor del agente generado — el enhancer usa LM Studio del host, no el proveedor del agente. No requiere cambios en `src/enhancer/`.

---

## Estructura de carpetas — cambios en src/

```
src/
├── utils/
│   └── crypto.ts           NUEVO — encryptApiKey(), decryptIfNeeded(), getMasterKey()
├── cli/
│   └── prompts.ts          MODIFICAR — añadir campo provider + apiKey + preguntas en interview
├── generators/
│   └── agentGenerator.ts   MODIFICAR — scaffoldAgent copia providers/, encripta key, genera .env dinámico
├── templates/
│   └── basic-agent/
│       ├── index.ts.tpl    MODIFICAR — usa createProvider()
│       ├── package.json.tpl MODIFICAR — placeholder {{PROVIDER_DEP}}
│       ├── .env.tpl        NUEVO — template de .env con vars según provider
│       └── providers/      NUEVA CARPETA
│           ├── types.ts.tpl
│           ├── factory.ts.tpl
│           ├── lmstudio.ts.tpl
│           ├── ollama.ts.tpl
│           ├── openai.ts.tpl     — llama decryptIfNeeded() al leer OPENAI_API_KEY
│           ├── anthropic.ts.tpl  — llama decryptIfNeeded() al leer ANTHROPIC_API_KEY
│           └── gemini.ts.tpl     — llama decryptIfNeeded() al leer GEMINI_API_KEY
├── types/
│   └── ipc.ts              MODIFICAR — ListProvidersResult
├── ipc/
│   └── handlers.ts         MODIFICAR — handler listProviders
├── db/
│   └── migrations.ts       MODIFICAR — migration v3, columna provider
├── db/
│   └── agentRepository.ts  MODIFICAR — insert y AgentRecord incluyen provider
└── renderer/
    └── views/
        └── create-agent.ts MODIFICAR — añadir <select> de proveedor + <input type="password"> condicional
```

---

## Lista de tareas priorizada para Cloe

### Prioridad 1 — Contratos y tipos base

1. Añadir `provider` y `apiKey?` a `AgentConfig` en `src/cli/prompts.ts` + helper `requiresApiKey()`
2. Añadir `ListProvidersResult` a `src/types/ipc.ts` + canal `listProviders`
3. Añadir migration v3 en `src/db/migrations.ts`
4. Actualizar `agentRepository.ts` — columna `provider` en insert y record
5. Crear `src/utils/crypto.ts` — `encryptApiKey()`, `decryptIfNeeded()`, `getMasterKey()` (AES-256-GCM, master key en userData)

### Prioridad 2 — Templates de agente

5. Crear `src/templates/basic-agent/providers/types.ts.tpl`
6. Crear `src/templates/basic-agent/providers/factory.ts.tpl`
7. Crear los 5 archivos de implementación `.tpl` (lmstudio, ollama, openai, anthropic, gemini)
8. Actualizar `index.ts.tpl` — reemplazar LMStudioClient por `createProvider()`
9. Actualizar `package.json.tpl` — placeholder `{{PROVIDER_DEP}}`
10. Crear `.env.tpl` para generación dinámica del `.env`

### Prioridad 3 — Generador

11. Actualizar `scaffoldAgent` en `agentGenerator.ts` — crear carpeta `providers/`, copiar todos los `.tpl`, **encriptar `apiKey` con `encryptApiKey()` antes de inyectarla**, generar `.env` dinámico

### Prioridad 4 — CLI

12. Añadir pregunta de proveedor en `runInterview()` de `src/cli/prompts.ts`
13. Añadir pregunta condicional de API key — solo si `requiresApiKey(provider)` es `true`; usar `password()` de `@clack/prompts` para ocultar el input

### Prioridad 5 — Desktop IPC y renderer

14. Implementar handler `listProviders` en `src/ipc/handlers.ts`
15. Añadir `<select>` de proveedor en `src/renderer/views/create-agent.ts`
16. Añadir `<input type="password">` condicional para API key — visible solo para `openai`, `anthropic`, `gemini`; label dinámico según proveedor

---

## Restricciones importantes

- NO modificar `src/index.ts`, `src/client.ts`
- El modo TTY del template generado DEBE seguir funcionando — `createProvider()` se usa igual en TTY y ACP
- `generateAgent()` (función CLI con spinners) pasa el nuevo `provider` field sin cambios en su flujo
- Los agentes ya existentes en la DB tienen `provider='lmstudio'` por default (via migration) y sus `index.ts` no se reescriben — backward compatible
- `ollama` no requiere dependencia npm: Bun tiene `fetch` nativo; el `package.json.tpl` no inyecta nada para ollama
