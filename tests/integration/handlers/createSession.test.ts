import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { setupTestDb, teardownTestDb, getTestDb } from '../../helpers/testDb';

// mock.module must be declared BEFORE importing modules that depend on it
mock.module('../../../src/db/database', () => ({
  getDatabase: () => getTestDb(),
  initDatabase: () => getTestDb(),
}));

// Import AFTER mock declaration
import { agentRepository } from '../../../src/db/agentRepository';
import { handleCreateSession } from '../../../src/ipc/handlerLogic';
import type { CreateSessionDeps } from '../../../src/ipc/handlerLogic';

const SAMPLE_AGENT = {
  name: 'test-agent',
  description: 'A test agent',
  systemPrompt: 'You are a test agent.',
  model: '',
  hasWorkspace: false,
  path: '/fake/path/test-agent',
  provider: 'lmstudio',
};

function makeAcpStub(overrides: Partial<CreateSessionDeps['acpManager']> = {}): CreateSessionDeps['acpManager'] {
  return {
    createSession: async (_agentName, _path) => ({
      success: true,
      sessionId: 'fake-session-id',
    }),
    ...overrides,
  };
}

describe('handleCreateSession', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  it('retorna error si agentName esta ausente', async () => {
    const result = await handleCreateSession(
      { agentName: '' },
      { agentRepository, acpManager: makeAcpStub() }
    );
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('retorna error si agentName contiene caracteres invalidos', async () => {
    const result = await handleCreateSession(
      { agentName: 'Invalid Name' },
      { agentRepository, acpManager: makeAcpStub() }
    );
    expect(result.success).toBe(false);
  });

  it('retorna error si el agente no existe en DB', async () => {
    const result = await handleCreateSession(
      { agentName: 'nonexistent-agent' },
      { agentRepository, acpManager: makeAcpStub() }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('no encontrado');
  });

  it('retorna error si el agente tiene status broken', async () => {
    const record = agentRepository.insert(SAMPLE_AGENT);
    agentRepository.setStatus(record.id, 'broken');
    const result = await handleCreateSession(
      { agentName: 'test-agent' },
      { agentRepository, acpManager: makeAcpStub() }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('roto');
  });

  it('delega a acpManager.createSession con agentName y path correctos', async () => {
    let capturedName: string | undefined;
    let capturedPath: string | undefined;

    agentRepository.insert(SAMPLE_AGENT);
    // Mark it as active (path doesn't exist on disk, but we bypass findAll here)
    // findByName returns the record directly with stored status
    const acpStub = makeAcpStub({
      createSession: async (name, path) => {
        capturedName = name;
        capturedPath = path;
        return { success: true, sessionId: 'fake-session-id' };
      },
    });

    const result = await handleCreateSession(
      { agentName: 'test-agent' },
      { agentRepository, acpManager: acpStub }
    );

    // Note: findByName returns the agent as inserted (status=active).
    // Only findAll() does the existsSync check. createSession uses findByName.
    expect(result.success).toBe(true);
    expect(capturedName).toBe('test-agent');
    expect(capturedPath).toBe('/fake/path/test-agent');
  });

  it('retorna el sessionId del acpManager al crear con exito', async () => {
    agentRepository.insert(SAMPLE_AGENT);
    const result = await handleCreateSession(
      { agentName: 'test-agent' },
      { agentRepository, acpManager: makeAcpStub() }
    );
    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('fake-session-id');
  });
});
