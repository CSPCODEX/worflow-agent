# Criterios de aceptacion — Panel de settings

## settingsRepository (src/db/settingsRepository.ts)

- [ ] `get(key)` retorna el valor del settings o el default si no existe fila
- [ ] `set(key, value)` hace INSERT OR REPLACE (upsert) con prepared statement
- [ ] `getAll()` retorna objeto con todos los settings aplicando defaults para claves ausentes
- [ ] No usa interpolacion de strings en queries — solo prepared statements
- [ ] Defaults: `lmstudio_host` → `"ws://127.0.0.1:1234"`, `enhancer_model` → `""`

## Handlers IPC (handleLoadSettings, handleSaveSettings)

- [ ] `loadSettings` retorna `AppSettings` con los 3 campos (lmstudioHost, enhancerModel, dataDir)
- [ ] `saveSettings` valida que `lmstudioHost` no este vacio
- [ ] `saveSettings` valida que `lmstudioHost` tenga max 256 chars
- [ ] `saveSettings` valida que `enhancerModel` tenga max 128 chars
- [ ] `saveSettings` retorna `{ success: false, error: "..." }` si falla validacion
- [ ] `saveSettings` retorna `{ success: true }` si persiste correctamente
- [ ] Errores en handlers no contienen tildes ni chars no-ASCII

## AppRPC (src/types/ipc.ts)

- [ ] Canal `loadSettings` tiene params `undefined` y response `LoadSettingsResult`
- [ ] Canal `saveSettings` tiene params `SaveSettingsParams` y response `SaveSettingsResult`
- [ ] Interfaces `AppSettings`, `LoadSettingsResult`, `SaveSettingsParams`, `SaveSettingsResult` definidas

## LM Studio Enhancer (src/enhancer/lmStudioEnhancer.ts)

- [ ] `new LMStudioClient()` ya no usa constructor sin args — usa `{ baseUrl: host }` donde `host` viene de `settingsRepository.get('lmstudio_host')`
- [ ] Si `settingsRepository.get('lmstudio_host')` retorna el default, el comportamiento es identico al anterior (backward compat)
- [ ] Si el usuario configuro un host distinto, el enhancer lo usa

## Vista settings (src/renderer/views/settings.ts)

- [ ] Renderiza formulario con campo `lmstudioHost` (input text), `enhancerModel` (input text), y `dataDir` (readonly)
- [ ] Al montar, llama `loadSettings` y rellena los campos con los valores recibidos
- [ ] El campo `dataDir` esta deshabilitado (readonly), solo informativo
- [ ] El boton "Guardar" llama `saveSettings` con los valores del formulario
- [ ] Si el backend retorna error, se muestra inline sin tilde (o el mensaje del backend ya viene limpio)
- [ ] Si guarda exitosamente, muestra feedback "Guardado" por 2 segundos
- [ ] Labels HTML tienen atributo `for` con `id` matching en el input correspondiente
- [ ] No usa `innerHTML` con input del usuario — usa `textContent` o `escapeHtml`
- [ ] Exporta `renderSettings(container: HTMLElement): { cleanup(): void }` (patron SPA del proyecto)

## Navegacion (src/renderer/app.ts)

- [ ] Existe boton "Settings" en el sidebar (o footer del sidebar)
- [ ] Click en "Settings" llama `showSettings()` y desmonta la vista actual via `teardownCurrentView()`
- [ ] `showSettings` no tiene logica de cleanup de chat (no hay ChatHandle activo cuando se muestran settings)
- [ ] Volver a crear agente o seleccionar agente desde la lista desmonta la vista de settings correctamente

## Casos borde

- [ ] Settings vacios en DB (primera instalacion): la UI muestra los valores default
- [ ] DB no disponible en loadSettings: handler retorna `{ settings: <defaults> }` sin crashear
- [ ] DB no disponible en saveSettings: handler retorna `{ success: false, error: "..." }`
- [ ] Usuario guarda host con solo espacios: validacion client-side lo rechaza
- [ ] Settings se persisten entre reinicios de la app
