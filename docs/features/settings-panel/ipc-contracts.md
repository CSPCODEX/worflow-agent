# Contratos IPC — Panel de settings

## Nuevos canales request/response (bun side)

### `loadSettings`

Carga todos los settings actuales desde la DB. No tiene params.

```typescript
// Params
undefined

// Response
interface LoadSettingsResult {
  settings: AppSettings;
}

interface AppSettings {
  lmstudioHost: string;      // default: "ws://127.0.0.1:1234"
  enhancerModel: string;     // default: "" (primer modelo disponible)
  dataDir: string;           // readonly — valor de USER_DATA_DIR, no viene de DB
}
```

### `saveSettings`

Persiste los settings editables. El campo `dataDir` no se acepta — es readonly.

```typescript
// Params
interface SaveSettingsParams {
  lmstudioHost: string;
  enhancerModel: string;
}

// Response
interface SaveSettingsResult {
  success: boolean;
  error?: string;
}
```

---

## Cambios en AppRPC (src/types/ipc.ts)

```typescript
// Dentro de AppRPC > bun > requests:
loadSettings: { params: undefined; response: LoadSettingsResult };
saveSettings: { params: SaveSettingsParams; response: SaveSettingsResult };
```

---

## Validaciones en handleSaveSettings

- `lmstudioHost`: no puede estar vacio; debe ser string; long max 256 chars.
  - No se valida que sea un URL WebSocket valido — responsabilidad del usuario.
- `enhancerModel`: puede estar vacio (string); max 128 chars.
- Ambos campos deben ser ASCII 0x20–0x7E (regla IPC de WebView2 Windows).

---

## No hay eventos push (messages)

`loadSettings` y `saveSettings` son operaciones sincronas simples. No hay notificaciones asincronas al renderer.
