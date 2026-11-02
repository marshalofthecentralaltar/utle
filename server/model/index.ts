import { anthropicClient, anthropicModel } from './anthropic.ts'
import { hasKey, modelConfig, specLabel } from './config.ts'
import type { ModelSpec } from './config.ts'
import { withFallback } from './fallback.ts'
import type { Answered, FallbackModel } from './fallback.ts'
import { openAiCompatModel } from './openaiCompat.ts'
import type { Model } from './types.ts'

/**
 * Round 9 (ARCHITECTURE 30.5): the configured model, from the environment. Throws
 * ModelConfigError at start when a slot names an unknown provider or lacks its key.
 */

export interface ConfiguredModel {
  /** The quick asks and the addressee check (UTLE_MODEL). */
  model: FallbackModel
  /** Round 10 (#7, 33.1): the careful asks (UTLE_MODEL_CAREFUL), with the same fallback. */
  careful: FallbackModel
  /** `provider:model` of each slot. */
  primary: string
  carefulLabel: string
  fallback: string | null
  /** Whether the quick slot or the fallback has a key, so an ask can be answered at all. */
  ready: boolean
}

/** One slot as a Model. */
export function modelFromSpec(spec: ModelSpec, options: { fetch?: typeof fetch } = {}): Model {
  if (spec.kind === 'anthropic') return anthropicModel(anthropicClient(spec.apiKey), spec.model)
  return openAiCompatModel({ provider: spec.provider, baseUrl: spec.baseUrl, apiKey: spec.apiKey, model: spec.model, ...(options.fetch ? { fetch: options.fetch } : {}) })
}

export function modelFromEnv(env: NodeJS.ProcessEnv, options: { fetch?: typeof fetch } = {}): ConfiguredModel {
  const { primary, careful, fallback } = modelConfig(env)
  // Each slot gets its own instance of the fallback, so each reports its own last.
  const behind = (): Model | null => (fallback ? modelFromSpec(fallback, options) : null)
  return {
    model: withFallback(modelFromSpec(primary, options), behind()),
    careful: withFallback(modelFromSpec(careful, options), behind()),
    primary: specLabel(primary),
    carefulLabel: specLabel(careful),
    fallback: fallback ? specLabel(fallback) : null,
    ready: hasKey(primary) || (fallback !== null && hasKey(fallback)),
  }
}

/** What /api/status says about the models. Round 10 (33.1): careful and its own last. */
export function modelStatus(configured: ConfiguredModel): { primary: string; careful: string; fallback: string | null; last: Answered | null; lastCareful: Answered | null } {
  return { primary: configured.primary, careful: configured.carefulLabel, fallback: configured.fallback, last: configured.model.last(), lastCareful: configured.careful.last() }
}

export { DEFAULT_CAREFUL_MODEL, DEFAULT_MODEL, ModelConfigError } from './config.ts'
export { ModelError, NO_USAGE, modelTool } from './types.ts'
export type { Model, ModelAsk, ModelReplyNeutral, ModelTool, ModelToolCall, ModelUsage } from './types.ts'
