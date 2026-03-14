/**
 * lmStudioEnhancer.ts
 *
 * Proposal A: enhance the system prompt using the local LM Studio instance.
 * Throws if LM Studio is unavailable, times out, or returns an empty response.
 */

import { LMStudioClient } from '@lmstudio/sdk';
import { buildMetaPrompt, META_SYSTEM_INSTRUCTION } from './metaPrompt';
import { settingsRepository } from '../db/settingsRepository';

const TIMEOUT_MS = 15_000;

export async function enhanceWithLmStudio(
  originalPrompt: string,
  agentName: string
): Promise<string> {
  // Single DB round-trip for both settings keys
  const { lmstudioHost: host, enhancerModel } = settingsRepository.getAll();
  const lmClient = new LMStudioClient({ baseUrl: host });
  const model = enhancerModel
    ? await lmClient.llm.model(enhancerModel)
    : await lmClient.llm.model();
  if (!model) throw new Error('No hay ningún modelo cargado en LM Studio. Carga un modelo e inténtalo de nuevo.');

  const metaPrompt = buildMetaPrompt(originalPrompt, agentName);
  let fullResponse = '';

  const responsePromise = (async () => {
    for await (const fragment of model.respond([
      { role: 'system', content: META_SYSTEM_INSTRUCTION },
      { role: 'user', content: metaPrompt },
    ])) {
      fullResponse += fragment.content;
    }
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('LM Studio enhance timeout (15s)')), TIMEOUT_MS)
  );

  await Promise.race([responsePromise, timeoutPromise]);

  // Strip internal reasoning tokens produced by some models (e.g. DeepSeek-R1).
  const channelMatch = fullResponse.match(
    /<\|channel\|>final<\|message\|>([\s\S]*?)(?:<\|end\|>|$)/
  );
  const cleaned = channelMatch?.[1]?.trim()
    ?? fullResponse.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  if (!cleaned) throw new Error('LM Studio devolvió respuesta vacía');

  return cleaned;
}
