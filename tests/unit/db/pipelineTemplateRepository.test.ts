import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { setupTestDb, teardownTestDb, getTestDb } from '../../helpers/testDb';
import { migrations } from '../../../src/db/migrations';
import { builtinTemplates } from '../../../src/db/builtinTemplates';
import { pipelineTemplateRepository } from '../../../src/db/pipelineTemplateRepository';

function applyTestMigrationsWithSeed(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);`);

  const row = db.query<{ version: number }, never[]>(
    'SELECT MAX(version) as version FROM schema_version'
  ).get();

  const currentVersion = row?.version ?? 0;
  const pending = migrations.filter((m) => m.version > currentVersion);

  for (const migration of pending) {
    try {
      db.exec(migration.up);
    } catch (e: any) {
      if (!e?.message?.includes('duplicate column name')) throw e;
    }
    db.run('INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [migration.version]);
  }

  // Seed builtin templates (same logic as database.ts)
  const existing = db.query<{ count: number }, never[]>(
    "SELECT COUNT(*) as count FROM pipeline_templates WHERE is_builtin = 1"
  ).get();

  if (!existing || existing.count === 0) {
    for (const template of builtinTemplates) {
      db.run(
        `INSERT OR IGNORE INTO pipeline_templates (id, name, description, category, variables, steps, is_builtin, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          template.id,
          template.name,
          template.description,
          template.category,
          JSON.stringify(template.variables),
          JSON.stringify(template.steps),
          1,
          template.createdAt,
        ]
      );
    }
  }
}

describe('pipelineTemplateRepository', () => {
  beforeEach(() => {
    // Override setupTestDb to use our version with seed
    const db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    applyTestMigrationsWithSeed(db);
    (global as any).__testDb = db;
  });

  afterEach(() => {
    const db = (global as any).__testDb as Database;
    if (db) db.close();
    delete (global as any).__testDb;
  });

  function getTestDb(): Database {
    const db = (global as any).__testDb as Database;
    if (!db) throw new Error('testDb not initialized');
    return db;
  }

  describe('listTemplates', () => {
    it('retorna los 4 templates builtin', () => {
      const db = getTestDb();
      const templates = pipelineTemplateRepository.listTemplates(db);
      expect(templates).toHaveLength(4);
    });

    it('cada template tiene los campos correctos', () => {
      const db = getTestDb();
      const templates = pipelineTemplateRepository.listTemplates(db);
      for (const t of templates) {
        expect(typeof t.id).toBe('string');
        expect(typeof t.name).toBe('string');
        expect(typeof t.description).toBe('string');
        expect(typeof t.category).toBe('string');
        expect(typeof t.isBuiltin).toBe('boolean');
        expect(t.isBuiltin).toBe(true);
        expect(typeof t.stepCount).toBe('number');
      }
    });

    it('stepCount refleja el numero de steps', () => {
      const db = getTestDb();
      const templates = pipelineTemplateRepository.listTemplates(db);
      const contentCreator = templates.find((t) => t.id === 'builtin-content-creator');
      expect(contentCreator?.stepCount).toBe(3);
    });
  });

  describe('getTemplate', () => {
    it('retorna un template por id con variables y steps parseados', () => {
      const db = getTestDb();
      const template = pipelineTemplateRepository.getTemplate(db, 'builtin-content-creator');
      expect(template).not.toBeNull();
      expect(template!.id).toBe('builtin-content-creator');
      expect(template!.name).toBe('Content Creator');
      expect(Array.isArray(template!.variables)).toBe(true);
      expect(template!.variables.length).toBeGreaterThan(0);
      expect(Array.isArray(template!.steps)).toBe(true);
      expect(template!.steps.length).toBe(3);
    });

    it('retorna null para id inexistente', () => {
      const db = getTestDb();
      const template = pipelineTemplateRepository.getTemplate(db, 'inexistente');
      expect(template).toBeNull();
    });
  });

  describe('seed idempotencia', () => {
    it('segunda llamada a seed no duplica templates', () => {
      const db = getTestDb();

      // Re-apply seed logic
      const existing = db.query<{ count: number }, never[]>(
        "SELECT COUNT(*) as count FROM pipeline_templates WHERE is_builtin = 1"
      ).get();

      if (!existing || existing.count === 0) {
        for (const template of builtinTemplates) {
          db.run(
            `INSERT OR IGNORE INTO pipeline_templates (id, name, description, category, variables, steps, is_builtin, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              template.id,
              template.name,
              template.description,
              template.category,
              JSON.stringify(template.variables),
              JSON.stringify(template.steps),
              1,
              template.createdAt,
            ]
          );
        }
      }

      const templates = pipelineTemplateRepository.listTemplates(db);
      expect(templates).toHaveLength(4);
    });
  });

  describe('deleteTemplate', () => {
    it('no puede borrar un template builtin', () => {
      const db = getTestDb();
      pipelineTemplateRepository.deleteTemplate(db, 'builtin-content-creator');
      // Still exists because is_builtin = 1 protects it
      const template = pipelineTemplateRepository.getTemplate(db, 'builtin-content-creator');
      expect(template).not.toBeNull();
    });

    it('puede borrar un template custom', () => {
      const db = getTestDb();
      const created = pipelineTemplateRepository.createTemplate(db, {
        name: 'Custom Template',
        description: 'Test',
        category: 'custom',
        variables: [],
        steps: [],
        isBuiltin: false,
      });
      const found = pipelineTemplateRepository.getTemplate(db, created.id);
      expect(found).not.toBeNull();

      pipelineTemplateRepository.deleteTemplate(db, created.id);
      const afterDelete = pipelineTemplateRepository.getTemplate(db, created.id);
      expect(afterDelete).toBeNull();
    });
  });

  describe('createTemplate', () => {
    it('crea un template custom y lo retorna con id', () => {
      const db = getTestDb();
      const result = pipelineTemplateRepository.createTemplate(db, {
        name: 'Mi Template',
        description: 'Descripcion de prueba',
        category: 'custom',
        variables: [{ name: 'input', label: 'Input', type: 'text', required: true }],
        steps: [{ order: 1, name: 'Step 1', agentRoleHint: 'test', inputTemplate: '{{input}}', description: 'Test step' }],
        isBuiltin: false,
      });

      expect(result.id).toBeDefined();
      const found = pipelineTemplateRepository.getTemplate(db, result.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Mi Template');
      expect(found!.isBuiltin).toBe(false);
    });
  });
});