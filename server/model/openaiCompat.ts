import { ModelError } from './types.ts'
import type { Model, ModelAsk, ModelReplyNeutral, ModelStop, ModelToolCall, ModelUsage } from './types.ts'

/**
 * Round 9 (ARCHITECTURE 30.5.1): any OpenAI-compatible chat completions API (DeepSeek, Fireworks,
 * DeepInfra, OpenRouter, Z.ai, Moonshot, Alibaba) by a base URL and a key. One fetch per ask, no
 * retries, the wait bounded by AbortSignal.timeout.
 */

export interface OpenAiCompatOptions {
  /** The provider's name, as the reply and the log say it: `deepseek`, `openai`, … */
  provider: string
  /** Without the trailing `/chat/completions`. */
  baseUrl: string
  apiKey: string
  model: string
  /** Tests pass a fake. Default: the global fetch. */
  fetch?: typeof fetch
}

type Json = Record<string, unknown>

/** The request body for one ask. Exported for the tests. */
export function openAiBody(ask: ModelAsk, options: Pick<OpenAiCompatOptions, 'provider' | 'model'>): Json {
  // One system message: the extra paragraph after the fixed prompt keeps the cached prefix the same.
  const system = ask.systemExtra === undefined ? ask.system : `${ask.system}\n\n${ask.systemExtra}`
  const messages: Json[] = [
    { role: 'system', content: system },
    { role: 'user', content: ask.user },
  ]
  for (const { call, error } of ask.corrections ?? []) {
    messages.push(
      { role: 'assistant', content: null, tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.input) } }] },
      { role: 'tool', tool_call_id: call.id, content: error },
    )
  }
  const tools = ask.tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.schema, ...(tool.strict === true ? { strict: true } : {}) },
  }))
  const only = ask.tools.length === 1 ? ask.tools[0] : undefined
  return {
    model: options.model,
    messages,
    tools,
    tool_choice: only ? { type: 'function', function: { name: only.name } } : 'required',
    max_tokens: ask.maxTokens,
    // Plan 4.3: no thinking on DeepSeek, careful asks included (the first token after ~11 s otherwise).
    // The field is from third-party docs of V4 Flash; lane C confirms it on a live call.
    ...(options.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
  }
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const obj = (value: unknown): Json => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {})

function usageOf(body: Json): ModelUsage {
  const usage = obj(body.usage)
  const output = num(usage.completion_tokens)
  // DeepSeek reports the cache split itself.
  if (typeof usage.prompt_cache_hit_tokens === 'number' || typeof usage.prompt_cache_miss_tokens === 'number') {
    return { input: num(usage.prompt_cache_miss_tokens), output, cacheRead: num(usage.prompt_cache_hit_tokens), cacheWrite: 0 }
  }
  const cached = num(obj(usage.prompt_tokens_details).cached_tokens)
  return { input: Math.max(0, num(usage.prompt_tokens) - cached), output, cacheRead: cached, cacheWrite: 0 }
}

function callOf(message: Json): ModelToolCall | null {
  const calls = message.tool_calls
  if (!Array.isArray(calls) || calls.length === 0) return null
  const first = obj(calls[0])
  const fn = obj(first.function)
  if (typeof fn.name !== 'string') return null
  let input: unknown
  try {
    input = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : fn.arguments
  } catch {
    return null
  }
  return { id: typeof first.id === 'string' ? first.id : '', name: fn.name, input }
}

function statusError(provider: string, status: number): ModelError {
  if (status === 401 || status === 403) return new ModelError('no_key', provider, 'no_key', status)
  if (status === 429 || status >= 500) return new ModelError('busy', provider, 'The assistant is busy or unavailable.', status)
  return new ModelError('rejected', provider, `The assistant rejected the request (${status}).`, status)
}

function fetchError(provider: string, error: unknown): ModelError {
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') return new ModelError('timeout', provider, 'The assistant took too long.')
  return new ModelError('unreachable', provider, 'The assistant is unreachable.')
}

export function openAiCompatModel(options: OpenAiCompatOptions): Model {
  const doFetch = options.fetch ?? fetch
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`
  return {
    async ask(ask: ModelAsk): Promise<ModelReplyNeutral> {
      const started = Date.now()
      let body: Json
      try {
        const response = await doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
          body: JSON.stringify(openAiBody(ask, options)),
          signal: AbortSignal.timeout(ask.timeoutMs),
        })
        if (!response.ok) throw statusError(options.provider, response.status)
        body = obj(await response.json())
      } catch (error) {
        if (error instanceof ModelError) throw error
        throw fetchError(options.provider, error)
      }
      const choice = obj(Array.isArray(body.choices) ? body.choices[0] : undefined)
      const finish = choice.finish_reason
      const call = callOf(obj(choice.message))
      const stop: ModelStop = finish === 'length' ? 'cut' : finish === 'content_filter' ? 'refusal' : call ? 'tool' : 'text'
      return { call: stop === 'tool' ? call : null, stop, usage: usageOf(body), provider: options.provider, model: options.model, ms: Date.now() - started }
    },
  }
}
