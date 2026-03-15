# Plan — Panel de settings

## Objetivo

Proveer una UI en la aplicacion desktop para que el usuario pueda configurar, sin tocar archivos .env ni reiniciar la app:

- Host de LM Studio (default: `ws://127.0.0.1:1234`)
- Modelo por defecto del enhancer de prompts (field `enhancer_model`, default: cadena vacia = primer modelo disponible)
- Directorio de datos personalizado (field `data_dir`, informativo — se muestra el path actual, no es editable en esta iteracion)

Los settings se persisten en la tabla `settings` que ya existe en la DB SQLite (migration v1). El main process expone los valores via una funcion singleton `settingsRepository` para que otros modulos (enhancer) los consuman sin tocar IPC.

---

## Decision de persistencia: tabla `settings` en SQLite (no archivo separado)

**Justificacion:**

La tabla `settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)` ya existe en la DB desde migration v1. Usar esa tabla es la opcion correcta porque:

1. No requiere nueva migration — la tabla ya esta creada.
2. Es consistente con el resto del proyecto: toda la persistencia pasa por la DB.
3. El main process ya tiene acceso a `getDatabase()` — cero nueva infraestructura.
4. Un archivo de config separado (JSON) introduciria un segundo mecanismo de persistencia sin beneficio real para este caso de uso.
5. No hay requirements de portabilidad del archivo de config por si solo.

**Contra un archivo JSON:** La unica ventaja de JSON seria que el usuario puede editarlo a mano. Ese use case no aplica — la UI de settings reemplaza la edicion manual.

---

## Claves de settings definidas

| Clave (key) | Tipo (value) | Default aplicado en codigo | Descripcion |
|---|---|---|---|
| `lmstudio_host` | string | `ws://127.0.0.1:1234` | Host WebSocket de LM Studio para el enhancer |
| `enhancer_model` | string | `""` (cadena vacia = primer modelo disponible) | Modelo especifico para el enhancer. Vacio = auto |

> `data_dir` se muestra en la UI como readonly (valor de `USER_DATA_DIR`). No se persiste como setting — es derivado del sistema.

---

## Arquitectura general

```
src/
  db/
    settingsRepository.ts    [NUEVO] CRUD para tabla settings, con defaults
  ipc/
    handlerLogic.ts          [MODIFICAR] añadir handleLoadSettings, handleSaveSettings
    handlers.ts              [MODIFICAR] registrar canales loadSettings, saveSettings en AppRPC
  types/
    ipc.ts                   [MODIFICAR] añadir tipos Settings*, LoadSettingsResult, SaveSettingsParams, SaveSettingsResult
  renderer/
    views/
      settings.ts            [NUEVO] vista de settings (formulario)
    app.ts                   [MODIFICAR] añadir boton settings en sidebar, wiring de navegacion
  enhancer/
    lmStudioEnhancer.ts      [MODIFICAR] leer host desde settingsRepository en lugar de hardcodear
```

---

## Estructura de carpetas de la feature

```
docs/features/settings-panel/
├── plan.md           (este archivo)
├── ipc-contracts.md
├── data-flows.md
└── acceptance.md
```

---

## Lista de archivos priorizada (orden de implementacion)

1. `src/db/settingsRepository.ts` — base sin dependencias
2. `src/types/ipc.ts` — añadir tipos (compila antes que los handlers)
3. `src/ipc/handlerLogic.ts` — logica pura testeada
4. `src/ipc/handlers.ts` — registrar canales en AppRPC
5. `src/enhancer/lmStudioEnhancer.ts` — consumir settingsRepository
6. `src/renderer/views/settings.ts` — vista nueva
7. `src/renderer/app.ts` — boton settings + navegacion
