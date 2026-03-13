import { LMStudioClient } from '@lmstudio/sdk';
import type { LLMProvider, Message } from './types';

export class LMStudioProvider implements LLMProvider {
  private client: LMStudioClient;

  constructor() {
    this.client = new LMStudioClient();
  }

  async chat(messages: Message[]): Promise<string> {
    let result = '';
    await this.chatStream(messages, (chunk) => { result += chunk; });
    return result;
  }

  async chatStream(messages: Message[], onChunk: (text: string) => void): Promise<string> {
    const model = await (process.env.LM_STUDIO_MODEL
      ? this.client.llm.model(process.env.LM_STUDIO_MODEL)
      : this.client.llm.model());

    let fullContent = '';
    for await (const fragment of model.respond(messages as any)) {
      const text = fragment.content ?? '';
      if (text) {
        onChunk(text);
        fullContent += text;
      }
    }

    // Strip internal reasoning tokens emitted by extended-thinking models
    // from the return value only — TTY already saw them in real time (desired).
    //   <|channel|>final<|message|>...<|end|>  (Qwen / channel-format models)
    //   <think>...</think>                      (DeepSeek R1 / think-tag models)
    const channelMatch = fullContent.match(/<\|channel\|>final<\|message\|>([\s\S]*?)(?:<\|end\|>|$)/);
    return channelMatch
      ? channelMatch[1].trim()
      : fullContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || fullContent;
  }
}
