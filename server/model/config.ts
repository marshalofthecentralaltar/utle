/**
 * Round 9 (ARCHITECTURE 30.5.2): one string per slot, provider and model joined by a colon.
 * `UTLE_MODEL=anthropic:claude-sonnet-5-5` (the default), `UTLE_MODEL=deepseek:deepseek-flash`,
 * `UTLE_MODEL=openai:<model>` with UTLE_MODEL_URL and UTLE_MODEL_KEY. A bare id stays Anthropic, so
 * every UTLE_MODEL of earlier rounds keeps working. UTLE_FALLBACK names the second model, same syntax.
 * Round 10 (#7, ARCHITECTURE 33.1): UTLE_MODEL serves the quick asks (and the addressee check),
 * UTLE_MODEL_CAREFUL the careful ones; UTLE_FALLBACK stands behind each.
 */

/** Sonnet 5.5: the eval on Opus 5.5 gave p50 2.7 s per command, too slow for a spoken command. */
export const DEFAULT_MODEL = 'claude-sonnet-5-5'
/** Round 10 (33.1): the careful asks' model when neither UTLE_MODEL nor UTLE_MODEL_CAREFUL is set. */
export const DEFAULT_CAREFUL_MODEL = 'claude-sonnet-5-5'

export type Slot = 'UTLE_MODEL' | 'UTLE_MODEL_CAREFUL' | 'UTLE_FALLBACK'

export type ModelSpec =
  | { kind: 'anthropic'; provider: 'anthropic'; model: string; apiKey: string | undefined }
  | { kind: 'openai'; provider: string; model: string; baseUrl: string; apiKey: string }

/** The providers known by name: their base URL and the variable their key is read from. */
export const KNOWN_PROVIDERS: Readonly<Record<string, { baseUrl: string; keyVar: string }>> = {
  deepseek: { baseUrl: 'https://api.deepseek.com', keyVar: 'DEEPSEEK_API_KEY' },
  fireworks: { baseUrl: 'https://api.fireworks.ai/inference/v1', keyVar: 'FIREWORKS_API_KEY' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyVar: 'OPENROUTER_API_KEY' },
}

/** A configuration the server cannot start with. The message names the variable. */
export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelConfigError'
  }
}

/** `provider:model` for /api/status and the log. */
export function specLabel(spec: ModelSpec): string {
  return `${spec.provider}:${spec.model}`
}

/** One slot's string as a spec. Throws ModelConfigError with a line a person can act on. */
export function parseModelSpec(value: string, slot: Slot, env: NodeJS.ProcessEnv): ModelSpec {
  const text = value.trim()
  const colon = text.indexOf(':')
  const provider = colon < 0 ? 'anthropic' : text.slice(0, colon).trim().toLowerCase()
  const model = colon < 0 ? text : text.slice(colon + 1).trim()
  if (model === '') throw new ModelConfigError(`${slot}=${value}: no model after the provider (write ${slot}=provider:model).`)
  if (provider === 'anthropic') return { kind: 'anthropic', provider, model, apiKey: env.ANTHROPIC_API_KEY }
  const known = KNOWN_PROVIDERS[provider]
  if (known) {
    const apiKey = env[known.keyVar]
    if (!apiKey) throw new ModelConfigError(`${slot}=${value} needs ${known.keyVar} in the server's environment.`)
    return { kind: 'openai', provider, model, baseUrl: known.baseUrl, apiKey }
  }
  if (provider === 'openai') {
    const urlVar = `${slot}_URL`
    const keyVar = `${slot}_KEY`
    const baseUrl = env[urlVar]
    const apiKey = env[keyVar]
    if (!baseUrl) throw new ModelConfigError(`${slot}=${value} needs ${urlVar} (the API's base URL, without /chat/completions).`)
    if (!apiKey) throw new ModelConfigError(`${slot}=${value} needs ${keyVar} in the server's environment.`)
    return { kind: 'openai', provider, model, baseUrl, apiKey }
  }
  const names = ['anthropic', ...Object.keys(KNOWN_PROVIDERS), 'openai'].join(', ')
  throw new ModelConfigError(`${slot}=${value}: unknown provider "${provider}" (known: ${names}).`)
}

/** Whether a slot has its key: an Anthropic slot may lack one (the server then answers by the rules only). */
export function hasKey(spec: ModelSpec): boolean {
  return spec.kind === 'anthropic' ? Boolean(spec.apiKey) : true
}

/**
 * Every slot. UTLE_MODEL unset is the default; UTLE_FALLBACK unset or empty is none. Round 10 (33.1):
 * UTLE_MODEL_CAREFUL unset is the quick model when UTLE_MODEL is set, else DEFAULT_CAREFUL_MODEL.
 * A careful slot that cannot answer (Anthropic without ANTHROPIC_API_KEY, no fallback with a key)
 * while the quick slot can stops the start: every careful ask would fail at run time. With no key
 * anywhere the server still starts, rules only.
 */
export function modelConfig(env: NodeJS.ProcessEnv): { primary: ModelSpec; careful: ModelSpec; fallback: ModelSpec | null } {
  const quickSet = Boolean(env.UTLE_MODEL?.trim())
  const primary = parseModelSpec(quickSet && env.UTLE_MODEL ? env.UTLE_MODEL : DEFAULT_MODEL, 'UTLE_MODEL', env)
  const carefulSet = env.UTLE_MODEL_CAREFUL?.trim() ? env.UTLE_MODEL_CAREFUL : null
  const careful = carefulSet !== null ? parseModelSpec(carefulSet, 'UTLE_MODEL_CAREFUL', env) : quickSet ? primary : parseModelSpec(DEFAULT_CAREFUL_MODEL, 'UTLE_MODEL_CAREFUL', env)
  const fallback = env.UTLE_FALLBACK?.trim() ? parseModelSpec(env.UTLE_FALLBACK, 'UTLE_FALLBACK', env) : null
  const answers = (spec: ModelSpec): boolean => hasKey(spec) || (fallback !== null && hasKey(fallback))
  if (carefulSet !== null && answers(primary) && !answers(careful)) {
    throw new ModelConfigError(`UTLE_MODEL_CAREFUL=${carefulSet} needs ANTHROPIC_API_KEY in the server's environment.`)
  }
  return { primary, careful, fallback }
}
