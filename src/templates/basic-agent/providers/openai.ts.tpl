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
  }
}
