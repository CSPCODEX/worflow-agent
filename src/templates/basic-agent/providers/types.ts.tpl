export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMProvider {
  /**
   * Sends a message history to the model and returns the full response text.
   * The internal implementation may use streaming; the external contract is Promise<string>.
   */
  chat(messages: Message[]): Promise<string>;

  /**
   * Like chat() but emits chunks via callback (for TTY streaming).
   * Implementations that do not support streaming may emit a single chunk with the full text.
   */
  chatStream(messages: Message[], onChunk: (text: string) => void): Promise<string>;
}
