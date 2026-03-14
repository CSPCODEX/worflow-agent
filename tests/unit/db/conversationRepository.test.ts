import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { setupTestDb, teardownTestDb, getTestDb } from '../../helpers/testDb';

// mock.module must be declared BEFORE importing modules that depend on it
mock.module('../../../src/db/database', () => ({
  getDatabase: () => getTestDb(),
  initDatabase: () => getTestDb(),
}));

// Import AFTER mock declaration
import { agentRepository } from '../../../src/db/agentRepository';
import { conversationRepository, messageRepository } from '../../../src/db/conversationRepository';

const SAMPLE_AGENT = {
  name: 'test-agent',
  description: 'A test agent',
  systemPrompt: 'You are a test agent.',
  model: '',
  hasWorkspace: false,
  path: '/fake/path/test-agent',
  provider: 'lmstudio',
};

describe('conversationRepository', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  it('create() retorna ConversationRecord con titulo por defecto', () => {
    const agent = agentRepository.insert(SAMPLE_AGENT);
    const conv = conversationRepository.create({ agentId: agent.id });
    expect(conv.id).toBeDefined();
    expect(conv.agentId).toBe(agent.id);
    expect(typeof conv.title).toBe('string');
    expect(conv.title.length).toBeGreaterThan(0);
  });

  it('create() acepta titulo personalizado', () => {
    const agent = agentRepository.insert(SAMPLE_AGENT);
    const conv = conversationRepository.create({ agentId: agent.id, title: 'Mi conversacion' });
    expect(conv.title).toBe('Mi conversacion');
  });

  it('findByAgent() retorna lista vacia si no hay conversaciones', () => {
    const agent = agentRepository.insert(SAMPLE_AGENT);
    const convs = conversationRepository.findByAgent(agent.id);
    expect(convs).toEqual([]);
  });

  it('findByAgent() retorna conversaciones del agente', () => {
    const agent = agentRepository.insert(SAMPLE_AGENT);
    conversationRepository.create({ agentId: agent.id });
    conversationRepository.create({ agentId: agent.id });
    const convs = conversationRepository.findByAgent(agent.id);
    expect(convs.length).toBe(2);
  });

  it('delete() elimina la conversacion', () => {
    const agent = agentRepository.insert(SAMPLE_AGENT);
    const conv = conversationRepository.create({ agentId: agent.id });
    conversationRepository.delete(conv.id);
    const convs = conversationRepository.findByAgent(agent.id);
    expect(convs.length).toBe(0);
  });

  it('delete() es idempotente — no lanza error si no existe', () => {
    expect(() => conversationRepository.delete('nonexistent-id')).not.toThrow();
  });
});

describe('messageRepository', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  it('save() retorna MessageRecord con los datos correctos', () => {
    const agent = agentRepository.insert(SAMPLE_AGENT);
    const conv = conversationRepository.create({ agentId: agent.id });
    const msg = messageRepository.save({
      conversationId: conv.id,
      role: 'user',
      content: 'Hola!',
    });
    expect(msg.id).toBeDefined();
    expect(msg.conversationId).toBe(conv.id);
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hola!');
  });

  it('save() rechaza roles invalidos via CHECK constraint', () => {
    const agent = agentRepository.insert(SAMPLE_AGENT);
    const conv = conversationRepository.create({ agentId: agent.id });
    expect(() =>
      messageRepository.save({
        conversationId: conv.id,
        role: 'invalid-role',
        content: 'test',
      })
    ).toThrow();
  });

  it('findByConversation() retorna mensajes en orden ASC', () => {
    const agent = agentRepository.insert(SAMPLE_AGENT);
    const conv = conversationRepository.create({ agentId: agent.id });
    messageRepository.save({ conversationId: conv.id, role: 'user', content: 'primero' });
    messageRepository.save({ conversationId: conv.id, role: 'assistant', content: 'segundo' });
    const msgs = messageRepository.findByConversation(conv.id);
    expect(msgs.length).toBe(2);
    expect(msgs[0]?.content).toBe('primero');
    expect(msgs[1]?.content).toBe('segundo');
  });

  it('delete() de conversacion en cascada elimina mensajes', () => {
    const agent = agentRepository.insert(SAMPLE_AGENT);
    const conv = conversationRepository.create({ agentId: agent.id });
    messageRepository.save({ conversationId: conv.id, role: 'user', content: 'test' });
    conversationRepository.delete(conv.id);
    const msgs = messageRepository.findByConversation(conv.id);
    expect(msgs.length).toBe(0);
  });

  it('delete() de agente en cascada elimina conversaciones y mensajes', () => {
    const agent = agentRepository.insert(SAMPLE_AGENT);
    const conv = conversationRepository.create({ agentId: agent.id });
    messageRepository.save({ conversationId: conv.id, role: 'user', content: 'test' });
    agentRepository.delete(agent.id);
    const convs = conversationRepository.findByAgent(agent.id);
    expect(convs.length).toBe(0);
  });
});
