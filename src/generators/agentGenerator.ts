import path from 'path';
import type { AgentConfig } from '../cli/prompts';
import { createDirectory, writeFile, copyTemplateAndInject, readFile } from './fileSystem';
import { logger } from '../utils/logger';
import { encryptApiKey } from '../utils/crypto';

// Maps each provider to the npm dependency entry (comma + newline prefix included for JSON embedding)
const PROVIDER_DEP_MAP: Record<string, string> = {
  lmstudio:  ',\n    "@lmstudio/sdk": "^1.0.0"',
  ollama:    '',
  openai:    ',\n    "openai": "^4.0.0"',
  anthropic: ',\n    "@anthropic-ai/sdk": "^0.39.0"',
  gemini:    ',\n    "@google/generative-ai": "^0.24.0"',
};

function getProviderDep(provider: string): string {
  return PROVIDER_DEP_MAP[provider] ?? '';
}

function buildEnvContent(config: AgentConfig): string {
  const provider = config.provider ?? 'lmstudio';
  const lines: string[] = [`PROVIDER=${provider}`];

  switch (provider) {
    case 'lmstudio':
      lines.push(`LM_STUDIO_MODEL=""`);
      break;
    case 'ollama':
      lines.push(`OLLAMA_MODEL="llama3.2"`);
      break;
    case 'openai': {
      const key = config.apiKey
        ? encryptApiKey(config.apiKey)
        : '';
      lines.push(`OPENAI_API_KEY="${key}"`);
      lines.push(`OPENAI_MODEL="gpt-4o-mini"`);
      break;
    }
    case 'anthropic': {
      const key = config.apiKey
        ? encryptApiKey(config.apiKey)
        : '';
      lines.push(`ANTHROPIC_API_KEY="${key}"`);
      lines.push(`ANTHROPIC_MODEL="claude-3-5-haiku-20241022"`);
      break;
    }
    case 'gemini': {
      const key = config.apiKey
        ? encryptApiKey(config.apiKey)
        : '';
      lines.push(`GEMINI_API_KEY="${key}"`);
      lines.push(`# Available: gemini-3.1-pro-preview, gemini-3-flash-preview, gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite`);
      lines.push(`GEMINI_MODEL="gemini-2.5-flash-lite"`);
      break;
    }
    default:
      lines.push(`LM_STUDIO_MODEL=""`);
  }

  if (config.needsWorkspace) {
    lines.push(`WORKSPACE_DIR="./workspace"`);
  }

  return lines.join('\n') + '\n';
}

