import Anthropic from '@anthropic-ai/sdk'
import { ModelError } from './types.ts'
import type { Model, ModelAsk, ModelReplyNeutral, ModelStop, ModelToolCall, ModelUsage } from './types.ts'

/**
 * Round 9 (ARCHITECTURE 30.5.1): the Anthropic adapter. The SDK call of round 8 moved here
 * verbatim: the fixed prompt as the first system block, marked for caching (every call shares the
 * prefix: tools, then system); a careful ask's paragraph as a second, uncached block after it;
 * effort in output_config; tool_choice auto (forced tool use is a 400 on Sonnet 5.5 and Opus 5.5)
 * with one call at most; the SDK's own timeout and no retries.
 */

export const ANTHROPIC = 'anthropic'

/** The part of an SDK reply this adapter reads. The SDK's Message satisfies it. */
export interface AnthropicReply {
  stop_reason: string | null
  content: ReadonlyArray<{ type: string; id?: string; name?: string; input?: unknown }>
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number | null
    cache_creation_input_tokens?: number | null
  }
}

/** The part of the SDK client this adapter uses, so tests can pass a fake. */
export interface MessagesClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming, options?: { timeout?: number }): Promise<AnthropicReply>
  }
}

/**
 * The real SDK client: no retries (a voice command answers at once or not at all). Made at the
 * first ask, so a server without a key starts (rules only) and says so in /api/status.
 */
export function anthropicClient(apiKey: string | undefined): MessagesClient {
  let anthropic: Anthropic | null = null
  return {
    messages: {
      create: (params, options) => {
        anthropic ??= new Anthropic({ maxRetries: 0, ...(apiKey ? { apiKey } : {}) })
        return anthropic.messages.create(params, options)
      },
    },
  }
}

/** The request body for one ask. Exported for the tests. */
export function anthropicParams(ask: ModelAsk, model: string): Anthropic.MessageCreateParamsNonStreaming {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: ask.user }]
  for (const { call, error } of ask.corrections ?? []) {
    messages.push(
      { role: 'assistant', content: [{ type: 'tool_use', id: call.id, name: call.name, input: call.input }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, is_error: true, content: error }] },
    )
  }
  return {
    model,
    max_tokens: ask.maxTokens,
    ...(ask.effort ? { output_config: { effort: ask.effort } } : {}),
    system: [
      { type: 'text', text: ask.system, cache_control: { type: 'ephemeral' } },
      ...(ask.systemExtra !== undefined ? [{ type: 'text' as const, text: ask.systemExtra }] : []),
    ],
    tools: ask.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.schema as Anthropic.Tool.InputSchema,
      ...(tool.strict === true ? { strict: true } : {}),
    })),
    tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    messages,
  }
}

function usageOf(reply: AnthropicReply): ModelUsage {
  const usage = reply.usage
  return {
    input: usage?.input_tokens ?? 0,
    output: usage?.output_tokens ?? 0,
    cacheRead: usage?.cache_read_input_tokens ?? 0,
    cacheWrite: usage?.cache_creation_input_tokens ?? 0,
  }
}

function callOf(reply: AnthropicReply): ModelToolCall | null {
  const block = reply.content.find((b) => b.type === 'tool_use')
  if (!block || typeof block.name !== 'string') return null
  return { id: block.id ?? '', name: block.name, input: block.input }
}

/** max_tokens wins over a tool call in it: the call may be cut off. */
function stopOf(reply: AnthropicReply, call: ModelToolCall | null): ModelStop {
  if (reply.stop_reason === 'max_tokens') return 'cut'
  if (reply.stop_reason === 'refusal') return 'refusal'
  return call ? 'tool' : 'text'
}

/** The SDK's errors as the neutral kinds. */
export function anthropicError(error: unknown): ModelError {
  if (error instanceof ModelError) return error
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new ModelError('timeout', ANTHROPIC, 'The assistant took too long.')
  if (error instanceof Anthropic.APIConnectionError) return new ModelError('unreachable', ANTHROPIC, 'The assistant is unreachable.')
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0
    if (status === 401 || status === 403) return new ModelError('no_key', ANTHROPIC, 'no_key', status)
    if (status === 429 || status >= 500) return new ModelError('busy', ANTHROPIC, 'The assistant is busy or unavailable.', status)
    return new ModelError('rejected', ANTHROPIC, `The assistant rejected the request (${status}).`, status)
  }
  return new ModelError('unreachable', ANTHROPIC, 'The assistant is unreachable.')
}

export function anthropicModel(client: MessagesClient, model: string): Model {
  return {
    async ask(ask: ModelAsk): Promise<ModelReplyNeutral> {
      const started = Date.now()
      let reply: AnthropicReply
      try {
        reply = await client.messages.create(anthropicParams(ask, model), { timeout: ask.timeoutMs })
      } catch (error) {
        throw anthropicError(error)
      }
      const call = callOf(reply)
      const stop = stopOf(reply, call)
      return { call: stop === 'tool' ? call : null, stop, usage: usageOf(reply), provider: ANTHROPIC, model, ms: Date.now() - started }
    },
  }
}
