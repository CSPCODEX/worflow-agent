/**
 * promptEnhancer.ts
 *
 * Orchestrator: tries LM Studio first (Proposal A), falls back to static enhancer (Proposal C).
 * Never throws — always resolves.
 */

import { enhanceWithLmStudio } from './lmStudioEnhancer';
import { enhanceStatic } from './staticEnhancer';

export interface EnhanceResult {
  enhancedPrompt: string;
  strategy: 'lmstudio' | 'static' | 'failed';
  error?: string;
}

export async function enhancePrompt(
  originalPrompt: string,
  agentName: string
): Promise<EnhanceResult> {
  // --- Proposal A: LM Studio ---
  try {
    const enhanced = await enhanceWithLmStudio(originalPrompt, agentName);
    return { enhancedPrompt: enhanced, strategy: 'lmstudio' };
  } catch (lmErr: any) {
    console.error('[enhancer] LM Studio failed, using static fallback:', lmErr.message);
  }

  // --- Proposal C: static enhancer ---
  try {
    const enhanced = enhanceStatic(originalPrompt);
    return { enhancedPrompt: enhanced, strategy: 'static' };
  } catch (staticErr: any) {
    // Extreme edge case — static enhancer should never throw
    return {
      enhancedPrompt: originalPrompt,
      strategy: 'failed',
      error: staticErr.message,
    };
  }
}
