import { GoogleGenerativeAI } from '@google/generative-ai';
import type { LLMProvider, Message } from './types';
import { decryptIfNeeded } from './crypto';

export class GeminiProvider implements LLMProvider {
  private genAI: GoogleGenerativeAI;

  constructor() {
    const rawKey = process.env.GEMINI_API_KEY ?? '';
    if (!rawKey) {
      throw new Error('GEMINI_API_KEY no está configurada en el archivo .env del agente.');
    }
    const apiKey = decryptIfNeeded(rawKey);
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async chat(messages: Message[]): Promise<string> {
    let result = '';
    await this.chatStream(messages, (chunk) => { result += chunk; });
    return result;
  }

  async chatStream(messages: Message[], onChunk: (text: string) => void): Promise<string> {
    const modelName = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite';

    // Gemini separates the system instruction from the conversation history
    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    const systemInstruction = systemMessages.map((m) => m.content).join('\n') || undefined;

    const model = this.genAI.getGenerativeModel({
      model: modelName,
      ...(systemInstruction ? { systemInstruction } : {}),
    });

    // Build Gemini chat history (all messages except the last user message)
    const lastMessage = conversationMessages[conversationMessages.length - 1];
    const historyMessages = conversationMessages.slice(0, -1);

    const history = historyMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history });

    const result = await chat.sendMessageStream(lastMessage?.content ?? '');

    let fullContent = '';
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        fullContent += text;
        onChunk(text);
      }
    }

    return fullContent;
  }
}
