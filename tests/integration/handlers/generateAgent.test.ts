import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { setupTestDb, teardownTestDb, getTestDb } from '../../helpers/testDb';

// mock.module must be declared BEFORE importing modules that depend on it
mock.module('../../../src/db/database', () => ({
  getDatabase: () => getTestDb(),
  initDatabase: () => getTestDb(),
}));

// Import AFTER mock declaration
import { agentRepository } from '../../../src/db/agentRepository';
import { handleGenerateAgent } from '../../../src/ipc/handlerLogic';
import type { GenerateAgentDeps } from '../../../src/ipc/handlerLogic';

function makeDeps(overrides: Partial<GenerateAgentDeps> = {}): GenerateAgentDeps {
  return {
    agentRepository,
    scaffoldAgent: async (_config, baseDir) => `${baseDir}/test-agent`,
    installAgentDeps: (_dir, cb) => { cb(); },  // no-op, llama cb de inmediato
    enhanceAndPersist: async () => {},           // no-op
    onInstallDone: () => {},
    onEnhanceDone: () => {},
    rmSync: () => {},
    ...overrides,
  };
}

const VALID_CONFIG = {
  name: 'test-agent',
  description: 'A test agent',
  role: 'You are a helpful test agent with enough characters.',
  needsWorkspace: false,
  provider: 'lmstudio' as const,
};

describe('handleGenerateAgent', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  it('retorna error si config.name esta ausente', async () => {
    const result = await handleGenerateAgent(
      { ...VALID_CONFIG, name: '' },
      '/fake/agents',
      makeDeps()
    );
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('retorna error si config.name contiene caracteres invalidos', async () => {
    const result = await handleGenerateAgent(
      { ...VALID_CONFIG, name: 'Invalid Name' },
      '/fake/agents',
      makeDeps()
    );
    expect(result.success).toBe(false);
  });

  it('retorna error si provider es invalido', async () => {
    const result = await handleGenerateAgent(
      { ...VALID_CONFIG, provider: 'invalid' as any },
      '/fake/agents',
      makeDeps()
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Proveedor invalido');
  });

  it('retorna error si el agente ya existe en DB', async () => {
    agentRepository.insert({
      name: 'test-agent',
      description: 'existing',
      systemPrompt: 'existing',
      model: '',
      hasWorkspace: false,
      path: '/fake/path',
      provider: 'lmstudio',
    });
    const result = await handleGenerateAgent(VALID_CONFIG, '/fake/agents', makeDeps());
    expect(result.success).toBe(false);
    expect(result.error).toContain('ya existe');
  });

  it('happy path retorna success:true', async () => {
    const result = await handleGenerateAgent(VALID_CONFIG, '/fake/agents', makeDeps());
    expect(result.success).toBe(true);
  });

  it('happy path inserta el agente en la DB', async () => {
    await handleGenerateAgent(VALID_CONFIG, '/fake/agents', makeDeps());
    const found = agentRepository.findByName('test-agent');
    expect(found).not.toBeNull();
    expect(found?.name).toBe('test-agent');
  });

  it('llama rmSync si la insercion en DB falla', async () => {
    let rmCalled = false;
    const deps = makeDeps({
      rmSync: () => { rmCalled = true; },
      agentRepository: {
        findByName: () => null,
        insert: () => { throw new Error('DB error simulado'); },
      },
    });
    const result = await handleGenerateAgent(VALID_CONFIG, '/fake/agents', deps);
    expect(result.success).toBe(false);
    expect(rmCalled).toBe(true);
  });

  it('llama onInstallDone al completar installAgentDeps', async () => {
    let installDoneCalled = false;
    const deps = makeDeps({
      onInstallDone: () => { installDoneCalled = true; },
      installAgentDeps: (_dir, cb) => { cb(); },
    });
    await handleGenerateAgent(VALID_CONFIG, '/fake/agents', deps);
    expect(installDoneCalled).toBe(true);
  });

  it('retorna success:false si scaffoldAgent lanza un error', async () => {
    const deps = makeDeps({
      scaffoldAgent: async () => { throw new Error('scaffold failed'); },
    });
    const result = await handleGenerateAgent(VALID_CONFIG, '/fake/agents', deps);
    expect(result.success).toBe(false);
    expect(result.error).toContain('scaffold failed');
  });
});
