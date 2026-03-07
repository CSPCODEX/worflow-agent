import { logger } from './utils/logger';
import { runInterview } from './cli/prompts';
import { generateAgent } from './generators/agentGenerator';

async function main() {
  logger.welcome('v1.0.0');

  try {
    // 1. Recopilar configuración del usuario mediante Clack
    const config = await runInterview();

    // 2. Generar el código y archivos del agente
    await generateAgent(config);

  } catch (error: any) {
    logger.error(`Ocurrió un error inesperado: ${error.message}`);
  }
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
