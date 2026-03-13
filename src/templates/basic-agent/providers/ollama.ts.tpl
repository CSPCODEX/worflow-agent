import type { LLMProvider, Message } from './types';

const OLLAMA_BASE_URL = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

export class OllamaProvider implements LLMProvider {
  async chat(messages: Message[]): Promise<string> {
    let result = '';
    await this.chatStream(messages, (chunk) => { result += chunk; });
    return result;
  }

  async chatStream(messages: Message[], onChunk: (text: string) => void): Promise<string> {
    const model = process.env.OLLAMA_MODEL ?? 'llama3.2';

    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Ollama API returned no response body.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value, { stream: true }).split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          const chunk = parsed.message?.content ?? '';
          if (chunk) {
            fullContent += chunk;
            onChunk(chunk);
          }
        } catch {
          // Ignore malformed lines
        }
      }
    }

    return fullContent;
  }
}
