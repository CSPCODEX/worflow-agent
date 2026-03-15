import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { setupTestDb, teardownTestDb, getTestDb } from '../../helpers/testDb';

// mock.module must be declared BEFORE importing modules that depend on it
mock.module('../../../src/db/database', () => ({
  getDatabase: () => getTestDb(),
  initDatabase: () => getTestDb(),
}));

// Import AFTER mock declaration
import { agentRepository } from '../../../src/db/agentRepository';
import { conversationRepository } from '../../../src/db/conversationRepository';
import { handleSaveMessage } from '../../../src/ipc/handlerLogic';

const SAMPLE_AGENT = {
  name: 'test-agent',
  description: 'A test agent',
  systemPrompt: 'You are a test agent.',
  model: '',
  hasWorkspace: false,
  path: '/fake/path/test-agent',
  provider: 'lmstudio',
};

describe('handleSaveMessage', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  it('retorna error si el role es invalido', async () => {
    const result = await handleSaveMessage({
      conversationId: 'fake-conv-id',
      role: 'invalid-role',
      content: 'test message',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('role invalido');
  });

  it('retorna error para role vacio', async () => {
    const result = await handleSaveMessage({
      conversationId: 'fake-conv-id',
      role: '',
      content: 'test message',
    });
    expect(result.success).toBe(false);
  });

  it('guarda mensaje con role user correctamente', async () => {
    const agent = agentRepository.insert(SAMPLE_AGENT);
    const conv = conversationRepository.create({ agentId: agent.id });

    const result = await handleSaveMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'Hola!',
    });

    expect(result.success).toBe(true);
    expect(result.message).toBeDefined();
    expect(result.message?.role).toBe('user');
    expect(result.message?.content).toBe('Hola!');
    expect(result.message?.id).toBeDefined();
    expect(result.message?.conversationId).toBe(conv.id);
  });

  it('guarda mensaje con role assistant correctamente', async () => {
    const agent = agentRepository.insert(SAMPLE_AGENT);
    const conv = conversationRepository.create({ agentId: agent.id });

    const result = await handleSaveMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: 'Hola, como puedo ayudarte?',
    });

    expect(result.success).toBe(true);
    expect(result.message?.role).toBe('assistant');
  });

  it('guarda mensaje con role system correctamente', async () => {
    const agent = agentRepository.insert(SAMPLE_AGENT);
    const conv = conversationRepository.create({ agentId: agent.id });

    const result = await handleSaveMessage({
      conversationId: conv.id,
      role: 'system',
      content: 'You are a helpful assistant.',
    });

    expect(result.success).toBe(true);
    expect(result.message?.role).toBe('system');
  });

  it('retorna createdAt como string en el message retornado', async () => {
    const agent = agentRepository.insert(SAMPLE_AGENT);
    const conv = conversationRepository.create({ agentId: agent.id });

    const result = await handleSaveMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'test',
    });

    expect(typeof result.message?.createdAt).toBe('string');
    expect((result.message?.createdAt ?? '').length).toBeGreaterThan(0);
  });
});
