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
  {
    version: 2,
    up: `ALTER TABLE agents ADD COLUMN enhance_status TEXT NOT NULL DEFAULT 'pending';`,
  },
  {
    version: 3,
    up: `ALTER TABLE agents ADD COLUMN provider TEXT NOT NULL DEFAULT 'lmstudio';`,
  },
  {
    version: 4,
    up: `
      CREATE TABLE IF NOT EXISTS pipeline_templates (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category    TEXT NOT NULL DEFAULT 'custom',
        variables   TEXT NOT NULL DEFAULT '[]',
        steps       TEXT NOT NULL DEFAULT '[]',
        is_builtin  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pipelines (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        template_id TEXT REFERENCES pipeline_templates(id) ON DELETE SET NULL,
        status      TEXT NOT NULL DEFAULT 'active',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pipeline_steps (
        id             TEXT PRIMARY KEY,
        pipeline_id    TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
        step_order     INTEGER NOT NULL,
        name           TEXT NOT NULL,
        agent_id       TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
        input_template TEXT NOT NULL DEFAULT '',
        created_at     TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pipeline_steps_pipeline ON pipeline_steps(pipeline_id, step_order);

      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id           TEXT PRIMARY KEY,
        pipeline_id  TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
        status       TEXT NOT NULL DEFAULT 'pending'
                     CHECK(status IN ('pending', 'running', 'completed', 'failed', 'paused')),
        variables    TEXT NOT NULL DEFAULT '{}',
        final_output TEXT,
        error        TEXT,
        started_at   TEXT,
        completed_at TEXT,
        created_at   TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline ON pipeline_runs(pipeline_id);

      CREATE TABLE IF NOT EXISTS pipeline_step_runs (
        id             TEXT PRIMARY KEY,
        run_id         TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
        step_id        TEXT NOT NULL REFERENCES pipeline_steps(id) ON DELETE CASCADE,
        step_order     INTEGER NOT NULL,
        agent_name     TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'pending'
                       CHECK(status IN ('pending', 'running', 'completed', 'failed')),
        input_resolved TEXT,
        output         TEXT,
        error          TEXT,
        started_at     TEXT,
        completed_at   TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_step_runs_run ON pipeline_step_runs(run_id, step_order);
    `,
  },
];
