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

    try {
      const model = await (process.env.LM_STUDIO_MODEL
        ? lmClient.llm.model(process.env.LM_STUDIO_MODEL)
        : lmClient.llm.model());
      let fullContent = '';
      for await (const fragment of model.respond([
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: userText },
      ])) {
        fullContent += fragment.content;
      }

      // Strip internal reasoning tokens emitted by extended-thinking models:
      //   <|channel|>final<|message|>...<|end|>  (Qwen / channel-format models)
      //   <think>...</think>                      (DeepSeek R1 / think-tag models)
      const channelMatch = fullContent.match(/<\|channel\|>final<\|message\|>([\s\S]*?)(?:<\|end\|>|$)/);
      const responseText = channelMatch
        ? channelMatch[1].trim()
        : fullContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || fullContent;

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
    } catch (e: any) {
      const errorMsg = `[{{AGENT_NAME}}] Error al procesar el prompt: ${e?.message ?? 'error desconocido'}. Verifica que LM Studio esta corriendo en localhost:1234 y tiene un modelo cargado.`;
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
        process.stdout.write(`\n{{AGENT_NAME}}: `);
        let ttyContent = '';
        for await (const fragment of model.respond([
          { role: 'system', content: SYSTEM_PROMPT },
          ...history,
          { role: 'user', content: trimmed },
        ])) {
          ttyContent += fragment.content;
          process.stdout.write(fragment.content);
        }
        process.stdout.write('\n\n');
        const ttyChannelMatch = ttyContent.match(/<\|channel\|>final<\|message\|>([\s\S]*?)(?:<\|end\|>|$)/);
        const ttyResponse = ttyChannelMatch
          ? ttyChannelMatch[1].trim()
          : ttyContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || ttyContent;
        history.push({ role: 'user', content: trimmed });
        history.push({ role: 'assistant', content: ttyResponse });
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
