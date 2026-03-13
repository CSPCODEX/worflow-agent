# Criterios de Aceptación — Multi-Provider LLM Support

## Componente 1: Tipos y contratos IPC

- [ ] `ProviderId` está definido en `src/types/ipc.ts` como union type de los 5 IDs
- [ ] `AgentConfig` en `src/cli/prompts.ts` incluye campo `provider: ProviderId`
- [ ] `AgentInfo` en `src/types/ipc.ts` incluye campo `provider: ProviderId`
- [ ] `ListProvidersResult` está definido en `src/types/ipc.ts`
- [ ] El canal `listProviders` está registrado en `AppRPC.bun.requests`
- [ ] TypeScript compila sin errores en todo el proyecto (`bun run build` o equivalente)
- [ ] El import circular no existe: `ipc.ts` no importa desde `handlers.ts`

---

## Componente 2: Base de datos

- [ ] Migration v3 añade columna `provider TEXT NOT NULL DEFAULT 'lmstudio'` a tabla `agents`
- [ ] Migration v3 es idempotente (usa la infraestructura de migrations existente que maneja `duplicate column name`)
- [ ] `AgentRow` en `agentRepository.ts` tiene campo `provider: string`
- [ ] `AgentRecord` en `agentRepository.ts` tiene campo `provider: string`
- [ ] `rowToRecord()` mapea `row.provider` a `record.provider`
- [ ] `agentRepository.insert()` acepta y persiste el campo `provider`
- [ ] Los agentes existentes en la DB muestran `provider = 'lmstudio'` tras aplicar la migration
- [ ] `agentRepository.findAll()` retorna `provider` en cada record

---

## Componente 3: Templates de agente

### Interfaz LLMProvider (providers/types.ts.tpl)
- [ ] Define interfaz `Message` con campos `role` y `content`
- [ ] Define interfaz `LLMProvider` con métodos `chat()` y `chatStream()`
- [ ] `chatStream` acepta callback `onChunk: (text: string) => void`
- [ ] Ambos métodos retornan `Promise<string>` (texto completo al finalizar)

### Factory (providers/factory.ts.tpl)
- [ ] Lee `process.env.PROVIDER` con fallback a `'lmstudio'`
- [ ] Soporta los 5 providers: `lmstudio`, `ollama`, `openai`, `anthropic`, `gemini`
- [ ] Lanza error descriptivo para provider desconocido
- [ ] No importa todos los providers de una vez — usa imports dinámicos o switch con require

### Implementación LM Studio (providers/lmstudio.ts.tpl)
- [ ] Implementa `LLMProvider`
- [ ] Usa `@lmstudio/sdk`
- [ ] Lee `LM_STUDIO_MODEL` del env con fallback al primer modelo disponible
- [ ] `chatStream` emite chunks via callback mientras el modelo responde
- [ ] Filtra reasoning tokens (`<|channel|>` y `<think>`) — lógica migrada desde index.ts.tpl original
- [ ] Error descriptivo cuando LM Studio no está corriendo

### Implementación Ollama (providers/ollama.ts.tpl)
- [ ] Implementa `LLMProvider`
- [ ] Usa `fetch` nativo (no SDK externo)
- [ ] Endpoint: `http://localhost:11434/api/chat`
- [ ] Lee `OLLAMA_MODEL` del env con fallback a `'llama3.2'`
- [ ] `chatStream` procesa el stream NDJSON de Ollama y emite chunks via callback
- [ ] Error descriptivo cuando Ollama no está corriendo

### Implementación OpenAI (providers/openai.ts.tpl)
- [ ] Implementa `LLMProvider`
- [ ] Usa `openai` npm package
- [ ] Lee `OPENAI_API_KEY` del env — lanza error si no está definida
- [ ] Lee `OPENAI_MODEL` del env con fallback a `'gpt-4o-mini'`
- [ ] `chatStream` usa streaming de la API de OpenAI y emite chunks
- [ ] Error descriptivo con mensaje que indica dónde configurar la API key

