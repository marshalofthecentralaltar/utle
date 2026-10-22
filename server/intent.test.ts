import Anthropic from '@anthropic-ai/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IntentRequest } from '../src/core/pageIntent.ts'
import { STRINGS } from '../src/core/strings.ts'
import { InterpretError } from './interpret.ts'
import type { MessagesClient, ModelReply } from './interpret.ts'
import { INTENT_TIMEOUT_CAREFUL_MS, INTENT_TIMEOUT_MS, careSettings, pageIntent } from './intent.ts'
import { ANSWER_TOOL, CAREFUL_PROMPT, INTENT_SYSTEM_PROMPT } from './intentPrompt.ts'

type CreateParams = Parameters<MessagesClient['messages']['create']>[0]

function answer(input: unknown): ModelReply {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_1', name: 'answer', input }] }
}

function fakeClient(...queue: Array<ModelReply | Error>): { client: MessagesClient; calls: CreateParams[]; timeouts: Array<number | undefined> } {
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

/** The system blocks' texts, in order. */
function systemTexts(params: CreateParams | undefined): string[] {
  const system = params?.system
  if (typeof system === 'string') return [system]
  return (system ?? []).map((block) => (block.type === 'text' ? block.text : ''))
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
    expect(logged.some((line) => /^\[intent\] kind=command done=true plan=0 care=quick ms=\d+$/.test(line))).toBe(true)
    const all = logged.join('\n')
    expect(all).not.toContain('vaata hiljem')
    expect(all).not.toContain('Kassid')
    expect(all).not.toContain('youtube')
  })

  describe('care (round 5)', () => {
    it('a quick ask, or one without care, gets low effort, 400 tokens, 7 s and the one cached system block', async () => {
      const { client, calls, timeouts } = fakeClient(CLICK_LATER, CLICK_LATER)
      await pageIntent(request(), { client, model: 'm' })
      await pageIntent(request({ care: 'quick' }), { client, model: 'm' })
      for (const params of calls) {
        expect(params.max_tokens).toBe(400)
        expect(params.output_config).toEqual({ effort: 'low' })
        expect(systemTexts(params)).toHaveLength(1)
      }
      expect(timeouts).toEqual([INTENT_TIMEOUT_MS, INTENT_TIMEOUT_MS])
      expect(INTENT_TIMEOUT_MS).toBe(7000)
    })

    it('a careful ask gets high effort, 2000 tokens, 12 s, and the careful paragraph as a second block after the unchanged cached one', async () => {
      const { client, calls, timeouts } = fakeClient(CLICK_LATER)
      await pageIntent(request({ care: 'careful', utterance: 'mine youtube ja otsi kassivideod ja mängi esimene' }), { client, model: 'm' })
      const params = calls[0]
      expect(params?.max_tokens).toBe(2000)
      expect(params?.output_config).toEqual({ effort: 'high' })
      expect(timeouts).toEqual([INTENT_TIMEOUT_CAREFUL_MS])
      expect(INTENT_TIMEOUT_CAREFUL_MS).toBe(12_000)
      const blocks = systemTexts(params)
      expect(blocks).toHaveLength(2)
      expect(blocks[0]).toBe(INTENT_SYSTEM_PROMPT)
      expect(blocks[1]).toBe(CAREFUL_PROMPT)
      expect(blocks[1]).toContain('Read the whole utterance before acting')
      // Only the first block is cached, and it is the same text as on a quick call.
      const system = params?.system
      expect(Array.isArray(system) && system[0]?.cache_control?.type).toBe('ephemeral')
      expect(Array.isArray(system) && system[1]?.cache_control).toBeUndefined()
      expect(careSettings('quick')).toEqual({ effort: 'low', maxTokens: 400, timeoutMs: 7000 })
      expect(careSettings('careful')).toEqual({ effort: 'high', maxTokens: 2000, timeoutMs: 12_000 })
    })

    it('logs the care, never the words', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}))
      const { client } = fakeClient(CLICK_LATER)
      await pageIntent(request({ care: 'careful', utterance: 'mine vaata hiljem ja siis keri alla palun' }), { client, model: 'm' })
      const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String))
      expect(logged.some((line) => /^\[intent\] kind=command done=true plan=0 care=careful ms=\d+$/.test(line))).toBe(true)
      expect(logged.join('\n')).not.toContain('vaata hiljem')
    })
  })
})

