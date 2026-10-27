import { anthropicClient, anthropicModel } from './anthropic.ts'
import { modelConfig, specLabel } from './config.ts'
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
  model: FallbackModel
  /** `provider:model` of each slot. */
  primary: string
  fallback: string | null
  /** Whether some slot has a key, so an ask can be answered at all. */
  ready: boolean
}

/** One slot as a Model. */
export function modelFromSpec(spec: ModelSpec, options: { fetch?: typeof fetch } = {}): Model {
  if (spec.kind === 'anthropic') return anthropicModel(anthropicClient(spec.apiKey), spec.model)
  return openAiCompatModel({ provider: spec.provider, baseUrl: spec.baseUrl, apiKey: spec.apiKey, model: spec.model, ...(options.fetch ? { fetch: options.fetch } : {}) })
}

const hasKey = (spec: ModelSpec): boolean => (spec.kind === 'anthropic' ? Boolean(spec.apiKey) : true)

export function modelFromEnv(env: NodeJS.ProcessEnv, options: { fetch?: typeof fetch } = {}): ConfiguredModel {
  const { primary, fallback } = modelConfig(env)
  return {
    model: withFallback(modelFromSpec(primary, options), fallback ? modelFromSpec(fallback, options) : null),
    primary: specLabel(primary),
    fallback: fallback ? specLabel(fallback) : null,
    ready: hasKey(primary) || (fallback !== null && hasKey(fallback)),
  }
}

/** What /api/status says about the model. */
export function modelStatus(configured: ConfiguredModel): { primary: string; fallback: string | null; last: Answered | null } {
  return { primary: configured.primary, fallback: configured.fallback, last: configured.model.last() }
}

export { DEFAULT_MODEL, ModelConfigError } from './config.ts'
export { ModelError, NO_USAGE, modelTool } from './types.ts'
export type { Model, ModelAsk, ModelReplyNeutral, ModelTool, ModelToolCall, ModelUsage } from './types.ts'
