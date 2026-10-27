import { describe, expect, it } from 'vitest'
import type { IntentRequest } from '../../src/core/pageIntent.ts'
import { intentAsk } from '../intent.ts'
import { CAREFUL_PROMPT, INTENT_SYSTEM_PROMPT } from '../intentPrompt.ts'
import { openAiBody, openAiCompatModel } from './openaiCompat.ts'
import { ModelError } from './types.ts'
import type { ModelAsk } from './types.ts'

const REQUEST: IntentRequest = {
  lang: 'et',
  utterance: 'mine vaata hiljem',
  page: { url: 'https://www.youtube.com/', title: 'YouTube', box: { present: false, text: '', armed: false }, items: [{ id: 2, role: 'button', text: 'Vaata hiljem' }], media: null, hints: false },
  tabs: [],
  recent: [],
}

interface Sent {
  url: string
  init: RequestInit
  body: Record<string, unknown>
}

/** A fetch that answers from a queue: a Response, or an error to throw. */
function fakeFetch(...queue: Array<Response | Error>): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = []
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    sent.push({ url: String(input), init: init ?? {}, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    const next = queue.shift()
    if (!next) throw new Error('fake fetch: nothing queued')
    if (next instanceof Error) throw next
    return next
  }
  return { fetch: fake as typeof fetch, sent }
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const TOOL_REPLY = {
  choices: [
    {
      finish_reason: 'tool_calls',
      message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'answer', arguments: '{"intent":{"kind":"unclear","say":""},"say":"","done":true,"plan":[]}' } }] },
    },
  ],
  usage: { prompt_tokens: 7100, completion_tokens: 52, prompt_cache_hit_tokens: 6912, prompt_cache_miss_tokens: 188 },
}

const model = (f: typeof fetch, provider = 'deepseek') => openAiCompatModel({ provider, baseUrl: 'https://api.example.test/', apiKey: 'sk-test-key', model: 'deepseek-flash', fetch: f })

describe('the OpenAI-compatible adapter builds the request from a ModelAsk', () => {
  it('posts to base/chat/completions with the key as a bearer header and the ask as messages, one tool, forced by name', async () => {
    const { fetch, sent } = fakeFetch(json(TOOL_REPLY))
    await model(fetch).ask(intentAsk(REQUEST))
    expect(sent[0]?.url).toBe('https://api.example.test/chat/completions')
    expect(sent[0]?.init.method).toBe('POST')
    expect((sent[0]?.init.headers as Record<string, string> | undefined)?.authorization).toBe('Bearer sk-test-key')
    const body = sent[0]?.body ?? {}
    expect(body.model).toBe('deepseek-flash')
    expect(body.max_tokens).toBe(400)
    const messages = body.messages as Array<{ role: string; content: string }>
    expect(messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(messages[0]?.content).toBe(INTENT_SYSTEM_PROMPT)
    expect(messages[1]?.content).toContain('2. [button] Vaata hiljem')
    const tools = body.tools as Array<{ type: string; function: { name: string; parameters: { required?: unknown }; strict?: boolean } }>
    expect(tools).toHaveLength(1)
    expect(tools[0]?.type).toBe('function')
    expect(tools[0]?.function.name).toBe('answer')
    expect(tools[0]?.function.parameters.required).toEqual(['intent', 'say', 'done', 'plan'])
    expect('strict' in (tools[0]?.function ?? {})).toBe(false)
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'answer' } })
    // The signal is the timeout.
    expect(sent[0]?.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('DeepSeek: thinking disabled on quick and careful asks alike (plan 4.3); other providers get no thinking field', () => {
    const quick = openAiBody(intentAsk(REQUEST), { provider: 'deepseek', model: 'deepseek-flash' })
    const careful = openAiBody(intentAsk({ ...REQUEST, care: 'careful' }), { provider: 'deepseek', model: 'deepseek-flash' })
    expect(quick.thinking).toEqual({ type: 'disabled' })
    expect(careful.thinking).toEqual({ type: 'disabled' })
    expect(careful.max_tokens).toBe(2000)
    expect('thinking' in openAiBody(intentAsk(REQUEST), { provider: 'fireworks', model: 'x' })).toBe(false)
  })

  it('a careful ask: one system message, the careful paragraph after the unchanged prefix', () => {
    const body = openAiBody(intentAsk({ ...REQUEST, care: 'careful' }), { provider: 'openai', model: 'x' })
    const system = (body.messages as Array<{ content: string }>)[0]?.content ?? ''
    expect(system.startsWith(INTENT_SYSTEM_PROMPT)).toBe(true)
    expect(system.endsWith(CAREFUL_PROMPT)).toBe(true)
  })

  it('several tools: tool_choice required, a strict one says so; corrections become an assistant tool call and a tool message', () => {
    const ask: ModelAsk = {
      system: 's',
      user: 'u',
      tools: [
        { name: 'a', description: 'da', schema: { type: 'object' }, strict: true },
        { name: 'b', description: 'db', schema: { type: 'object' } },
      ],
      corrections: [{ call: { id: 'call_bad', name: 'a', input: { x: 1 } }, error: 'find_ambiguous' }],
      maxTokens: 4000,
      timeoutMs: 20_000,
    }
    const body = openAiBody(ask, { provider: 'openai', model: 'x' })
    expect(body.tool_choice).toBe('required')
    expect((body.tools as Array<{ function: { strict?: boolean } }>)[0]?.function.strict).toBe(true)
    expect(body.messages).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_bad', type: 'function', function: { name: 'a', arguments: '{"x":1}' } }] },
      { role: 'tool', tool_call_id: 'call_bad', content: 'find_ambiguous' },
    ])
  })
})

