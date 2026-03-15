import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { setupTestDb, teardownTestDb, getTestDb } from '../helpers/testDb';

// mock.module ANTES de importar modulos que dependen de database
mock.module('../../src/db/database', () => ({
  getDatabase: () => getTestDb(),
  initDatabase: () => getTestDb(),
}));

import { agentRepository } from '../../src/db/agentRepository';
import { handleGenerateAgent, type GenerateAgentDeps } from '../../src/ipc/handlerLogic';

// Threshold para considerar que el handler no bloqueo el event loop.
// 50ms es un margen generoso: el handler sincrono deberia retornar en < 5ms.
const NON_BLOCKING_THRESHOLD_MS = 50;
// Delay del stub de installAgentDeps: suficientemente largo para que si
// el handler esperara, claramente superaria NON_BLOCKING_THRESHOLD_MS.
const STUB_CALLBACK_DELAY_MS = 80;

const VALID_CONFIG = {
  name: 'async-test-agent',
  description: 'Agent para test async',
  role: 'You are a helpful async test agent with enough characters here.',
  needsWorkspace: false,
  provider: 'lmstudio' as const,
};

function makeAsyncDeps(overrides: Partial<GenerateAgentDeps> = {}): GenerateAgentDeps {
  return {
    agentRepository,
    scaffoldAgent: async (_config, baseDir) => `${baseDir}/async-test-agent`,
    installAgentDeps: (_dir, cb) => {
      // Fire-and-forget con delay: simula `bun install` tardando STUB_CALLBACK_DELAY_MS
      setTimeout(() => cb(), STUB_CALLBACK_DELAY_MS);
    },
    enhanceAndPersist: async () => {
      // Simula llamada a LM Studio con delay
      await new Promise((r) => setTimeout(r, STUB_CALLBACK_DELAY_MS));
    },
    onInstallDone: () => {},
    onEnhanceDone: () => {},
    rmSync: () => {},
    ...overrides,
  };
}

describe('handlers fire-and-forget async', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  it('handleGenerateAgent retorna en < 50ms aunque installAgentDeps tenga delay de 80ms', async () => {
    const start = performance.now();

    const result = await handleGenerateAgent(VALID_CONFIG, '/fake/agents', makeAsyncDeps());

    const elapsed = performance.now() - start;

    expect(result.success).toBe(true);
    expect(elapsed).toBeLessThan(NON_BLOCKING_THRESHOLD_MS);
  });

  it('handleGenerateAgent retorna ANTES de que onInstallDone sea llamado', async () => {
    let installDoneCalled = false;
    let handlerReturnedAt = 0;
    let installDoneCalledAt = 0;

    const deps = makeAsyncDeps({
      onInstallDone: () => {
        installDoneCalled = true;
        installDoneCalledAt = performance.now();
      },
      installAgentDeps: (_dir, cb) => {
        setTimeout(() => cb(), STUB_CALLBACK_DELAY_MS);
      },
    });

    await handleGenerateAgent(VALID_CONFIG, '/fake/agents', deps);
    handlerReturnedAt = performance.now();

    // En este momento, el handler ya retorno pero el callback aun no fue llamado
    expect(installDoneCalled).toBe(false);

    // Esperar a que el callback sea llamado eventualmente
    await new Promise((r) => setTimeout(r, STUB_CALLBACK_DELAY_MS + 20));

    expect(installDoneCalled).toBe(true);
    // El callback fue llamado DESPUES de que el handler retorno
    expect(installDoneCalledAt).toBeGreaterThan(handlerReturnedAt);
  });

  it('onInstallDone es eventualmente llamado', async () => {
    let called = false;
    const deps = makeAsyncDeps({
      onInstallDone: () => { called = true; },
    });

    await handleGenerateAgent(VALID_CONFIG, '/fake/agents', deps);

    // No llamado aun
    expect(called).toBe(false);

    // Llamado despues del delay
    await new Promise((r) => setTimeout(r, STUB_CALLBACK_DELAY_MS + 20));
    expect(called).toBe(true);
  });

  it('onEnhanceDone es eventualmente llamado', async () => {
    let enhanceCalled = false;
    const deps = makeAsyncDeps({
      onEnhanceDone: () => { enhanceCalled = true; },
      enhanceAndPersist: async (_id, _dir, _name, _prompt, rpcSend) => {
        await new Promise((r) => setTimeout(r, STUB_CALLBACK_DELAY_MS));
        rpcSend({ agentName: VALID_CONFIG.name, strategy: 'static' });
      },
    });

    await handleGenerateAgent(VALID_CONFIG, '/fake/agents', deps);
    expect(enhanceCalled).toBe(false);

    await new Promise((r) => setTimeout(r, STUB_CALLBACK_DELAY_MS + 20));
    expect(enhanceCalled).toBe(true);
  });

  it('handlers retorno inmediato si scaffoldAgent falla -- no se bloquea en cleanup', async () => {
    const start = performance.now();
    const deps = makeAsyncDeps({
      scaffoldAgent: async () => { throw new Error('scaffold failed fast'); },
    });

    const result = await handleGenerateAgent(VALID_CONFIG, '/fake/agents', deps);
    const elapsed = performance.now() - start;

    expect(result.success).toBe(false);
    expect(elapsed).toBeLessThan(NON_BLOCKING_THRESHOLD_MS);
  });
});
