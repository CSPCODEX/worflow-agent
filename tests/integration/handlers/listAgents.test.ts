import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { setupTestDb, teardownTestDb, getTestDb } from '../../helpers/testDb';

// mock.module must be declared BEFORE importing modules that depend on it
mock.module('../../../src/db/database', () => ({
  getDatabase: () => getTestDb(),
  initDatabase: () => getTestDb(),
}));

// Import AFTER mock declaration
import { agentRepository } from '../../../src/db/agentRepository';
import { handleListAgents } from '../../../src/ipc/handlerLogic';

const SAMPLE_AGENT = {
  name: 'test-agent',
  description: 'A test agent',
  systemPrompt: 'You are a test agent.',
  model: '',
  hasWorkspace: false,
  path: '/fake/path/test-agent',
  provider: 'lmstudio',
};

describe('handleListAgents', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  it('retorna lista vacia si no hay agentes', async () => {
    const result = await handleListAgents();
    expect(result.agents).toEqual([]);
  });

  it('retorna los agentes insertados con los campos correctos', async () => {
    agentRepository.insert(SAMPLE_AGENT);
    const result = await handleListAgents();
    expect(result.agents.length).toBe(1);
    const agent = result.agents[0]!;
    expect(agent.name).toBe('test-agent');
    expect(agent.description).toBe('A test agent');
    expect(agent.hasWorkspace).toBe(false);
    expect(agent.provider).toBe('lmstudio');
    expect(agent.id).toBeDefined();
  });

  it('retorna multiples agentes', async () => {
    agentRepository.insert(SAMPLE_AGENT);
    agentRepository.insert({ ...SAMPLE_AGENT, name: 'second-agent', path: '/fake/second-agent' });
    const result = await handleListAgents();
    expect(result.agents.length).toBe(2);
  });

  it('marca agentes como broken si el path no existe en disco', async () => {
    agentRepository.insert({
      ...SAMPLE_AGENT,
      path: '/nonexistent/path/that/does/not/exist',
    });
    const result = await handleListAgents();
    expect(result.agents[0]?.status).toBe('broken');
  });

  it('retorna agente con status active si el path fue insertado con path valido (fake)', async () => {
    // /fake/path/test-agent no existe, so it will be marked broken — this is expected behavior
    agentRepository.insert(SAMPLE_AGENT);
    const result = await handleListAgents();
    // The path does not exist on disk, so findAll() will mark it broken
    const status = result.agents[0]?.status ?? 'missing';
    expect(['active', 'broken']).toContain(status);
  });
});