describe('the OpenAI-compatible adapter reads the reply', () => {
  it('a tool_calls reply: the parsed call, DeepSeek cache hit and miss as cacheRead and input', async () => {
    const { fetch } = fakeFetch(json(TOOL_REPLY))
    const reply = await model(fetch).ask(intentAsk(REQUEST))
    expect(reply.stop).toBe('tool')
    expect(reply.call).toEqual({ id: 'call_1', name: 'answer', input: { intent: { kind: 'unclear', say: '' }, say: '', done: true, plan: [] } })
    expect(reply.usage).toEqual({ input: 188, output: 52, cacheRead: 6912, cacheWrite: 0 })
    expect(reply.provider).toBe('deepseek')
    expect(reply.model).toBe('deepseek-flash')
  })

  it('without the DeepSeek fields: prompt_tokens less cached_tokens is input', async () => {
    const { fetch } = fakeFetch(json({ ...TOOL_REPLY, usage: { prompt_tokens: 7100, completion_tokens: 52, prompt_tokens_details: { cached_tokens: 6900 } } }), json({ ...TOOL_REPLY, usage: { prompt_tokens: 300, completion_tokens: 9 } }))
    const m = model(fetch, 'openai')
    expect((await m.ask(intentAsk(REQUEST))).usage).toEqual({ input: 200, output: 52, cacheRead: 6900, cacheWrite: 0 })
    expect((await m.ask(intentAsk(REQUEST))).usage).toEqual({ input: 300, output: 9, cacheRead: 0, cacheWrite: 0 })
  })

  it('a text reply is text with no call', async () => {
    const { fetch } = fakeFetch(json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Ma ei saa aru.' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }))
    expect(await model(fetch).ask(intentAsk(REQUEST))).toMatchObject({ stop: 'text', call: null, usage: { input: 10, output: 5 } })
  })

  it('a cut reply (finish_reason length) is cut with no call, even with a tool call in it', async () => {
    const cut = { ...TOOL_REPLY, choices: [{ ...TOOL_REPLY.choices[0], finish_reason: 'length' }] }
    const { fetch } = fakeFetch(json(cut))
    expect(await model(fetch).ask(intentAsk(REQUEST))).toMatchObject({ stop: 'cut', call: null })
  })

  it('content_filter is a refusal', async () => {
    const { fetch } = fakeFetch(json({ choices: [{ finish_reason: 'content_filter', message: { role: 'assistant', content: '' } }] }))
    expect(await model(fetch).ask(intentAsk(REQUEST))).toMatchObject({ stop: 'refusal', call: null })
  })

  it('malformed arguments are text with no call', async () => {
    const bad = { ...TOOL_REPLY, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'answer', arguments: '{"intent": {"kind": ' } }] } }] }
    const { fetch } = fakeFetch(json(bad))
    expect(await model(fetch).ask(intentAsk(REQUEST))).toMatchObject({ stop: 'text', call: null })
  })

  it('429 is busy, 5xx busy, 401 and 403 no_key, 400 rejected; the status is kept', async () => {
    const cases: Array<[number, ModelError['kind']]> = [
      [429, 'busy'],
      [500, 'busy'],
      [503, 'busy'],
      [401, 'no_key'],
      [403, 'no_key'],
      [400, 'rejected'],
      [422, 'rejected'],
    ]
    for (const [status, kind] of cases) {
      const { fetch } = fakeFetch(json({ error: { message: 'x' } }, status))
      const failure = await model(fetch).ask(intentAsk(REQUEST)).catch((e: unknown) => e)
      expect(failure).toBeInstanceOf(ModelError)
      expect(failure).toMatchObject({ kind, status, provider: 'deepseek' })
    }
  })

  it('a connection error (refused, reset) is unreachable; the timeout signal is timeout', async () => {
    const refused = new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }) })
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    const { fetch } = fakeFetch(refused, timeout)
    const m = model(fetch)
    expect(await m.ask(intentAsk(REQUEST)).catch((e: unknown) => e)).toMatchObject({ kind: 'unreachable', provider: 'deepseek' })
    expect(await m.ask(intentAsk(REQUEST)).catch((e: unknown) => e)).toMatchObject({ kind: 'timeout', provider: 'deepseek' })
  })

  it('a body that is not JSON is unreachable', async () => {
    const { fetch } = fakeFetch(new Response('<html>bad gateway</html>', { status: 200 }))
    expect(await model(fetch).ask(intentAsk(REQUEST)).catch((e: unknown) => e)).toMatchObject({ kind: 'unreachable' })
  })

  it('the real timeout: a fetch that never answers ends at timeoutMs as timeout', async () => {
    const hanging = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason instanceof Error ? init.signal.reason : new DOMException('aborted', 'AbortError')))
      })) as typeof fetch
    const ask = { ...intentAsk(REQUEST), timeoutMs: 30 }
    const started = Date.now()
    expect(await model(hanging).ask(ask).catch((e: unknown) => e)).toMatchObject({ kind: 'timeout' })
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
