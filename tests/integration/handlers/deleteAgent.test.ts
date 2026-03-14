import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { setupTestDb, teardownTestDb, getTestDb } from '../../helpers/testDb';

// mock.module must be declared BEFORE importing modules that depend on it
mock.module('../../../src/db/database', () => ({
  getDatabase: () => getTestDb(),
  initDatabase: () => getTestDb(),
}));

// Import AFTER mock declaration
import { agentRepository } from '../../../src/db/agentRepository';
import { handleDeleteAgent } from '../../../src/ipc/handlerLogic';
import type { DeleteAgentDeps } from '../../../src/ipc/handlerLogic';

const SAMPLE_AGENT = {
  name: 'test-agent',
  description: 'A test agent',
  systemPrompt: 'You are a test agent.',
  model: '',
  hasWorkspace: false,
  path: '/fake/path/test-agent',
  provider: 'lmstudio',
};

function makeDeps(overrides: Partial<DeleteAgentDeps> = {}): DeleteAgentDeps {
  return {
    agentRepository,
    acpManager: {
      closeSessionByAgentName: () => {},
    },
    rmSync: () => {},
    ...overrides,
  };
}

describe('handleDeleteAgent', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  it('retorna error si agentId esta ausente', async () => {
    const result = await handleDeleteAgent(
      { agentId: '', agentName: 'test-agent' },
      makeDeps()
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('agentId');
  });

  it('retorna error si agentName esta ausente', async () => {
    const result = await handleDeleteAgent(
      { agentId: 'some-id', agentName: '' },
      makeDeps()
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('agentName');
  });

  it('retorna error si el agente no existe en DB', async () => {
    const result = await handleDeleteAgent(
      { agentId: 'nonexistent-id', agentName: 'nonexistent-agent' },
      makeDeps()
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('no encontrado');
  });

  it('happy path: retorna success:true y elimina el agente', async () => {
    const record = agentRepository.insert(SAMPLE_AGENT);
    const result = await handleDeleteAgent(
      { agentId: record.id, agentName: record.name },
      makeDeps()
    );
    expect(result.success).toBe(true);
    expect(agentRepository.findById(record.id)).toBeNull();
  });

  it('llama closeSessionByAgentName con el nombre correcto', async () => {
    const record = agentRepository.insert(SAMPLE_AGENT);
    let closedName: string | undefined;
    const deps = makeDeps({
      acpManager: {
        closeSessionByAgentName: (name) => { closedName = name; },
      },
    });
    await handleDeleteAgent({ agentId: record.id, agentName: record.name }, deps);
    expect(closedName).toBe('test-agent');
  });

  it('llama rmSync con el path del agente', async () => {
    const record = agentRepository.insert(SAMPLE_AGENT);
    let deletedPath: string | undefined;
    const deps = makeDeps({
      rmSync: (path) => { deletedPath = path; },
    });
    await handleDeleteAgent({ agentId: record.id, agentName: record.name }, deps);
    expect(deletedPath).toBe('/fake/path/test-agent');
  });

  it('continua con borrado en DB si rmSync lanza un error', async () => {
    const record = agentRepository.insert(SAMPLE_AGENT);
    const deps = makeDeps({
      rmSync: () => { throw new Error('filesystem error'); },
    });
    // rmSync error is caught internally; delete should still proceed
    const result = await handleDeleteAgent(
      { agentId: record.id, agentName: record.name },
      deps
    );
    expect(result.success).toBe(true);
    expect(agentRepository.findById(record.id)).toBeNull();
  });
});
