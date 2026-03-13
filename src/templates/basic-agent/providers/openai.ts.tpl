import OpenAI from 'openai';
import type { LLMProvider, Message } from './types';
import { decryptIfNeeded } from './crypto';

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;

  constructor() {
    const rawKey = process.env.OPENAI_API_KEY ?? '';
    if (!rawKey) {
      throw new Error('OPENAI_API_KEY no está configurada en el archivo .env del agente.');
    }
    const apiKey = decryptIfNeeded(rawKey);
    this.client = new OpenAI({ apiKey });
  }

  async chat(messages: Message[]): Promise<string> {
    let result = '';
    await this.chatStream(messages, (chunk) => { result += chunk; });
    return result;
  }

  async chatStream(messages: Message[], onChunk: (text: string) => void): Promise<string> {
    const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        stream: true,
      });

      let fullContent = '';
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content ?? '';
        if (text) {
          fullContent += text;
          onChunk(text);
        }
      }

      return fullContent;
    } catch (err: any) {
      if (err?.status === 401) {
        throw new Error('API key de OpenAI inválida o revocada. Verifica el valor de OPENAI_API_KEY en tu archivo .env.');
      }
      if (err?.status === 429) {
        throw new Error('Sin créditos o cuota agotada en OpenAI. Revisa tu plan y facturación en platform.openai.com.');
      }
      if (err?.status === 402) {
        throw new Error('Saldo insuficiente en tu cuenta de OpenAI. Añade créditos en platform.openai.com.');
      }
      throw err;
    }
  }
}