### Implementación Anthropic (providers/anthropic.ts.tpl)
- [ ] Implementa `LLMProvider`
- [ ] Usa `@anthropic-ai/sdk`
- [ ] Lee `ANTHROPIC_API_KEY` del env — lanza error si no está definida
- [ ] Lee `ANTHROPIC_MODEL` del env con fallback a `'claude-3-5-haiku-20241022'`
- [ ] `chatStream` usa streaming messages API y emite chunks
- [ ] Convierte el system prompt del historial al formato `system` param de Anthropic (no como mensaje en array)

### Implementación Gemini (providers/gemini.ts.tpl)
- [ ] Implementa `LLMProvider`
- [ ] Usa `@google/generative-ai`
- [ ] Lee `GEMINI_API_KEY` del env — lanza error si no está definida
- [ ] Lee `GEMINI_MODEL` del env con fallback a `'gemini-2.0-flash'`
- [ ] `chatStream` usa `generateContentStream` y emite chunks
- [ ] Convierte el historial de mensajes al formato de Gemini (`parts: [{ text }]`)

### index.ts.tpl actualizado
- [ ] Ya no importa `LMStudioClient` directamente
- [ ] Importa `createProvider` desde `./providers/factory`
- [ ] `createProvider()` se llama UNA VEZ al inicio (fuera de la clase del agente)
- [ ] La clase del agente usa `provider.chatStream(messages, onChunk)` en lugar de `model.respond()`
- [ ] El modo TTY usa `provider.chatStream(messages, onChunk)` con `process.stdout.write(chunk)` como callback
- [ ] La lógica de `process.stdin.isTTY` sigue intacta y sin cambios estructurales
- [ ] El manejo de errores en `prompt()` mantiene la misma estructura (catch → sessionUpdate con mensaje de error)
- [ ] El archivo compilado con el provider `lmstudio` es funcionalmente idéntico al comportamiento anterior

---

## Componente 4: Generador de agentes

### scaffoldAgent
- [ ] Crea directorio `providers/` dentro del agente
- [ ] Copia los 7 archivos `.tpl` de `src/templates/basic-agent/providers/` al destino
- [ ] Genera `.env` con `PROVIDER=<config.provider>` como primera línea
- [ ] Genera `.env` con las variables correspondientes al proveedor elegido (ver mapa en data-flows.md)
- [ ] Para `lmstudio`: incluye `LM_STUDIO_MODEL=""`
- [ ] Para `ollama`: incluye `OLLAMA_MODEL="llama3.2"`
- [ ] Para `openai`: incluye `OPENAI_API_KEY=""` y `OPENAI_MODEL="gpt-4o-mini"`
- [ ] Para `anthropic`: incluye `ANTHROPIC_API_KEY=""` y `ANTHROPIC_MODEL="claude-3-5-haiku-20241022"`
- [ ] Para `gemini`: incluye `GEMINI_API_KEY=""` y `GEMINI_MODEL="gemini-2.0-flash"`
- [ ] `package.json` generado incluye solo la dependencia del proveedor elegido
- [ ] Para `ollama`: `package.json` no incluye ningún SDK adicional (solo `@agentclientprotocol/sdk` y `dotenv`)
- [ ] La firma de `scaffoldAgent(config: AgentConfig, baseDir: string)` no cambia

### generateAgentCore y generateAgent
- [ ] `generateAgentCore` funciona con el nuevo `AgentConfig` que incluye `provider`
- [ ] `generateAgent` (CLI con spinners) pasa el `provider` correctamente
- [ ] El mensaje de "pasos siguientes" menciona el proveedor y qué variable de env configurar

---

## Componente 5: CLI interactivo

- [ ] `runInterview()` en `src/cli/prompts.ts` presenta una pregunta de selección de proveedor
- [ ] Las 5 opciones se muestran con labels legibles (no solo los IDs)
- [ ] El default es `lmstudio`
- [ ] El resultado del interview incluye `provider` en el objeto `AgentConfig` retornado
- [ ] `bun run dev` completa el flujo completo de creación con cualquiera de los 5 proveedores

---

## Componente 6: Desktop — IPC handler

