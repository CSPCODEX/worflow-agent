# Flujos de datos — Panel de settings

## Flujo 1: Usuario abre la vista de settings

```
[Usuario click "Settings"]
        |
        v
[app.ts: showSettings()]
        |
        v
[renderer/views/settings.ts: renderSettings(container)]
        |
        | rpc.request.loadSettings()
        v
[handlers.ts: loadSettings handler]
        |
        v
[settingsRepository.getAll()]  --> bun:sqlite SELECT key, value FROM settings
        |
        | + USER_DATA_DIR (no viene de DB)
        v
[Response: LoadSettingsResult { settings: AppSettings }]
        |
        v
[settings.ts: rellena el formulario con los valores recibidos]
```

---

## Flujo 2: Usuario guarda settings

```
[Usuario click "Guardar"]
        |
        v
[settings.ts: validacion client-side]
  - lmstudioHost no vacio
  - solo ASCII
        |
        | si invalido: muestra error inline, no llama IPC
        v
[rpc.request.saveSettings({ lmstudioHost, enhancerModel })]
        |
        v
[handlers.ts: saveSettings handler]
        |
        v
[handleSaveSettings(params)]
  - validar params
  - settingsRepository.set('lmstudio_host', params.lmstudioHost)
  - settingsRepository.set('enhancer_model', params.enhancerModel)
        |
        v
[Response: { success: true }]
        |
        v
[settings.ts: muestra feedback "Guardado" o error]
```

---

## Flujo 3: Enhancer consume el host de LM Studio

```
[handleGenerateAgent: enhanceAndPersist() llamado en background]
        |
        v
[promptEnhancer.ts: enhanceWithLmStudio()]
        |
        v
[lmStudioEnhancer.ts]
        |
        | settingsRepository.get('lmstudio_host')
        v
[settingsRepository: SELECT value FROM settings WHERE key = 'lmstudio_host']
        |
        | si no hay fila: usa default 'ws://127.0.0.1:1234'
        v
[new LMStudioClient({ baseUrl: host })]
        |
        v
[LM Studio en el host configurado]
```

---

## Diagrama de modulos

```
src/renderer/app.ts
    |
    +--> src/renderer/views/settings.ts
              |
              | IPC: loadSettings / saveSettings
              v
         src/ipc/handlers.ts
              |
              v
         src/ipc/handlerLogic.ts
              |
              v
         src/db/settingsRepository.ts
              |
              v
         bun:sqlite (tabla: settings)

src/enhancer/lmStudioEnhancer.ts
    |
    +--> src/db/settingsRepository.ts
              |
              v
         bun:sqlite (tabla: settings)
```

---

## Nota sobre USER_DATA_DIR

`dataDir` se muestra en la vista pero NO viaja como setting persistido. El handler `loadSettings` lo obtiene directamente de `USER_DATA_DIR` importado de `src/db/userDataDir.ts` y lo incluye en el response. No hay columna en DB para esto.
