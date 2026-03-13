import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk';
import type {
  Agent,
  InitializeRequest,
  InitializeResponse,
  AuthenticateRequest,
  AuthenticateResponse,
  NewSessionRequest,
  NewSessionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
  PromptRequest,
  PromptResponse,
  CancelNotification,
} from '@agentclientprotocol/sdk';
import type { LLMProvider } from './providers/types';

function formatError(err: any): string {
  const msg: string = err?.message ?? 'error desconocido';
  // Quota / rate limit
  if (msg.includes('429') || msg.includes('quota') || msg.includes('Too Many Requests') || msg.includes('rate limit')) {
    return 'Sin créditos o cuota agotada en el proveedor. Revisa tu plan y facturación.';
  }
  // Auth
  if (msg.includes('401') || msg.includes('API_KEY_INVALID') || msg.includes('invalid api key') || msg.includes('Unauthorized')) {
    return 'API key inválida o revocada. Verifica el valor en tu archivo .env.';
  }
  // Billing
  if (msg.includes('402') || msg.includes('insufficient') || msg.includes('billing')) {
    return 'Saldo insuficiente en tu cuenta del proveedor. Añade créditos para continuar.';
  }
  // Permission
  if (msg.includes('403') || msg.includes('permission') || msg.includes('forbidden')) {
    return 'Acceso denegado. Verifica que tu API key tenga los permisos necesarios.';
  }
  // Model not found
  if (msg.includes('404') || msg.includes('model not found') || msg.includes('does not exist')) {
    return 'Modelo no encontrado. Verifica el valor de la variable MODEL en tu archivo .env.';
  }
  // Si el error ya es un mensaje amigable (lanzado por los providers), devolverlo tal cual
  if (msg.length < 120 && !msg.includes('http') && !msg.includes('{')) {
    return msg;
  }
  // Error desconocido — mostrar solo la primera línea para no volcar JSON/stacktrace
  return msg.split('\n')[0].slice(0, 120);
}
import { createProvider } from './providers/factory';
import { Readable, Writable } from 'node:stream';
import * as readline from 'node:readline';
import dotenv from 'dotenv';

dotenv.config();

const SYSTEM_PROMPT = "{{SYSTEM_ROLE}}";

type Message = { role: 'user' | 'assistant' | 'system'; content: string };

class {{AGENT_CLASS}} implements Agent {
  private connection: AgentSideConnection;
  private sessions = new Map<string, Message[]>();
  private provider: LLMProvider;

  constructor(connection: AgentSideConnection, provider: LLMProvider) {
    this.connection = connection;
    this.provider = provider;
  }

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    console.error('[{{AGENT_NAME}}] inicializado');
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
    };
  }

  async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {
    return {};
  }

  async newSession(_params: NewSessionRequest): Promise<NewSessionResponse> {
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, []);
    console.error(`[{{AGENT_NAME}}] nueva sesion: ${sessionId}`);
    return { sessionId };
  }

  async setSessionMode(_params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    return {};
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const history = this.sessions.get(params.sessionId) ?? [];

    const userText = params.prompt
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    console.error(`[{{AGENT_NAME}}] prompt: ${userText.substring(0, 60)}`);

    try {
      const messages: Message[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: userText },
      ];

      const responseText = await this.provider.chatStream(messages, (chunk) => {
        this.connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: chunk },
          },
        });
      });

      history.push({ role: 'user', content: userText });
      history.push({ role: 'assistant', content: responseText });
      this.sessions.set(params.sessionId, history);

      console.error(`[{{AGENT_NAME}}] respuesta enviada`);
    } catch (e: any) {
      const errorMsg = `[{{AGENT_NAME}}] ${formatError(e)}`;
      console.error(errorMsg);
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: errorMsg },
        },
      });
    }

    return { stopReason: 'end_turn' };
  }

  async cancel(_params: CancelNotification): Promise<void> {}
}

// Initialize the provider once before branching into TTY or ACP mode
const provider = await createProvider();

if (process.stdin.isTTY) {
  // Modo interactivo: terminal detectada, se usa REPL directo
  const history: Message[] = [];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n[{{AGENT_NAME}}] Modo interactivo. Escribe tu mensaje (Ctrl+C para salir):\n');

  const ask = () => {
    rl.question('Tu: ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { ask(); return; }

      try {
        const messages: Message[] = [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history,
          { role: 'user', content: trimmed },
        ];

        process.stdout.write(`\n{{AGENT_NAME}}: `);
        const response = await provider.chatStream(messages, (chunk) => {
          process.stdout.write(chunk);
        });
        process.stdout.write('\n\n');

        history.push({ role: 'user', content: trimmed });
        history.push({ role: 'assistant', content: response });
      } catch (e: any) {
        console.error(`[error] ${e.message}`);
      }
      ask();
    });
  };
  ask();
} else {
  // Modo ACP: lanzado como subproceso por un cliente ACP externo
  const output = Writable.toWeb(process.stdout);
  const input = Readable.toWeb(process.stdin);
  const stream = ndJsonStream(output, input);

  new AgentSideConnection((conn) => new {{AGENT_CLASS}}(conn, provider), stream);

  console.error('\n[{{AGENT_NAME}}] Agente ACP listo. Esperando conexion via stdin/stdout...');
}
