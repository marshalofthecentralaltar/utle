import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import type { IntentRequest } from '../../src/core/pageIntent.ts'
import { INTENT_TIMEOUT_CAREFUL_MS, INTENT_TIMEOUT_MS, intentAsk } from '../intent.ts'
import { CAREFUL_PROMPT, INTENT_SYSTEM_PROMPT } from '../intentPrompt.ts'
import { anthropicModel, anthropicParams } from './anthropic.ts'
import type { AnthropicReply, MessagesClient } from './anthropic.ts'
import { ModelError } from './types.ts'
import type { ModelAsk } from './types.ts'

type CreateParams = Parameters<MessagesClient['messages']['create']>[0]

function fakeClient(...queue: Array<AnthropicReply | Error>): { client: MessagesClient; calls: CreateParams[]; timeouts: Array<number | undefined> } {
  const calls: CreateParams[] = []
  const timeouts: Array<number | undefined> = []
  const client: MessagesClient = {
    messages: {
      create: async (params, options) => {
        calls.push(structuredClone(params))
        timeouts.push(options?.timeout)
        const next = queue.shift()
        if (!next) throw new Error('fake client: no reply queued')
        if (next instanceof Error) throw next
        return next
      },
    },
  }
  return { client, calls, timeouts }
}

const TOOL_REPLY: AnthropicReply = {
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: 'toolu_1', name: 'answer', input: { intent: { kind: 'unclear', say: '' }, say: '' } }],
  usage: { input_tokens: 85, output_tokens: 61, cache_read_input_tokens: 6900, cache_creation_input_tokens: 0 },
}

const REQUEST: IntentRequest = {
  lang: 'et',
  utterance: 'mine vaata hiljem',
  page: { url: 'https://www.youtube.com/', title: 'YouTube', box: { present: false, text: '', armed: false }, items: [{ id: 2, role: 'button', text: 'Vaata hiljem' }], media: null, hints: false },
  tabs: [],
  recent: [],
}

/** The system blocks as sent: text and whether each is marked for caching. */
function blocks(params: CreateParams | undefined): Array<{ text: string; cached: boolean }> {
  const system = params?.system
  if (!Array.isArray(system)) return []
  return system.map((block) => ({ text: block.text, cached: block.cache_control?.type === 'ephemeral' }))
}

describe('the Anthropic adapter sends what /api/intent sent in round 8', () => {
  it('a quick ask: the model, 400 tokens, effort low, 7 s, one tool not strict, tool_choice auto with one call, one cached block', async () => {
    const { client, calls, timeouts } = fakeClient(TOOL_REPLY)
    await anthropicModel(client, 'claude-sonnet-5-5').ask(intentAsk(REQUEST))
    const params = calls[0]
    expect(params?.model).toBe('claude-sonnet-5-5')
    expect(params?.max_tokens).toBe(400)
    expect(params?.output_config).toEqual({ effort: 'low' })
    expect(params?.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true })
    expect(params?.tools).toHaveLength(1)
    const tool = params?.tools?.[0]
    expect(tool && 'name' in tool && tool.name).toBe('answer')
    expect(tool && 'strict' in tool ? tool.strict : undefined).toBeFalsy()
    expect(tool && 'input_schema' in tool && (tool.input_schema as { required?: unknown }).required).toEqual(['intent', 'say', 'done', 'plan'])
    expect(blocks(params)).toEqual([{ text: INTENT_SYSTEM_PROMPT, cached: true }])
    expect(timeouts).toEqual([INTENT_TIMEOUT_MS])
    const user = params?.messages[0]
    expect(user?.role).toBe('user')
    expect(typeof user?.content === 'string' && user.content).toContain('2. [button] Vaata hiljem')
    expect(params?.messages).toHaveLength(1)
  })

  it('a careful ask: 2000 tokens, effort high, 12 s, the careful paragraph as a second uncached block after the same cached one', async () => {
    const { client, calls, timeouts } = fakeClient(TOOL_REPLY)
    await anthropicModel(client, 'm').ask(intentAsk({ ...REQUEST, care: 'careful' }))
    const params = calls[0]
    expect(params?.max_tokens).toBe(2000)
    expect(params?.output_config).toEqual({ effort: 'high' })
    expect(timeouts).toEqual([INTENT_TIMEOUT_CAREFUL_MS])
    expect(blocks(params)).toEqual([
      { text: INTENT_SYSTEM_PROMPT, cached: true },
      { text: CAREFUL_PROMPT, cached: false },
    ])
  })

  it('no effort, no output_config; a strict tool stays strict; corrections become an assistant call and an error result', async () => {
    const ask: ModelAsk = {
      system: 's',
      user: 'u',
      tools: [{ name: 'a', description: 'd', schema: { type: 'object' }, strict: true }],
      corrections: [{ call: { id: 'toolu_bad', name: 'a', input: { x: 1 } }, error: 'find_ambiguous' }],
      maxTokens: 4000,
      timeoutMs: 20_000,
    }
    const params = anthropicParams(ask, 'm')
    expect('output_config' in params).toBe(false)
    expect(params.tools?.[0]).toMatchObject({ name: 'a', strict: true, input_schema: { type: 'object' } })
    expect(params.messages).toEqual([
      { role: 'user', content: 'u' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_bad', name: 'a', input: { x: 1 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_bad', is_error: true, content: 'find_ambiguous' }] },
    ])
  })
})

