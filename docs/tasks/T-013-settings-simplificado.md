# T-013 — Settings simplificado

**Status:** TODO
**Phase:** Fase 1
**Agente responsable:** Cloe
**Depende de:** T-006
**Esfuerzo estimado:** 2 días

## Descripción

Actualizar el panel de settings para el nuevo producto. Simplificar la configuración de provider (auto-detect para locales, API key para cloud) y añadir validación de conexión con feedback visual.

## Solución técnica

Actualizar `src/renderer/views/settings.ts`:

**Sección "Modelo de IA" (reemplaza configuración técnica actual)**

```
¿Qué modelo quieres usar?

○ Modelo local (recomendado)
  LM Studio  [●] Detectado en localhost:1234    [Probar conexión]
  Ollama     [○] No detectado                   [Probar conexión]

○ API Cloud (requiere API key)
  OpenAI     [_________________] API Key        [Probar conexión]
  Anthropic  [_________________] API Key        [Probar conexión]
  Gemini     [_________________] API Key        [Probar conexión]

Provider activo: LM Studio ✓
```

**Lógica:**
- Al abrir Settings, llamar a `detectLocalProviders` para mostrar disponibilidad real
- "Probar conexión" llama a `validateProviderConnection` IPC y muestra resultado (verde/rojo)
- Al seleccionar un provider, guardarlo en `default_provider` via `saveSettings` IPC
- El provider activo se muestra claramente

**Sección "Acerca de"**
- Versión de la app
- Link a documentación

Eliminar de Settings:
- Configuración de provider por agente individual (queda para V1)
- Opciones técnicas que no son relevantes para el usuario no técnico

## Criterios de aceptación

- [ ] Settings muestra el estado real de LM Studio y Ollama (verde/rojo)
- [ ] "Probar conexión" da feedback inmediato (< 3 segundos) para cada provider
- [ ] Al seleccionar un provider, se guarda en DB y se usa en todos los agentes
- [ ] Las API keys de cloud se guardan encriptadas (usando `src/utils/crypto.ts` existente)
- [ ] El provider activo se muestra claramente en Settings
- [ ] Al cambiar el provider, los nuevos pipelines usan el nuevo provider

## Subtareas

- [ ] Actualizar `src/renderer/views/settings.ts` con la nueva UI de providers
- [ ] Implementar "Probar conexión" para cada provider con `validateProviderConnection` IPC
- [ ] Conectar el selector de provider con `saveSettings` IPC
- [ ] Verificar que las API keys se guardan con `crypto.ts` (encriptadas)
- [ ] Añadir sección "Acerca de" con versión de la app
- [ ] Eliminar opciones de configuración técnica que no aplican al MVP

## Notas

- Las API keys nunca deben mostrarse en texto plano después de guardarse — usar input type="password" y mostrar solo los últimos 4 caracteres como confirmación.
- El provider configurado en Settings es el que usa `PipelineRunner` (T-004). El override por agente individual queda para V1.
- Si el usuario tiene LM Studio Y Ollama disponibles, el primero detectado se sugiere como activo. El usuario puede cambiarlo manualmente.
