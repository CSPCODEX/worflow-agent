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
import { LMStudioClient } from '@lmstudio/sdk';
import { Readable, Writable } from 'node:stream';
import * as readline from 'node:readline';
import dotenv from 'dotenv';

dotenv.config();

const lmClient = new LMStudioClient();
const SYSTEM_PROMPT = "{{SYSTEM_ROLE}}";

type Message = { role: 'user' | 'assistant' | 'system'; content: string };

class {{AGENT_CLASS}} implements Agent {
  private connection: AgentSideConnection;
  private sessions = new Map<string, Message[]>();

  constructor(connection: AgentSideConnection) {
    this.connection = connection;
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

    const model = await (process.env.LM_STUDIO_MODEL
      ? lmClient.llm.model(process.env.LM_STUDIO_MODEL)
      : lmClient.llm.model());
    const response = await model.respond([
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: userText },
    ]);

    const responseText = response.content;

    history.push({ role: 'user', content: userText });
    history.push({ role: 'assistant', content: responseText });
    this.sessions.set(params.sessionId, history);

    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: responseText },
      },
    });

    console.error(`[{{AGENT_NAME}}] respuesta enviada`);
    return { stopReason: 'end_turn' };
  }

  async cancel(_params: CancelNotification): Promise<void> {}
}

if (process.stdin.isTTY) {
  // Modo interactivo: terminal detectada, se usa REPL directo con LM Studio
  const history: Message[] = [];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n[{{AGENT_NAME}}] Modo interactivo. Escribe tu mensaje (Ctrl+C para salir):\n');

  const ask = () => {
    rl.question('Tu: ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { ask(); return; }

      try {
        const model = await (process.env.LM_STUDIO_MODEL
          ? lmClient.llm.model(process.env.LM_STUDIO_MODEL)
          : lmClient.llm.model());
        const response = await model.respond([
          { role: 'system', content: SYSTEM_PROMPT },
          ...history,
          { role: 'user', content: trimmed },
        ]);
        console.log(`\n{{AGENT_NAME}}: ${response.content}\n`);
        history.push({ role: 'user', content: trimmed });
        history.push({ role: 'assistant', content: response.content });
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

  new AgentSideConnection((conn) => new {{AGENT_CLASS}}(conn), stream);

  console.error('\n[{{AGENT_NAME}}] Agente ACP listo. Esperando conexion via stdin/stdout...');
}
