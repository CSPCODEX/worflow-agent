import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { setupTestDb, teardownTestDb, getTestDb } from '../../helpers/testDb';

// mock.module must be declared BEFORE importing modules that depend on it
mock.module('../../../src/db/database', () => ({
  getDatabase: () => getTestDb(),
  initDatabase: () => getTestDb(),
}));

// Import AFTER mock declaration
import { agentRepository } from '../../../src/db/agentRepository';

const SAMPLE_AGENT = {
  name: 'test-agent',
  description: 'A test agent',
  systemPrompt: 'You are a test agent.',
  model: '',
  hasWorkspace: false,
  path: '/fake/path/test-agent',
  provider: 'lmstudio',
};

describe('agentRepository', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  it('insert() retorna AgentRecord con status active', () => {
    const record = agentRepository.insert(SAMPLE_AGENT);
    expect(record.id).toBeDefined();
    expect(record.status).toBe('active');
    expect(record.name).toBe('test-agent');
    expect(record.description).toBe('A test agent');
    expect(record.provider).toBe('lmstudio');
  });

  it('insert() asigna createdAt como string ISO', () => {
    const record = agentRepository.insert(SAMPLE_AGENT);
    expect(typeof record.createdAt).toBe('string');
    expect(record.createdAt.length).toBeGreaterThan(0);
  });

  it('findByName() retorna null si no existe', () => {
    expect(agentRepository.findByName('nonexistent')).toBeNull();
  });

  it('findByName() retorna el agente insertado', () => {
    agentRepository.insert(SAMPLE_AGENT);
    const found = agentRepository.findByName('test-agent');
    expect(found).not.toBeNull();
    expect(found?.name).toBe('test-agent');
  });

  it('findById() retorna null si no existe', () => {
    expect(agentRepository.findById('nonexistent-id')).toBeNull();
  });

  it('findById() retorna el agente insertado', () => {
    const record = agentRepository.insert(SAMPLE_AGENT);
    const found = agentRepository.findById(record.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(record.id);
  });

  it('insert() con nombre duplicado lanza error', () => {
    agentRepository.insert(SAMPLE_AGENT);
    expect(() => agentRepository.insert(SAMPLE_AGENT)).toThrow();
  });

  it('delete() elimina el agente', () => {
    const record = agentRepository.insert(SAMPLE_AGENT);
    agentRepository.delete(record.id);
    expect(agentRepository.findById(record.id)).toBeNull();
  });

  it('findAll() retorna agentes insertados', () => {
    agentRepository.insert(SAMPLE_AGENT);
    agentRepository.insert({ ...SAMPLE_AGENT, name: 'second-agent', path: '/fake/path/second-agent' });
    const all = agentRepository.findAll();
    expect(all.length).toBe(2);
  });

  it('findAll() marca agentes como broken si el path no existe', () => {
    agentRepository.insert({ ...SAMPLE_AGENT, path: '/nonexistent/path/that/does/not/exist' });
    const all = agentRepository.findAll();
    expect(all[0]?.status).toBe('broken');
  });

  it('updateSystemPrompt() actualiza system_prompt y enhance_status', () => {
    const record = agentRepository.insert(SAMPLE_AGENT);
    agentRepository.updateSystemPrompt(record.id, 'enhanced prompt', 'done');
    const found = agentRepository.findById(record.id);
    expect(found?.systemPrompt).toBe('enhanced prompt');
  });
});
