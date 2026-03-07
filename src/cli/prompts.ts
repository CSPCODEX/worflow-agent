import { text, confirm, group, cancel } from '@clack/prompts';
import { validateAgentName, validateDescription, validateRole } from './validations';

export interface AgentConfig {
  name: string;
  description: string;
  role: string;
  needsWorkspace: boolean;
}

export const runInterview = async (): Promise<AgentConfig> => {
  const config = await group(
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
    },
    {
      onCancel: () => {
        cancel('Operación cancelada por el usuario. ¡Hasta la próxima!');
        process.exit(0);
      },
    }
  );

  return config as AgentConfig;
};