describe('round 6: saved values (26.1, 26.3)', () => {
  it('the user turn lists the saved names, or none', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    await pageIntent(request({ page: { ...YOUTUBE, saved: ['minu e-post', 'töö telefon'] } }), { client, model: 'm' })
    expect(String(calls[0]?.messages[0]?.content)).toContain('saved: "minu e-post" | "töö telefon"')
    const { client: fresh, calls: freshCalls } = fakeClient(CLICK_LATER)
    await pageIntent(request(), { client: fresh, model: 'm' })
    expect(String(freshCalls[0]?.messages[0]?.content)).toContain('saved: none')
  })

  it('an insertSaved answer with a listed name passes; an unlisted one is unclear', async () => {
    const page = { ...YOUTUBE, saved: ['minu e-post'] }
    const { client } = fakeClient(answer({ intent: { kind: 'insertSaved', name: 'minu e-post' }, say: '', done: true, plan: [] }))
    expect((await pageIntent(request({ page }), { client, model: 'm' })).intent).toEqual({ kind: 'insertSaved', name: 'minu e-post' })
    const { client: other } = fakeClient(answer({ intent: { kind: 'insertSaved', name: 'ema telefon' }, say: '', done: true, plan: [] }))
    expect((await pageIntent(request({ page }), { client: other, model: 'm' })).intent.kind).toBe('unclear')
  })

  it('the prompt explains saved values', () => {
    expect(INTENT_SYSTEM_PROMPT).toContain('# Saved values')
    expect(INTENT_SYSTEM_PROMPT).toContain('insertSaved')
  })
})

describe('round 8: media seconds (29.1)', () => {
  it('the tool schema gives media seconds, an integer from 1 to 3600 or null', () => {
    const found: Array<Record<string, unknown>> = []
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk)
      if (node === null || typeof node !== 'object') return
      const o = node as Record<string, unknown>
      const props = o.properties as Record<string, { enum?: unknown[] }> | undefined
      if (props?.kind?.enum?.[0] === 'media') found.push(o)
      for (const v of Object.values(o)) walk(v)
    }
    walk(ANSWER_TOOL.input_schema)
    expect(found).toHaveLength(1)
    const props = found[0]?.properties as Record<string, unknown>
    expect(found[0]?.required).toEqual(['kind', 'action', 'seconds'])
    expect(props.seconds).toMatchObject({ anyOf: [{ type: 'integer', minimum: 1, maximum: 3600 }, { type: 'null' }] })
  })

  it('a null seconds becomes absent; a seek by an amount passes; seconds on pause is unclear', async () => {
    const { client } = fakeClient(answer({ intent: { kind: 'command', command: { kind: 'media', action: 'forward', seconds: null } }, say: '' }))
    expect((await pageIntent(request({ utterance: 'keri edasi' }), { client, model: 'm' })).intent).toEqual({ kind: 'command', command: { kind: 'media', action: 'forward' } })
    const { client: minute } = fakeClient(answer({ intent: { kind: 'command', command: { kind: 'media', action: 'back', seconds: 120 } }, say: '' }))
    expect((await pageIntent(request({ utterance: 'keri kaks minutit tagasi' }), { client: minute, model: 'm' })).intent).toEqual({ kind: 'command', command: { kind: 'media', action: 'back', seconds: 120 } })
    const { client: wrong } = fakeClient(answer({ intent: { kind: 'command', command: { kind: 'media', action: 'pause', seconds: 30 } }, say: '' }))
    expect((await pageIntent(request({ utterance: 'paus' }), { client: wrong, model: 'm' })).intent.kind).toBe('unclear')
  })

  it('the prompt has the rules line for an amount', () => {
    expect(INTENT_SYSTEM_PROMPT).toContain('"keri edasi üks minut" forward with seconds 60')
    expect(INTENT_SYSTEM_PROMPT).toContain('"keri kaks minutit tagasi" back with seconds 120')
  })
})

