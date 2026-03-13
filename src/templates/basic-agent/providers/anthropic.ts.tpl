import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, Message } from './types';
import { decryptIfNeeded } from './crypto';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor() {
    const rawKey = process.env.ANTHROPIC_API_KEY ?? '';
    if (!rawKey) {
      throw new Error('ANTHROPIC_API_KEY no está configurada en el archivo .env del agente.');
    }
    const apiKey = decryptIfNeeded(rawKey);
    this.client = new Anthropic({ apiKey });
  }

  async chat(messages: Message[]): Promise<string> {
    let result = '';
    await this.chatStream(messages, (chunk) => { result += chunk; });
    return result;
  }

  async chatStream(messages: Message[], onChunk: (text: string) => void): Promise<string> {
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-3-5-haiku-20241022';

    // Anthropic requires system prompt separately; extract it from messages
    const systemMessages = messages.filter((m) => m.role === 'system');
    const userMessages = messages.filter((m) => m.role !== 'system');

    const system = systemMessages.map((m) => m.content).join('\n') || undefined;

    let fullContent = '';

    try {
      const stream = this.client.messages.stream({
        model,
        max_tokens: 8192,
        ...(system ? { system } : {}),
        messages: userMessages as Anthropic.MessageParam[],
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          const text = event.delta.text;
          fullContent += text;
          onChunk(text);
        }
      }
    } catch (err: any) {
      if (err?.status === 401) {
        throw new Error('API key de Anthropic inválida o revocada. Verifica el valor de ANTHROPIC_API_KEY en tu archivo .env.');
      }
      if (err?.status === 429) {
        throw new Error('Sin créditos o cuota agotada en Anthropic. Revisa tu plan y facturación en console.anthropic.com.');
      }
      throw err;
    }

    return fullContent;
  }
}
