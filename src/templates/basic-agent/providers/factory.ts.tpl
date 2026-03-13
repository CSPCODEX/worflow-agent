import type { LLMProvider } from './types';

type ProviderFactory = () => Promise<LLMProvider>;

const REGISTRY: Record<string, ProviderFactory> = {
  lmstudio:  () => import('./lmstudio').then(m => new m.LMStudioProvider()),
  ollama:    () => import('./ollama').then(m => new m.OllamaProvider()),
  openai:    () => import('./openai').then(m => new m.OpenAIProvider()),
  anthropic: () => import('./anthropic').then(m => new m.AnthropicProvider()),
  gemini:    () => import('./gemini').then(m => new m.GeminiProvider()),
};

export async function createProvider(): Promise<LLMProvider> {
  const name = process.env.PROVIDER ?? 'lmstudio';
  const factory = REGISTRY[name];
  if (!factory) {
    throw new Error(
      `Provider desconocido: "${name}". Valores válidos: ${Object.keys(REGISTRY).join(', ')}`
    );
  }
  return factory();
}