describe('the Anthropic adapter reads the reply', () => {
  it('reads usage into the neutral shape, the call, the provider and the model', async () => {
    const { client } = fakeClient(TOOL_REPLY)
    const reply = await anthropicModel(client, 'claude-sonnet-5-5').ask(intentAsk(REQUEST))
    expect(reply.usage).toEqual({ input: 85, output: 61, cacheRead: 6900, cacheWrite: 0 })
    expect(reply.stop).toBe('tool')
    expect(reply.call).toEqual({ id: 'toolu_1', name: 'answer', input: { intent: { kind: 'unclear', say: '' }, say: '' } })
    expect(reply.provider).toBe('anthropic')
    expect(reply.model).toBe('claude-sonnet-5-5')
    expect(reply.ms).toBeGreaterThanOrEqual(0)
  })

  it('null or missing cache fields read as 0', async () => {
    const { client } = fakeClient({ ...TOOL_REPLY, usage: { input_tokens: 7000, output_tokens: 50, cache_read_input_tokens: null, cache_creation_input_tokens: 6900 } }, { ...TOOL_REPLY, usage: { input_tokens: 1, output_tokens: 2 } })
    const model = anthropicModel(client, 'm')
    expect((await model.ask(intentAsk(REQUEST))).usage).toEqual({ input: 7000, output: 50, cacheRead: 0, cacheWrite: 6900 })
    expect((await model.ask(intentAsk(REQUEST))).usage).toEqual({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0 })
  })

  it('max_tokens is cut (with no call, even when a tool call was in it), refusal is refusal, text is text', async () => {
    const { client } = fakeClient(
      { stop_reason: 'max_tokens', content: [{ type: 'tool_use', id: 't', name: 'answer', input: {} }] },
      { stop_reason: 'refusal', content: [] },
      { stop_reason: 'end_turn', content: [{ type: 'text' }] },
    )
    const model = anthropicModel(client, 'm')
    expect(await model.ask(intentAsk(REQUEST))).toMatchObject({ stop: 'cut', call: null, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })
    expect(await model.ask(intentAsk(REQUEST))).toMatchObject({ stop: 'refusal', call: null })
    expect(await model.ask(intentAsk(REQUEST))).toMatchObject({ stop: 'text', call: null })
  })

  it('maps the SDK errors to the neutral kinds', async () => {
    const cases: Array<[Error, ModelError['kind'], number?]> = [
      [new Anthropic.APIConnectionTimeoutError(), 'timeout'],
      [new Anthropic.APIConnectionError({ message: 'connect ECONNREFUSED' }), 'unreachable'],
      [Anthropic.APIError.generate(429, undefined, 'slow down', new Headers()), 'busy', 429],
      [Anthropic.APIError.generate(500, undefined, 'boom', new Headers()), 'busy', 500],
      [Anthropic.APIError.generate(529, undefined, 'overloaded', new Headers()), 'busy', 529],
      [Anthropic.APIError.generate(400, undefined, 'bad', new Headers()), 'rejected', 400],
      [Anthropic.APIError.generate(401, undefined, 'no key', new Headers()), 'no_key', 401],
      [Anthropic.APIError.generate(403, undefined, 'no key', new Headers()), 'no_key', 403],
      [new Error('something else'), 'unreachable'],
    ]
    for (const [error, kind, status] of cases) {
      const { client } = fakeClient(error)
      const failure = await anthropicModel(client, 'm').ask(intentAsk(REQUEST)).catch((e: unknown) => e)
      expect(failure).toBeInstanceOf(ModelError)
      expect(failure).toMatchObject({ kind, provider: 'anthropic', status })
    }
  })

  it('never puts the key in the request', async () => {
    const before = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-secret-key'
    try {
      const { client, calls } = fakeClient(TOOL_REPLY)
      await anthropicModel(client, 'm').ask(intentAsk(REQUEST))
      expect(JSON.stringify(calls[0])).not.toContain('sk-ant-test-secret-key')
    } finally {
      if (before === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = before
    }
  })
})