- [ ] Handler `listProviders` está registrado en `createRpc()` de `src/ipc/handlers.ts`
- [ ] Retorna los 5 proveedores con todos los campos de `ProviderInfo`
- [ ] Handler `generateAgent` valida que `config.provider` sea un valor válido
- [ ] Handler `generateAgent` pasa `provider` a `agentRepository.insert()`
- [ ] Agentes creados sin `provider` (llamadas legacy) usan fallback `'lmstudio'`

---

## Componente 7: Desktop — Renderer (create-agent form)

- [ ] El formulario `create-agent.ts` llama `rpc.request.listProviders()` al montar
- [ ] Se muestra un `<select>` con los 5 proveedores
- [ ] El default del select es `lmstudio`
- [ ] El label de cada opción es el campo `label` de `ProviderInfo` (ej. "LM Studio", no "lmstudio")
- [ ] El campo `provider` se incluye en el objeto enviado a `rpc.request.generateAgent()`
- [ ] Si `listProviders` falla, el selector muestra los 5 providers con valores hardcodeados (fallback en renderer)
- [ ] El selector está visualmente integrado con el estilo existente del formulario

---

## Componente 8: Desktop — sidebar (listAgents)

- [ ] El sidebar muestra un badge o texto con el nombre del proveedor de cada agente
- [ ] Agentes existentes muestran "LM Studio" (valor default de la migration)
- [ ] Agentes con `provider='broken'` (path inexistente) muestran el provider correctamente igual

---

## Criterios de no-regresión

- [ ] `bun run dev` sigue funcionando sin el campo `provider` en la interview (backward compat durante transición)
- [ ] `bun run chat <agente>` lanza un agente existente sin provider definido sin crashear (usa lmstudio por default en .env)
- [ ] Un agente creado con proveedor `lmstudio` se comporta idénticamente al agente generado antes de esta feature
- [ ] El enhancer (`src/enhancer/`) no es modificado y sigue funcionando
- [ ] `acpManager.ts` no es modificado
- [ ] `src/index.ts` no es modificado
- [ ] `src/client.ts` no es modificado
- [ ] El desktop app arranca sin errores con la nueva migration aplicada sobre una DB existente

---

## Pruebas manuales recomendadas para Max

### Test 1: Crear agente con LM Studio (regresión)
1. Desktop app: formulario → provider "LM Studio" → crear agente
2. Verificar que el `.env` del agente tiene `PROVIDER=lmstudio` y `LM_STUDIO_MODEL=""`
3. Verificar que `providers/` existe con 7 archivos
4. Verificar que el agente aparece en el sidebar con badge "LM Studio"

### Test 2: Crear agente con OpenAI (nuevo provider)
1. Desktop app: formulario → provider "OpenAI" → crear agente
2. Verificar `.env` con `PROVIDER=openai`, `OPENAI_API_KEY=""`, `OPENAI_MODEL="gpt-4o-mini"`
3. Verificar `package.json` tiene `"openai"` como dependencia
4. Verificar que `bun install` se completa sin errores

### Test 3: Crear agente con Ollama (provider sin SDK)
1. Desktop app: formulario → provider "Ollama" → crear agente
2. Verificar `.env` con `PROVIDER=ollama`, `OLLAMA_MODEL="llama3.2"`
3. Verificar `package.json` NO tiene dependencia adicional para ollama
4. Verificar que `bun install` se completa sin errores

### Test 4: CLI bun run dev con proveedor Anthropic
1. `bun run dev` → completar interview → seleccionar "Anthropic"
2. Verificar agente generado con estructura correcta
3. Verificar mensaje de pasos siguientes menciona `ANTHROPIC_API_KEY`

### Test 5: Regresión TTY mode
1. Crear agente con lmstudio
2. `cd <agente> && bun run start` (con LM Studio corriendo)
3. Verificar que el REPL interactivo funciona igual que antes

### Test 6: DB migration sobre base existente
1. Arrancar desktop app con DB v2 existente
2. Verificar migration v3 se aplica sin errores
3. Verificar agentes existentes tienen `provider='lmstudio'`
4. Verificar que el listado de agentes carga correctamente