// Phase 1: create directories and write all template files — fast, no network I/O.
// Returns the resolved agentDir so the caller can reference it immediately.
export const scaffoldAgent = async (config: AgentConfig, baseDir: string): Promise<string> => {
  const templatesDir = path.join(__dirname, '..', 'templates', 'basic-agent');
  const agentDir = path.join(baseDir, config.name);

  await createDirectory(agentDir);

  // package.json — with dynamic provider dependency
  await copyTemplateAndInject(
    path.join(templatesDir, 'package.json.tpl'),
    path.join(agentDir, 'package.json'),
    {
      AGENT_NAME: config.name,
      AGENT_DESCRIPTION: config.description.replace(/"/g, '\\"'),
      PROVIDER_DEP: getProviderDep(config.provider ?? 'lmstudio'),
    }
  );

  // .env — built programmatically (encripts API key if needed)
  const envContent = buildEnvContent(config);
  await writeFile(path.join(agentDir, '.env'), envContent);

  if (config.needsWorkspace) {
    await createDirectory(path.join(agentDir, 'workspace'));
  }

  // index.ts — uses createProvider() abstraction
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

  // providers/ — copy all provider templates as .ts files (no placeholder injection)
  await createDirectory(path.join(agentDir, 'providers'));
  const providerFiles = ['types', 'factory', 'crypto', 'lmstudio', 'ollama', 'openai', 'anthropic', 'gemini'];
  for (const name of providerFiles) {
    await copyTemplateAndInject(
      path.join(templatesDir, 'providers', `${name}.ts.tpl`),
      path.join(agentDir, 'providers', `${name}.ts`),
      {} // literal copy — no placeholders
    );
  }

  return agentDir;
};

// Phase 2: run `bun install` in the scaffolded directory.
// Calls onInstallDone when finished; pass a callback instead of awaiting so the
// caller can return an RPC response before the install completes.
export const installAgentDeps = (
  agentDir: string,
  onInstallDone: (error?: string) => void
): void => {
  const proc = Bun.spawn(['bun', 'install'], {
    cwd: agentDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.exited.then((code) => {
    if (code === 0) {
      onInstallDone();
    } else {
      onInstallDone('bun install failed in agent directory');
    }
  });
};

// Core agent creation without CLI spinners — used by both CLI and desktop IPC.
// The desktop IPC path should prefer scaffoldAgent + installAgentDeps separately
// to avoid blocking the RPC handler during the slow network install.
export const generateAgentCore = async (config: AgentConfig, baseDir: string): Promise<void> => {
  const agentDir = await scaffoldAgent(config, baseDir);

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

/**
 * Rewrite only the SYSTEM_PROMPT constant inside an already-scaffolded index.ts.
 * Used after the prompt enhancement background job completes.
 */
export async function rewriteAgentIndexTs(
  agentDir: string,
  enhancedPrompt: string
): Promise<void> {
  const indexPath = path.join(agentDir, 'index.ts');
  let content: string;
  try {
    content = await readFile(indexPath);
  } catch {
    throw new Error(`index.ts no encontrado en ${agentDir}`);
  }

  // Escape backslashes, double quotes and newlines so the value is a valid
  // single-line JS string literal.
  const escaped = enhancedPrompt
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');

  // Replace the value between the quotes of: const SYSTEM_PROMPT = "...";
  const updated = content.replace(
    /^(const SYSTEM_PROMPT = ").*(";)/m,
    `$1${escaped}$2`
  );

  await writeFile(indexPath, updated);
}

export const generateAgent = async (config: AgentConfig): Promise<void> => {
  const spinner = logger.createSpinner();
  spinner.start(`Creando el entorno para el agente "${config.name}"...`);

  const agentDir = path.join(process.cwd(), config.name);

  try {
    // Phase 1 — scaffold: create dirs, inject templates, write .env
    await scaffoldAgent(config, process.cwd());

    spinner.stop('¡Arquitectura base del agente generada correctamente!');

    // Phase 2 — install dependencies (async to avoid blocking the event loop)
    const installSpinner = logger.createSpinner();
    installSpinner.start('Instalando dependencias con bun...');
    const installProc = Bun.spawn(['bun', 'install'], {
      cwd: agentDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const installCode = await installProc.exited;
    if (installCode === 0) {
      installSpinner.stop('Dependencias instaladas.');
    } else {
      installSpinner.fail('No se pudieron instalar las dependencias. Corre "bun install" manualmente.');
    }

    const provider = config.provider ?? 'lmstudio';
    const nextStepsLines: string[] = [];

    if (provider === 'lmstudio') {
      nextStepsLines.push(`1. Asegúrate de tener LM Studio corriendo en localhost:1234`);
      nextStepsLines.push(`2. (Opcional) Pon el ID del modelo en ${config.name}/.env -> LM_STUDIO_MODEL`);
    } else if (provider === 'ollama') {
      nextStepsLines.push(`1. Asegúrate de tener Ollama corriendo en localhost:11434`);
      nextStepsLines.push(`2. (Opcional) Cambia el modelo en ${config.name}/.env -> OLLAMA_MODEL`);
    } else {
      const keyVar: Record<string, string> = {
        openai: 'OPENAI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        gemini: 'GEMINI_API_KEY',
      };
      if (!config.apiKey) {
        nextStepsLines.push(`1. Añade tu API key en ${config.name}/.env -> ${keyVar[provider]}`);
      } else {
        nextStepsLines.push(`1. API key encriptada guardada en ${config.name}/.env`);
      }
    }
    nextStepsLines.push(`${nextStepsLines.length + 1}. Chatea con el agente: bun run chat ${config.name}`);

    logger.info('Pasos siguientes:', nextStepsLines.join('\n'));
    logger.success(`Tienes tu nuevo agente listo. ¡Revisa la carpeta: ${config.name}/!`);

  } catch (error: any) {
    spinner.fail('Error generando el Agente');
    logger.error(`No se pudo generar el entorno: ${error.message}`);
  }
};
