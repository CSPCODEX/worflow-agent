# Plan — Persistencia con SQLite y directorio de datos fijo

## Problema

`listAgents` y `scaffoldAgent` usan `process.cwd()` como base. En build/distribución el directorio
de trabajo cambia y los agentes "desaparecen". No hay historial de conversaciones ni mensajes.

## Solucion

Dos capas ortogonales que se implementan en orden:

1. **userDataDir** — directorio fijo multiplataforma resuelto una sola vez al inicio
2. **SQLite via bun:sqlite** — índice de agentes + historial de conversaciones y mensajes

El filesystem sigue siendo la fuente de verdad para los archivos ejecutables del agente.
SQLite es el índice y el historial. Si un agente tiene `path` en DB pero la carpeta no existe,
se marca `status = 'broken'` y se muestra degradado en la UI. No crashea.

---

## Directorio de datos (userDataDir)

| Plataforma | Ruta |
|---|---|
| Windows | `%APPDATA%\Worflow Agent\` |
| macOS | `~/Library/Application Support/Worflow Agent/` |
| Linux | `~/.config/worflow-agent/` |

Estructura interna:

```
<userDataDir>/
├── worflow.db          ← base de datos SQLite
└── agents/             ← carpetas generadas por scaffoldAgent
    └── <agent-name>/
        ├── index.ts
        ├── package.json
        ├── .env
        └── workspace/  (opcional)
```

---

## Schema SQLite

```sql
CREATE TABLE IF NOT EXISTS agents (
  id           TEXT PRIMARY KEY,          -- UUID v4
  name         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  model        TEXT NOT NULL DEFAULT '',
  has_workspace INTEGER NOT NULL DEFAULT 0, -- 0/1 (SQLite no tiene BOOLEAN)
  path         TEXT NOT NULL,             -- ruta absoluta al directorio del agente
  status       TEXT NOT NULL DEFAULT 'active', -- 'active' | 'broken'
  created_at   TEXT NOT NULL              -- ISO 8601
);

CREATE TABLE IF NOT EXISTS conversations (
  id           TEXT PRIMARY KEY,          -- UUID v4
  agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title        TEXT NOT NULL DEFAULT 'Nueva conversacion',
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,       -- UUID v4
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,          -- 'user' | 'assistant'
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
```

---

## Nuevos archivos a crear

```
src/
  db/
    userDataDir.ts      ← resuelve y crea <userDataDir> segun plataforma
    database.ts         ← singleton Database (bun:sqlite), aplica schema, expone queries
    migrations.ts       ← lista de migrations SQL ejecutadas en orden
  ipc/
    handlers.ts         ← MODIFICAR (sustituir process.cwd() → userDataDir + leer/escribir DB)
  ipc/
    acpManager.ts       ← MODIFICAR (resolver agentDir desde DB, no process.cwd())
  types/
    ipc.ts              ← MODIFICAR (nuevos tipos: ConversationInfo, MessageInfo, nuevas respuestas)
```

---

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/ipc/handlers.ts` | `generateAgent` usa `userDataDir/agents/` como base; `listAgents` lee de DB + verifica path; agregar handlers `listConversations`, `getMessages`, `saveMessage`, `createConversation`, `deleteAgent` |
| `src/ipc/acpManager.ts` | `createSession` recibe `agentPath` absoluto en lugar de componer `process.cwd()/agentName` |
| `src/types/ipc.ts` | Nuevas interfaces y nuevos canales RPC |
| `src/desktop/index.ts` | Llamar `initDatabase()` antes de `createRpc()` |

**NO modificar:**
- `src/index.ts`
- `src/client.ts`
- `src/generators/agentGenerator.ts` (la función `scaffoldAgent` recibe `baseDir` por parámetro — sin cambios)
- `src/cli/prompts.ts`
- `src/cli/validations.ts`

---

## Orden de implementacion (prioridad 1-8)

| # | Archivo | Motivo |
|---|---|---|
| 1 | `src/db/userDataDir.ts` | Base de todo lo demás |
| 2 | `src/db/migrations.ts` | Define el schema versionado |
| 3 | `src/db/database.ts` | Singleton que aplica migrations y expone queries |
| 4 | `src/types/ipc.ts` | Contratos nuevos (necesarios para handlers y renderer) |
| 5 | `src/ipc/handlers.ts` | Conecta DB + userDataDir con los handlers existentes y nuevos |
| 6 | `src/ipc/acpManager.ts` | `createSession` acepta `agentPath` absoluto |
| 7 | `src/desktop/index.ts` | Inicializar DB en el arranque |
| 8 | `src/renderer/` (varios) | Adaptar UI para mostrar conversaciones e historial |

---

## Invariantes de diseno

- `bun:sqlite` (built-in) — cero dependencias adicionales
- `userDataDir` se resuelve una vez y se exporta como constante desde `userDataDir.ts`
- Todas las queries van por el singleton `database.ts`; ningún handler importa `bun:sqlite` directamente
- `status = 'broken'` se detecta en `listAgents` comparando `existsSync(agent.path)` — no es un campo que el usuario gestione
- El CLI (`bun run dev`, `bun run chat`) no toca DB ni userDataDir — sigue funcionando sobre `process.cwd()`
- `deleteAgent` en DB no borra archivos del filesystem — eso queda para una feature futura de gestión
- Migrations son append-only: nunca se modifica una migration existente, solo se añaden al final