// ---------- mail (29.3) ----------
describe('mail (29.3.3, 29.3.7): composeTo', () => {
  const CV: IntentRequest['page'] = {
    url: 'https://www.cv.ee/mari-maasikas',
    title: 'Mari Maasikas – CV',
    box: { present: false, text: '', armed: false, kind: 'none' },
    items: [
      { id: 1, role: 'other', text: '[pealkiri] Mari Maasikas' },
      { id: 2, role: 'link', text: 'Kirjuta mulle' },
      { id: 3, role: 'text', text: 'Projektijuht, kümme aastat kogemust' },
    ],
    media: null,
    hints: false,
    contacts: [
      { kind: 'email', value: 'mari.maasikas@example.ee', label: 'Saladus silt' },
      { kind: 'tel', value: '+37251234567', label: 'helista mulle' },
    ],
  }
  const UTTERANCE = 'võta see meiliaadress siit lehelt ja kirjuta talle, et tulen homme'
  const COMPOSE = answer({ intent: { kind: 'command', command: { kind: 'composeTo', address: 'mari.maasikas@example.ee', subject: null, body: 'Tulen homme.' } }, say: 'kirjutan Marile', done: true, plan: [] })

  it('the user turn lists the contacts as values only, never their labels', async () => {
    const { client, calls } = fakeClient(COMPOSE)
    await pageIntent(request({ page: CV, utterance: UTTERANCE, care: 'careful' }), { client, model: 'm' })
    const turn = JSON.stringify(calls[0]?.messages)
    expect(turn).toContain('contacts: e-mail mari.maasikas@example.ee, tel +37251234567')
    expect(turn).not.toContain('Saladus silt')
    expect(turn).not.toContain('helista mulle')
  })

  it('a page without contacts says none', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    await pageIntent(request(), { client, model: 'm' })
    expect(JSON.stringify(calls[0]?.messages)).toContain('contacts: none')
  })

  it('an address on the page is answered; one the model made up is unclear', async () => {
    const { client } = fakeClient(COMPOSE, answer({ intent: { kind: 'command', command: { kind: 'composeTo', address: 'keegi@muu.ee', subject: null, body: null } }, say: '', done: true, plan: [] }))
    const good = await pageIntent(request({ page: CV, utterance: UTTERANCE }), { client, model: 'm' })
    expect(good.intent).toEqual({ kind: 'command', command: { kind: 'composeTo', address: 'mari.maasikas@example.ee', body: 'Tulen homme.' } })
    const invented = await pageIntent(request({ page: CV, utterance: 'kirjuta talle meil' }), { client, model: 'm' })
    expect(invented.intent.kind).toBe('unclear')
  })

  it('logs the kind and the time for a composeTo ask, never the address, the body or the page text', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}))
    const { client } = fakeClient(COMPOSE)
    await pageIntent(request({ page: CV, utterance: UTTERANCE, care: 'careful' }), { client, model: 'm' })
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String))
    expect(logged.some((line) => /^\[intent\] kind=command done=true plan=0 care=careful ms=\d+$/.test(line))).toBe(true)
    const all = logged.join('\n')
    for (const secret of ['mari.maasikas', 'example.ee', '37251234567', 'Tulen homme', 'tulen homme', 'Projektijuht', 'Mari Maasikas', 'cv.ee', 'composeTo']) expect(all).not.toContain(secret)
  })
})
