/**
 * Cliente interactivo ACP
 * Uso: bun run src/client.ts <nombre-agente>
 * Ejemplo: bun run src/client.ts max
 */
import { spawn } from 'node:child_process';
import { Writable, Readable } from 'node:stream';
import readline from 'node:readline/promises';
import * as acp from '@agentclientprotocol/sdk';
import path from 'node:path';

const agentName = process.argv[2];

if (!agentName) {
  console.error('Uso: bun run src/client.ts <nombre-agente>');
  console.error('Ejemplo: bun run src/client.ts max');
  process.exit(1);
}

const agentDir = path.join(process.cwd(), agentName);
const agentEntry = path.join(agentDir, 'index.ts');

// El cliente recibe las respuestas del agente y los permisos
class InteractiveClient implements acp.Client {
  async sessionUpdate(params: acp.SessionNotification) {
    const update = params.update;
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
      process.stdout.write(update.content.text);
    }
  }

  async requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    console.log(`\n[Permiso requerido]: ${params.toolCall.title}`);
    const firstOption = params.options[0];
    if (!firstOption) {
      return { outcome: { outcome: 'cancelled' } };
    }
    return { outcome: { outcome: 'selected', optionId: firstOption.optionId } };
  }

  async readTextFile(): Promise<acp.ReadTextFileResponse> {
    return { content: '' };
  }

  async writeTextFile(): Promise<acp.WriteTextFileResponse> {
    return {};
  }
}

async function main() {
  console.log(`Conectando con el agente "${agentName}"...`);

  // Lanzamos el agente como proceso hijo (se comunica via stdin/stdout)
  const agentProcess = spawn('bun', ['run', agentEntry], {
    stdio: ['pipe', 'pipe', 'inherit'], // stdin y stdout conectados, stderr hereda (para ver logs del agente)
    cwd: agentDir,
  });

  agentProcess.on('error', (err) => {
    console.error(`Error al lanzar el agente: ${err.message}`);
    process.exit(1);
  });

  const stream = acp.ndJsonStream(
    Writable.toWeb(agentProcess.stdin) as unknown as Parameters<typeof acp.ndJsonStream>[0],
    Readable.toWeb(agentProcess.stdout) as unknown as Parameters<typeof acp.ndJsonStream>[1]
  );

  const connection = new acp.ClientSideConnection((_agent) => new InteractiveClient(), stream);

  // Inicializamos el protocolo ACP
  await connection.initialize({
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {},
  });

  // Creamos una sesion
  const { sessionId } = await connection.newSession({
    cwd: agentDir,
    mcpServers: [],
  });

  console.log(`Conectado. Sesion: ${sessionId}`);
  console.log(`Escribe tu mensaje (Ctrl+C para salir)\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Bucle interactivo
  while (true) {
    const userInput = await rl.question('Tu: ');
    if (!userInput.trim()) continue;

    process.stdout.write('\nAgente: ');

    await connection.prompt({
      sessionId,
      prompt: [{ type: 'text', text: userInput }],
    });

    process.stdout.write('\n\n');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
