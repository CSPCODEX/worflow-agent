export interface Migration {
  version: number;
  up: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS agents (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL UNIQUE,
        description   TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        model         TEXT NOT NULL DEFAULT '',
        has_workspace INTEGER NOT NULL DEFAULT 0,
        path          TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'active',
        created_at    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id         TEXT PRIMARY KEY,
        agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        title      TEXT NOT NULL DEFAULT 'Nueva conversacion',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role            TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content         TEXT NOT NULL,
        created_at      TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agent_id);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    `,
  },
];
