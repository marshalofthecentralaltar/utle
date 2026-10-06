import Anthropic from '@anthropic-ai/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IntentRequest } from '../src/core/pageIntent.ts'
import { STRINGS } from '../src/core/strings.ts'
import { InterpretError } from './interpret.ts'
import type { MessagesClient, ModelReply } from './interpret.ts'
import { pageIntent } from './intent.ts'

type CreateParams = Parameters<MessagesClient['messages']['create']>[0]

function answer(input: unknown): ModelReply {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_1', name: 'answer', input }] }
}

function fakeClient(...queue: Array<ModelReply | Error>): { client: MessagesClient; calls: CreateParams[] } {
  const calls: CreateParams[] = []
  const client: MessagesClient = {
    messages: {
      create: async (params) => {
        calls.push(structuredClone(params))
        const next = queue.shift()
        if (!next) throw new Error('fake client: no reply queued')
        if (next instanceof Error) throw next
        return next
      },
    },
  }
  return { client, calls }
}

const YOUTUBE: IntentRequest['page'] = {
  url: 'https://www.youtube.com/watch?v=abc',
  title: 'Kassid mängivad - YouTube',
  box: { present: true, text: '', armed: false, kind: 'search', label: 'Otsi' },
  items: [
    { id: 0, role: 'field', text: 'Otsi' },
    { id: 1, role: 'button', text: 'Meeldib' },
    { id: 2, role: 'button', text: 'Vaata hiljem' },
    { id: 3, role: 'field', text: 'Lisa kommentaar...' },
    { id: 4, role: 'link', text: 'Koerad jooksevad pargis' },
  ],
  media: { playing: true, muted: false, volume: 0.8, fullscreen: false },
  hints: false,
}

function request(overrides: Partial<IntentRequest> = {}): IntentRequest {
  return {
    lang: 'et',
    utterance: 'mine vaata hiljem',
    page: YOUTUBE,
    tabs: [{ index: 1, title: 'Kassid mängivad - YouTube', active: true }],
    recent: [],
    ...overrides,
  }
}

