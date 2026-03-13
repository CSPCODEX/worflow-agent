import { text, confirm, select, password, group, cancel } from '@clack/prompts';
import { validateAgentName, validateDescription, validateRole } from './validations';
import type { ProviderId } from '../types/ipc';

export interface AgentConfig {
  name: string;
  description: string;
  role: string;
  needsWorkspace: boolean;
  provider: ProviderId;
  apiKey?: string;
}

const REQUIRES_API_KEY = new Set<ProviderId>(['openai', 'anthropic', 'gemini']);
export const requiresApiKey = (provider: ProviderId): boolean => REQUIRES_API_KEY.has(provider);

export const runInterview = async (): Promise<AgentConfig> => {
  const baseConfig = await group(
    {
      name: () => text({
        message: '¿Qué nombre tendrá tu nuevo Agente?',
        placeholder: 'Ej: mi-agente-asistente',
        validate: validateAgentName,
      }),
      description: () => text({
        message: 'Proporciona una breve descripción del Agente:',
        placeholder: 'Un agente especializado en documentar código.',
        validate: validateDescription,
      }),
      role: () => text({
        message: 'Define el System Prompt (Rol) del agente:',
        placeholder: 'Eres un experto en TypeScript que revisa PRs.',
        validate: validateRole,
      }),
      needsWorkspace: () => confirm({
        message: '¿El agente va a manipular archivos locales (Workspace)?',
        initialValue: true,
      }),
      provider: () => select<ProviderId>({
        message: '¿Qué proveedor de LLM usará el agente?',
        initialValue: 'lmstudio',
        options: [
          { value: 'lmstudio', label: 'LM Studio (local, sin API key)' },
          { value: 'ollama', label: 'Ollama (local, sin API key)' },
          { value: 'openai', label: 'OpenAI (requiere API key)' },
          { value: 'anthropic', label: 'Anthropic (requiere API key)' },
          { value: 'gemini', label: 'Gemini (requiere API key)' },
        ],
      }),
    },
    {
      onCancel: () => {
        cancel('Operación cancelada por el usuario. ¡Hasta la próxima!');
        process.exit(0);
      },
    }
  );

  const KEY_LABELS: Record<ProviderId, string> = {
    openai: 'OpenAI API Key',
    anthropic: 'Anthropic API Key',
    gemini: 'Gemini API Key',
    lmstudio: '',
    ollama: '',
  };

  let apiKey: string | undefined;
  if (requiresApiKey(baseConfig.provider)) {
    const keyResult = await password({
      message: `Introduce tu ${KEY_LABELS[baseConfig.provider]} (se guardará encriptada):`,
    });
    if (typeof keyResult === 'symbol') {
      cancel('Operación cancelada por el usuario. ¡Hasta la próxima!');
      process.exit(0);
    }
    apiKey = (keyResult as string).trim() || undefined;
  }

  return {
    ...baseConfig,
    needsWorkspace: baseConfig.needsWorkspace as boolean,
    ...(apiKey !== undefined ? { apiKey } : {}),
  };
};
