import 'server-only';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';

/**
 * Model factory for the language and vision models (docs/MANUAL.md §5).
 *
 * `AI_PROVIDER` selects the SDK provider (`google` by default, `openai` supported).
 * Model ids are configurable (`LLM_MODEL`, `VLM_MODEL`) and never hard-coded here:
 * Gemini/OpenAI model names change, so `.env.local` / Render decides.
 *
 * This module deliberately reads `process.env` directly instead of importing
 * `src/server/env.ts`: the vision tasks gate on T01/T02 only, while env.ts is created
 * later by the backend lane. The caller (T13) passes thresholds separately.
 */
export type AiProvider = 'google' | 'openai';

export function getAiProvider(): AiProvider {
  const provider = (process.env.AI_PROVIDER ?? 'google').toLowerCase();
  if (provider !== 'google' && provider !== 'openai') {
    throw new Error(`AI_PROVIDER must be "google" or "openai", got "${process.env.AI_PROVIDER}"`);
  }
  return provider;
}

function modelId(explicit: string | undefined, envName: 'LLM_MODEL' | 'VLM_MODEL'): string {
  const id = explicit ?? process.env[envName];
  if (!id || id.trim() === '' || id.startsWith('<')) {
    throw new Error(`${envName} is not configured; set it to a current model id for AI_PROVIDER=${getAiProvider()}`);
  }
  return id;
}

/** Language model used for criteria generation and the settlement agent. */
export function getLanguageModel(explicitId?: string) {
  const id = modelId(explicitId, 'LLM_MODEL');
  return getAiProvider() === 'openai' ? openai(id) : google(id);
}

/** Vision-language model used for photo verification. */
export function getVisionModel(explicitId?: string) {
  const id = modelId(explicitId, 'VLM_MODEL');
  return getAiProvider() === 'openai' ? openai(id) : google(id);
}
