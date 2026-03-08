import path from 'path';
import { spawnSync } from 'child_process';
import type { AgentConfig } from '../cli/prompts';
import { createDirectory, writeFile, copyTemplateAndInject } from './fileSystem';
import { logger } from '../utils/logger';

// Core agent creation without CLI spinners — used by both CLI and desktop IPC
export const generateAgentCore = async (config: AgentConfig, baseDir: string): Promise<void> => {
  const templatesDir = path.join(__dirname, '..', 'templates', 'basic-agent');
  const agentDir = path.join(baseDir, config.name);

  await createDirectory(agentDir);

  await copyTemplateAndInject(
    path.join(templatesDir, 'package.json.tpl'),
    path.join(agentDir, 'package.json'),
    {
      AGENT_NAME: config.name,
      AGENT_DESCRIPTION: config.description.replace(/"/g, '\\"'),
    }
  );

  const envContent = `LM_STUDIO_MODEL=""\n${config.needsWorkspace ? 'WORKSPACE_DIR="./workspace"' : ''}`;
  await writeFile(path.join(agentDir, '.env'), envContent);

  if (config.needsWorkspace) {
    await createDirectory(path.join(agentDir, 'workspace'));
  }

  const agentClass = config.name.charAt(0).toUpperCase() + config.name.slice(1) + 'Agent';
  await copyTemplateAndInject(
    path.join(templatesDir, 'index.ts.tpl'),
    path.join(agentDir, 'index.ts'),
    {
      SYSTEM_ROLE: config.role.replace(/"/g, '\\"').replace(/\n/g, '\\n'),
      AGENT_NAME: config.name,
      AGENT_CLASS: agentClass,
    }
  );

  const exitCode = await new Promise<number>((resolve) => {
    const proc = Bun.spawn(['bun', 'install'], {
      cwd: agentDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.exited.then(resolve);
  });
  if (exitCode !== 0) {
    throw new Error('bun install failed in agent directory');
  }
};

export const generateAgent = async (config: AgentConfig): Promise<void> => {
  const spinner = logger.createSpinner();
  spinner.start(`Creando el entorno para el agente "${config.name}"...`);

  const currentDir = process.cwd();
  // Ensure we are resolving templates from the actual src directory regardless of where it's executed
  const templatesDir = path.join(__dirname, '..', 'templates', 'basic-agent');
  const agentDir = path.join(currentDir, config.name);

  try {
    // 1. Create Agent Root Directory
    await createDirectory(agentDir);

    // 2. Generate package.json
    await copyTemplateAndInject(
      path.join(templatesDir, 'package.json.tpl'),
      path.join(agentDir, 'package.json'),
      {
        AGENT_NAME: config.name,
        AGENT_DESCRIPTION: config.description.replace(/"/g, '\\"')
      }
    );

    // 3. Generate .env logic
    // LM_STUDIO_MODEL: identificador del modelo cargado en LM Studio (dejar vacío para usar el primero disponible)
    const envContent = `LM_STUDIO_MODEL=""\n${config.needsWorkspace ? 'WORKSPACE_DIR="./workspace"' : ''}`;
    await writeFile(path.join(agentDir, '.env'), envContent);

    // 4. Create Workspace if needed
    if (config.needsWorkspace) {
      await createDirectory(path.join(agentDir, 'workspace'));
    }

    // 5. Generate main index.ts agent code
    const agentClass = config.name.charAt(0).toUpperCase() + config.name.slice(1) + 'Agent';
    await copyTemplateAndInject(
      path.join(templatesDir, 'index.ts.tpl'),
      path.join(agentDir, 'index.ts'),
      {
        SYSTEM_ROLE: config.role.replace(/"/g, '\\"').replace(/\n/g, '\\n'),
        AGENT_NAME: config.name,
        AGENT_CLASS: agentClass,
      }
    );

    spinner.stop('¡Arquitectura base del agente generada correctamente!');

    // 6. Install dependencies automatically
    const installSpinner = logger.createSpinner();
    installSpinner.start('Instalando dependencias con bun...');
    const result = spawnSync('bun', ['install'], { cwd: agentDir, stdio: 'pipe' });
    if (result.status === 0) {
      installSpinner.stop('Dependencias instaladas.');
    } else {
      installSpinner.fail('No se pudieron instalar las dependencias. Corre "bun install" manualmente.');
    }

    // Show Next Steps
    const nextSteps = `1. Asegúrate de tener LM Studio corriendo en localhost:1234\n2. (Opcional) Pon el ID del modelo en ${config.name}/.env -> LM_STUDIO_MODEL\n3. Chatea con el agente: bun run chat ${config.name}\n   (El cliente ACP lanza el agente, conecta la sesion y abre un REPL interactivo)`;
    logger.info('Pasos siguientes:', nextSteps);

    logger.success(`Tienes tu nuevo agente listo. ¡Revisa la carpeta: ${config.name}/!`);

  } catch (error: any) {
    spinner.fail('Error generando el Agente');
    logger.error(`No se pudo generar el entorno: ${error.message}`);
  }
};