const CLICK_LATER = answer({ intent: { kind: 'command', command: { kind: 'clickItem', id: 2 } }, say: 'ava Vaata hiljem' })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pageIntent', () => {
  it('turns an answer call into a validated intent with one model call', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    const result = await pageIntent(request(), { client, model: 'm' })
    expect(result).toEqual({ intent: { kind: 'command', command: { kind: 'clickItem', id: 2 } }, say: 'ava Vaata hiljem', done: true })
    expect(calls).toHaveLength(1)
  })

  it('asks for one answer tool with low effort and a short budget', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    await pageIntent(request(), { client, model: 'claude-opus-5-5' })
    const params = calls[0]
    expect(params?.model).toBe('claude-opus-5-5')
    expect(params?.max_tokens).toBe(400)
    expect(params?.output_config).toEqual({ effort: 'low' })
    expect(params?.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true })
    const tools = params?.tools ?? []
    expect(tools).toHaveLength(1)
    const tool = tools[0]
    expect(tool && 'name' in tool && tool.name).toBe('answer')
    // Strict mode is off: the API rejects a strict tool this large ("The compiled grammar is too large").
    expect(tool && 'strict' in tool ? tool.strict : undefined).toBeFalsy()
  })

  it('sends the page as numbered items and the utterance in the user turn', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    await pageIntent(request(), { client, model: 'm' })
    const first = calls[0]?.messages[0]
    const text = typeof first?.content === 'string' ? first.content : ''
    expect(text).toContain('2. [button] Vaata hiljem')
    expect(text).toContain('mine vaata hiljem')
    expect(text).toContain('armed=false')
    const system = calls[0]?.system
    const systemText = typeof system === 'string' ? system : (system ?? []).map((block) => (block.type === 'text' ? block.text : '')).join('')
    expect(systemText).toContain('Always call the answer tool')
    // The fixed prompt is marked for caching.
    expect(Array.isArray(system) && system[0]?.cache_control?.type).toBe('ephemeral')
  })

  it('passes done through, true when the model leaves it out', async () => {
    const first = answer({ intent: { kind: 'command', command: { kind: 'goTo', url: 'https://www.youtube.com/' } }, say: 'avan youtube', done: false })
    const { client } = fakeClient(first, CLICK_LATER)
    const multi = await pageIntent(request({ utterance: 'mine youtube ja otsi kassivideod' }), { client, model: 'm' })
    expect(multi.done).toBe(false)
    const single = await pageIntent(request(), { client, model: 'm' })
    expect(single.done).toBe(true)
  })

  it('passes the plan through, cleaned and clipped to twelve goals, and leaves it out when empty (round 4)', async () => {
    const plan = Array.from({ length: 15 }, (_, i) => `  samm ${i + 1} `)
    const first = answer({ intent: { kind: 'command', command: { kind: 'goTo', url: 'https://www.youtube.com/' } }, say: 'lähen youtube', done: true, plan: [...plan, '', 7] })
    const { client } = fakeClient(first, CLICK_LATER)
    const chained = await pageIntent(request({ utterance: "mine youtube'i otsi kassivideod ja mängi esimene" }), { client, model: 'm' })
    expect(chained.plan).toHaveLength(12)
    expect(chained.plan?.[0]).toBe('samm 1')
    expect(chained.plan?.[11]).toBe('samm 12')
    const single = await pageIntent(request(), { client, model: 'm' })
    expect(single).toEqual({ intent: { kind: 'command', command: { kind: 'clickItem', id: 2 } }, say: 'ava Vaata hiljem', done: true })
    expect('plan' in single).toBe(false)
  })

  it('tells the model the chain in the user turn: what is done, the goal, what comes next (round 4)', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    const chain = { original: 'mine whatsappi, ava Karini viimane sõnum, kustuta see kõigi jaoks', completed: ['mine whatsappi'], goal: 'ava Karini viimane sõnum', remaining: ['kustuta see kõigi jaoks'] }
    await pageIntent(request({ utterance: 'ava Karini viimane sõnum', chain }), { client, model: 'm' })
    const text = String(calls[0]?.messages[0]?.content)
    expect(text).toContain('chain: 2/3')
    expect(text).toContain('chain original: "mine whatsappi, ava Karini viimane sõnum, kustuta see kõigi jaoks"')
    expect(text).toContain('chain done: "mine whatsappi"')
    expect(text).toContain('chain goal: "ava Karini viimane sõnum"')
    expect(text).toContain('chain next: "kustuta see kõigi jaoks"')
    const { client: fresh, calls: freshCalls } = fakeClient(CLICK_LATER)
    await pageIntent(request(), { client: fresh, model: 'm' })
    expect(String(freshCalls[0]?.messages[0]?.content)).toContain('chain: none')
  })

  it('offers hover, contextMenu and scrollTo in the tool, and the prompt says what a text item is (round 4)', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    await pageIntent(request(), { client, model: 'm' })
    const tool = calls[0]?.tools?.[0]
    const kinds = JSON.stringify(tool && 'input_schema' in tool ? tool.input_schema : {})
    for (const kind of ['hover', 'contextMenu', 'scrollTo']) expect(kinds).toContain(`"${kind}"`)
    const system = calls[0]?.system
    const systemText = typeof system === 'string' ? system : (system ?? []).map((block) => (block.type === 'text' ? block.text : '')).join('')
    expect(systemText).toContain('Several goals in one breath')
    expect(systemText).toContain('hover')
  })

  it('lists the earlier steps in the user turn, as ok or failed lines', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    const steps = [
      { action: 'command goTo', say: 'avan youtube', ok: true, message: '' },
      { action: 'command clickItem 7', say: 'ava koerte video', ok: false, message: 'not_found' },
    ]
    await pageIntent(request({ utterance: 'mine youtube ja ava koerte video', steps }), { client, model: 'm' })
    const text = String(calls[0]?.messages[0]?.content)
    expect(text).toContain('step 1: command goTo "avan youtube" -> ok')
    expect(text).toContain('step 2: command clickItem 7 "ava koerte video" -> failed: not_found')
    const { client: fresh, calls: freshCalls } = fakeClient(CLICK_LATER)
    await pageIntent(request(), { client: fresh, model: 'm' })
    expect(String(freshCalls[0]?.messages[0]?.content)).toContain('steps: none')
  })

  it('keeps the answer schema closed with every property required, done among them', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    await pageIntent(request(), { client, model: 'm' })
    const tool = calls[0]?.tools?.[0]
    const schema = tool && 'input_schema' in tool ? tool.input_schema : undefined
    expect(schema?.required).toEqual(['intent', 'say', 'done', 'plan'])
    expect(schema?.additionalProperties).toBe(false)
    const loose: string[] = []
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`))
      if (node === null || typeof node !== 'object') return
      const o = node as Record<string, unknown>
      if (o.type === 'object') {
        const keys = Object.keys((o.properties ?? {}) as object)
        if (o.additionalProperties !== false || JSON.stringify(o.required) !== JSON.stringify(keys)) loose.push(path)
      }
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`)
    }
    walk(schema, 'input_schema')
    expect(loose).toEqual([])
  })

  it('answers unclear when the item id is not on the page', async () => {
    const { client } = fakeClient(answer({ intent: { kind: 'command', command: { kind: 'clickItem', id: 99 } }, say: 'x' }))
    const result = await pageIntent(request(), { client, model: 'm' })
    expect(result).toEqual({ intent: { kind: 'unclear', say: STRINGS.et.inpage.notUnderstood }, say: '' })
  })

  it('passes dictation through when the box is armed', async () => {
    const { client } = fakeClient(answer({ intent: { kind: 'dictate', text: 'Tulen kell viis.' }, say: '' }))
    const armed = { ...YOUTUBE, box: { present: true, text: '', armed: true, kind: 'composer' as const } }
    const result = await pageIntent(request({ utterance: 'tulen kell viis', page: armed }), { client, model: 'm' })
    expect(result).toEqual({ intent: { kind: 'dictate', text: 'Tulen kell viis.' }, say: '', done: true })
  })

  it('maps a null newTab url to an absent one', async () => {
    const { client } = fakeClient(answer({ intent: { kind: 'command', command: { kind: 'newTab', url: null } }, say: 'uus leht' }))
    const result = await pageIntent(request({ utterance: 'uus leht' }), { client, model: 'm' })
    expect(result.intent).toEqual({ kind: 'command', command: { kind: 'newTab' } })
  })

  it('answers unclear on a text-only reply, a refusal or max_tokens', async () => {
    const replies: ModelReply[] = [
      { stop_reason: 'end_turn', content: [{ type: 'text' }] },
      { stop_reason: 'refusal', content: [] },
      { stop_reason: 'max_tokens', content: [{ type: 'tool_use', id: 't', name: 'answer', input: {} }] },
    ]
    for (const reply of replies) {
      const { client, calls } = fakeClient(reply)
      const result = await pageIntent(request(), { client, model: 'm' })
      expect(result.intent.kind).toBe('unclear')
      expect(calls).toHaveLength(1)
    }
  })

  it('rejects a malformed request without calling the model', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    await expect(pageIntent({ utterance: 'x' }, { client, model: 'm' })).rejects.toMatchObject({ code: 'bad_request' })
    await expect(pageIntent(request({ utterance: '  ' }), { client, model: 'm' })).rejects.toBeInstanceOf(InterpretError)
    expect(calls).toHaveLength(0)
  })

  it('maps SDK errors to codes, with no_key for a rejected key', async () => {
    const cases: Array<[Error, string, string?]> = [
      [new Anthropic.APIConnectionTimeoutError(), 'timeout'],
      [new Anthropic.APIConnectionError({ message: 'offline' }), 'upstream_unavailable'],
      [Anthropic.APIError.generate(429, undefined, 'slow down', new Headers()), 'upstream_unavailable'],
      [Anthropic.APIError.generate(500, undefined, 'boom', new Headers()), 'upstream_unavailable'],
      [Anthropic.APIError.generate(400, undefined, 'bad', new Headers()), 'upstream_rejected'],
      [Anthropic.APIError.generate(401, undefined, 'no key', new Headers()), 'upstream_rejected', 'no_key'],
      [Anthropic.APIError.generate(403, undefined, 'no key', new Headers()), 'upstream_rejected', 'no_key'],
    ]
    for (const [error, code, message] of cases) {
      const { client } = fakeClient(error)
      const expected = message ? { code, message } : { code }
      await expect(pageIntent(request(), { client, model: 'm' })).rejects.toMatchObject(expected)
    }
  })

  it('never puts the key in the request', async () => {
    const before = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-secret-key'
    try {
      const { client, calls } = fakeClient(CLICK_LATER)
      await pageIntent(request(), { client, model: 'm' })
      expect(JSON.stringify(calls[0])).not.toContain('sk-ant-test-secret-key')
    } finally {
      if (before === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = before
    }
  })

  it('logs the kind and the time, never the utterance or the page', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    )
    const { client } = fakeClient(CLICK_LATER)
    await pageIntent(request({ utterance: 'mine vaata hiljem palun' }), { client, model: 'm' })
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String))
    expect(logged.some((line) => /^\[intent\] kind=command done=true plan=0 ms=\d+$/.test(line))).toBe(true)
    const all = logged.join('\n')
    expect(all).not.toContain('vaata hiljem')
    expect(all).not.toContain('Kassid')
    expect(all).not.toContain('youtube')
  })
})
