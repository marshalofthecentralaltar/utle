import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IntentRequest } from '../src/core/pageIntent.ts'
import { STRINGS } from '../src/core/strings.ts'
import { InterpretError } from './interpret.ts'
import { INTENT_TIMEOUT_CAREFUL_MS, INTENT_TIMEOUT_MS, careSettings, pageIntent } from './intent.ts'
import { ANSWER_TOOL, CAREFUL_PROMPT, INTENT_SYSTEM_PROMPT } from './intentPrompt.ts'
import { ModelError } from './model/types.ts'
import type { Model, ModelAsk, ModelReplyNeutral } from './model/types.ts'

// Round 9 (30.5.1): pageIntent asks a provider-neutral Model; these tests pass a fake one. What the
// Anthropic adapter sends for these asks is asserted in server/model/anthropic.test.ts.

const USAGE = { input: 120, output: 45, cacheRead: 6900, cacheWrite: 0 }

function reply(overrides: Partial<ModelReplyNeutral>): ModelReplyNeutral {
  return { call: null, stop: 'text', usage: USAGE, provider: 'fake', model: 'fake-1', ms: 1, ...overrides }
}

function answer(input: unknown): ModelReplyNeutral {
  return reply({ stop: 'tool', call: { id: 'toolu_1', name: 'answer', input } })
}

function fakeClient(...queue: Array<ModelReplyNeutral | Error>): { client: Model; calls: ModelAsk[]; timeouts: number[] } {
  const calls: ModelAsk[] = []
  const timeouts: number[] = []
  const client: Model = {
    ask: async (ask) => {
      calls.push(structuredClone(ask))
      timeouts.push(ask.timeoutMs)
      const next = queue.shift()
      if (!next) throw new Error('fake model: no reply queued')
      if (next instanceof Error) throw next
      return next
    },
  }
  return { client, calls, timeouts }
}

/** The system blocks' texts, in order: the cached prefix, then the careful paragraph when there is one. */
function systemTexts(ask: ModelAsk | undefined): string[] {
  return ask ? [ask.system, ...(ask.systemExtra !== undefined ? [ask.systemExtra] : [])] : []
}

/** The answer without its usage, for the tests that compare the answer itself. */
function bare<T extends { usage?: unknown }>(value: T): Omit<T, 'usage'> {
  const { usage: _usage, ...rest } = value
  return rest
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
    const result = await pageIntent(request(), { model: client })
    expect(bare(result)).toEqual({ intent: { kind: 'command', command: { kind: 'clickItem', id: 2 } }, say: 'ava Vaata hiljem', done: true })
    expect(calls).toHaveLength(1)
  })

  it('asks for one answer tool with low effort and a short budget', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    await pageIntent(request(), { model: client })
    const params = calls[0]
    expect(params?.maxTokens).toBe(400)
    expect(params?.effort).toBe('low')
    const tools = params?.tools ?? []
    expect(tools).toHaveLength(1)
    const tool = tools[0]
    expect(tool?.name).toBe('answer')
    // Strict mode is off: the API rejects a strict tool this large ("The compiled grammar is too large").
    expect(tool?.strict).toBeFalsy()
  })

  it('sends the page as numbered items and the utterance in the user turn', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    await pageIntent(request(), { model: client })
    const text = calls[0]?.user ?? ''
    expect(text).toContain('2. [button] Vaata hiljem')
    expect(text).toContain('mine vaata hiljem')
    expect(text).toContain('armed=false')
    // The fixed prompt is the cacheable prefix (the adapter marks it: anthropic.test.ts).
    expect(calls[0]?.system).toBe(INTENT_SYSTEM_PROMPT)
    expect(calls[0]?.system).toContain('Always call the answer tool')
  })

  it('passes done through, true when the model leaves it out', async () => {
    const first = answer({ intent: { kind: 'command', command: { kind: 'goTo', url: 'https://www.youtube.com/' } }, say: 'avan youtube', done: false })
    const { client } = fakeClient(first, CLICK_LATER)
    const multi = await pageIntent(request({ utterance: 'mine youtube ja otsi kassivideod' }), { model: client })
    expect(multi.done).toBe(false)
    const single = await pageIntent(request(), { model: client })
    expect(single.done).toBe(true)
  })

  it('passes the plan through, cleaned and clipped to twelve goals, and leaves it out when empty (round 4)', async () => {
    const plan = Array.from({ length: 15 }, (_, i) => `  samm ${i + 1} `)
    const first = answer({ intent: { kind: 'command', command: { kind: 'goTo', url: 'https://www.youtube.com/' } }, say: 'lähen youtube', done: true, plan: [...plan, '', 7] })
    const { client } = fakeClient(first, CLICK_LATER)
    const chained = await pageIntent(request({ utterance: "mine youtube'i otsi kassivideod ja mängi esimene" }), { model: client })
    expect(chained.plan).toHaveLength(12)
    expect(chained.plan?.[0]).toBe('samm 1')
    expect(chained.plan?.[11]).toBe('samm 12')
    const single = await pageIntent(request(), { model: client })
    expect(bare(single)).toEqual({ intent: { kind: 'command', command: { kind: 'clickItem', id: 2 } }, say: 'ava Vaata hiljem', done: true })
    expect('plan' in single).toBe(false)
  })

  it('tells the model the chain in the user turn: what is done, the goal, what comes next (round 4)', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    const chain = { original: 'mine whatsappi, ava Karini viimane sõnum, kustuta see kõigi jaoks', completed: ['mine whatsappi'], goal: 'ava Karini viimane sõnum', remaining: ['kustuta see kõigi jaoks'] }
    await pageIntent(request({ utterance: 'ava Karini viimane sõnum', chain }), { model: client })
    const text = String(calls[0]?.user)
    expect(text).toContain('chain: 2/3')
    expect(text).toContain('chain original: "mine whatsappi, ava Karini viimane sõnum, kustuta see kõigi jaoks"')
    expect(text).toContain('chain done: "mine whatsappi"')
    expect(text).toContain('chain goal: "ava Karini viimane sõnum"')
    expect(text).toContain('chain next: "kustuta see kõigi jaoks"')
    const { client: fresh, calls: freshCalls } = fakeClient(CLICK_LATER)
    await pageIntent(request(), { model: fresh })
    expect(String(freshCalls[0]?.user)).toContain('chain: none')
  })

  it('offers hover, contextMenu and scrollTo in the tool, and the prompt says what a text item is (round 4)', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    await pageIntent(request(), { model: client })
    const tool = calls[0]?.tools?.[0]
    const kinds = JSON.stringify(tool?.schema ?? {})
    for (const kind of ['hover', 'contextMenu', 'scrollTo']) expect(kinds).toContain(`"${kind}"`)
    const systemText = systemTexts(calls[0]).join('')
    expect(systemText).toContain('Several goals in one breath')
    expect(systemText).toContain('hover')
  })

  it('lists the earlier steps in the user turn, as ok or failed lines', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    const steps = [
      { action: 'command goTo', say: 'avan youtube', ok: true, message: '' },
      { action: 'command clickItem 7', say: 'ava koerte video', ok: false, message: 'not_found' },
    ]
    await pageIntent(request({ utterance: 'mine youtube ja ava koerte video', steps }), { model: client })
    const text = String(calls[0]?.user)
    expect(text).toContain('step 1: command goTo "avan youtube" -> ok')
    expect(text).toContain('step 2: command clickItem 7 "ava koerte video" -> failed: not_found')
    const { client: fresh, calls: freshCalls } = fakeClient(CLICK_LATER)
    await pageIntent(request(), { model: fresh })
    expect(String(freshCalls[0]?.user)).toContain('steps: none')
  })

  it('keeps the answer schema closed with every property required, done among them', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    await pageIntent(request(), { model: client })
    const tool = calls[0]?.tools?.[0]
    const schema = tool?.schema as { required?: unknown; additionalProperties?: unknown } | undefined
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
    const result = await pageIntent(request(), { model: client })
    expect(bare(result)).toEqual({ intent: { kind: 'unclear', say: STRINGS.et.inpage.notUnderstood }, say: '' })
  })

  it('passes dictation through when the box is armed', async () => {
    const { client } = fakeClient(answer({ intent: { kind: 'dictate', text: 'Tulen kell viis.' }, say: '' }))
    const armed = { ...YOUTUBE, box: { present: true, text: '', armed: true, kind: 'composer' as const } }
    const result = await pageIntent(request({ utterance: 'tulen kell viis', page: armed }), { model: client })
    expect(bare(result)).toEqual({ intent: { kind: 'dictate', text: 'Tulen kell viis.' }, say: '', done: true })
  })

  it('maps a null newTab url to an absent one', async () => {
    const { client } = fakeClient(answer({ intent: { kind: 'command', command: { kind: 'newTab', url: null } }, say: 'uus leht' }))
    const result = await pageIntent(request({ utterance: 'uus leht' }), { model: client })
    expect(result.intent).toEqual({ kind: 'command', command: { kind: 'newTab' } })
  })

  it('answers unclear on a text-only reply, a refusal or max_tokens', async () => {
    const replies: ModelReplyNeutral[] = [
      reply({ stop: 'text' }),
      reply({ stop: 'refusal' }),
      reply({ stop: 'cut' }),
      // A call to a tool that is not the answer tool.
      reply({ stop: 'tool', call: { id: 't', name: 'other', input: {} } }),
    ]
    for (const reply of replies) {
      const { client, calls } = fakeClient(reply)
      const result = await pageIntent(request(), { model: client })
      expect(result.intent.kind).toBe('unclear')
      expect(calls).toHaveLength(1)
    }
  })

  it('rejects a malformed request without calling the model', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    await expect(pageIntent({ utterance: 'x' }, { model: client })).rejects.toMatchObject({ code: 'bad_request' })
    await expect(pageIntent(request({ utterance: '  ' }), { model: client })).rejects.toBeInstanceOf(InterpretError)
    expect(calls).toHaveLength(0)
  })

  it('maps the errors of the model door to codes, with no_key for a rejected key', async () => {
    const cases: Array<[Error, string, string?]> = [
      [new ModelError('timeout', 'fake', 'slow'), 'timeout'],
      [new ModelError('unreachable', 'fake', 'offline'), 'upstream_unavailable'],
      [new ModelError('busy', 'fake', 'slow down', 429), 'upstream_unavailable'],
      [new ModelError('busy', 'fake', 'boom', 500), 'upstream_unavailable'],
      [new ModelError('rejected', 'fake', 'bad', 400), 'upstream_rejected'],
      [new ModelError('no_key', 'fake', 'no key', 401), 'upstream_rejected', 'no_key'],
      [new ModelError('no_key', 'fake', 'no key', 403), 'upstream_rejected', 'no_key'],
      [new Error('a bug'), 'upstream_unavailable'],
    ]
    for (const [error, code, message] of cases) {
      const { client } = fakeClient(error)
      const expected = message ? { code, message } : { code }
      await expect(pageIntent(request(), { model: client })).rejects.toMatchObject(expected)
    }
  })

  it('never puts the key in the request', async () => {
    const before = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-secret-key'
    try {
      const { client, calls } = fakeClient(CLICK_LATER)
      await pageIntent(request(), { model: client })
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
    await pageIntent(request({ utterance: 'mine vaata hiljem palun' }), { model: client })
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String))
    expect(logged.some((line) => /^\[intent\] kind=command done=true plan=0 care=quick ms=\d+ in=120 out=45 cached=6900 provider=fake$/.test(line))).toBe(true)
    const all = logged.join('\n')
    expect(all).not.toContain('vaata hiljem')
    expect(all).not.toContain('Kassid')
    expect(all).not.toContain('youtube')
  })

  describe('care (round 5)', () => {
    it('a quick ask, or one without care, gets low effort, 400 tokens, 7 s and the one cached system block', async () => {
      const { client, calls, timeouts } = fakeClient(CLICK_LATER, CLICK_LATER)
      await pageIntent(request(), { model: client })
      await pageIntent(request({ care: 'quick' }), { model: client })
      for (const params of calls) {
        expect(params.maxTokens).toBe(400)
        expect(params.effort).toBe('low')
        expect(systemTexts(params)).toHaveLength(1)
      }
      expect(timeouts).toEqual([INTENT_TIMEOUT_MS, INTENT_TIMEOUT_MS])
      expect(INTENT_TIMEOUT_MS).toBe(7000)
    })

    it('a careful ask gets high effort, 2000 tokens, 12 s, and the careful paragraph as a second block after the unchanged cached one', async () => {
      const { client, calls, timeouts } = fakeClient(CLICK_LATER)
      await pageIntent(request({ care: 'careful', utterance: 'mine youtube ja otsi kassivideod ja mängi esimene' }), { model: client })
      const params = calls[0]
      expect(params?.maxTokens).toBe(2000)
      expect(params?.effort).toBe('high')
      expect(timeouts).toEqual([INTENT_TIMEOUT_CAREFUL_MS])
      expect(INTENT_TIMEOUT_CAREFUL_MS).toBe(12_000)
      const blocks = systemTexts(params)
      expect(blocks).toHaveLength(2)
      expect(blocks[0]).toBe(INTENT_SYSTEM_PROMPT)
      expect(blocks[1]).toBe(CAREFUL_PROMPT)
      expect(blocks[1]).toContain('Read the whole utterance before acting')
      // Only the first block is cached, and it is the same text as on a quick call.
      expect(careSettings('quick')).toEqual({ effort: 'low', maxTokens: 400, timeoutMs: 7000 })
      expect(careSettings('careful')).toEqual({ effort: 'high', maxTokens: 2000, timeoutMs: 12_000 })
    })

    it('logs the care, never the words', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}))
      const { client } = fakeClient(CLICK_LATER)
      await pageIntent(request({ care: 'careful', utterance: 'mine vaata hiljem ja siis keri alla palun' }), { model: client })
      const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String))
      expect(logged.some((line) => /^\[intent\] kind=command done=true plan=0 care=careful ms=\d+ in=120 out=45 cached=6900 provider=fake$/.test(line))).toBe(true)
      expect(logged.join('\n')).not.toContain('vaata hiljem')
    })
  })
})

describe('round 6: saved values (26.1, 26.3)', () => {
  it('the user turn lists the saved names, or none', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    await pageIntent(request({ page: { ...YOUTUBE, saved: ['minu e-post', 'töö telefon'] } }), { model: client })
    expect(String(calls[0]?.user)).toContain('saved: "minu e-post" | "töö telefon"')
    const { client: fresh, calls: freshCalls } = fakeClient(CLICK_LATER)
    await pageIntent(request(), { model: fresh })
    expect(String(freshCalls[0]?.user)).toContain('saved: none')
  })

  it('an insertSaved answer with a listed name passes; an unlisted one is unclear', async () => {
    const page = { ...YOUTUBE, saved: ['minu e-post'] }
    const { client } = fakeClient(answer({ intent: { kind: 'insertSaved', name: 'minu e-post' }, say: '', done: true, plan: [] }))
    expect((await pageIntent(request({ page }), { model: client })).intent).toEqual({ kind: 'insertSaved', name: 'minu e-post' })
    const { client: other } = fakeClient(answer({ intent: { kind: 'insertSaved', name: 'ema telefon' }, say: '', done: true, plan: [] }))
    expect((await pageIntent(request({ page }), { model: other })).intent.kind).toBe('unclear')
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
    expect((await pageIntent(request({ utterance: 'keri edasi' }), { model: client })).intent).toEqual({ kind: 'command', command: { kind: 'media', action: 'forward' } })
    const { client: minute } = fakeClient(answer({ intent: { kind: 'command', command: { kind: 'media', action: 'back', seconds: 120 } }, say: '' }))
    expect((await pageIntent(request({ utterance: 'keri kaks minutit tagasi' }), { model: minute })).intent).toEqual({ kind: 'command', command: { kind: 'media', action: 'back', seconds: 120 } })
    const { client: wrong } = fakeClient(answer({ intent: { kind: 'command', command: { kind: 'media', action: 'pause', seconds: 30 } }, say: '' }))
    expect((await pageIntent(request({ utterance: 'paus' }), { model: wrong })).intent.kind).toBe('unclear')
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
    await pageIntent(request({ page: CV, utterance: UTTERANCE, care: 'careful' }), { model: client })
    const turn = String(calls[0]?.user)
    expect(turn).toContain('contacts: e-mail mari.maasikas@example.ee, tel +37251234567')
    expect(turn).not.toContain('Saladus silt')
    expect(turn).not.toContain('helista mulle')
  })

  it('a page without contacts says none', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    await pageIntent(request(), { model: client })
    expect(String(calls[0]?.user)).toContain('contacts: none')
  })

  it('an address on the page is answered; one the model made up is unclear', async () => {
    const { client } = fakeClient(COMPOSE, answer({ intent: { kind: 'command', command: { kind: 'composeTo', address: 'keegi@muu.ee', subject: null, body: null } }, say: '', done: true, plan: [] }))
    const good = await pageIntent(request({ page: CV, utterance: UTTERANCE }), { model: client })
    expect(good.intent).toEqual({ kind: 'command', command: { kind: 'composeTo', address: 'mari.maasikas@example.ee', body: 'Tulen homme.' } })
    const invented = await pageIntent(request({ page: CV, utterance: 'kirjuta talle meil' }), { model: client })
    expect(invented.intent.kind).toBe('unclear')
  })

  it('logs the kind and the time for a composeTo ask, never the address, the body or the page text', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}))
    const { client } = fakeClient(COMPOSE)
    await pageIntent(request({ page: CV, utterance: UTTERANCE, care: 'careful' }), { model: client })
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String))
    expect(logged.some((line) => /^\[intent\] kind=command done=true plan=0 care=careful ms=\d+ in=120 out=45 cached=6900 provider=fake$/.test(line))).toBe(true)
    const all = logged.join('\n')
    for (const secret of ['mari.maasikas', 'example.ee', '37251234567', 'Tulen homme', 'tulen homme', 'Projektijuht', 'Mari Maasikas', 'cv.ee', 'composeTo']) expect(all).not.toContain(secret)
  })
})
// ---------- wake word and places (29.4) ----------
describe('round 8: my places (29.4.2)', () => {
  it('places: the user turn lists the nouns, never an address, or none', async () => {
    const { client, calls } = fakeClient(CLICK_LATER)
    await pageIntent(request({ page: { ...YOUTUBE, places: ['uudised', 'raadio', 'ilm'] } }), { model: client })
    const turn = String(calls[0]?.user)
    expect(turn).toContain('places: "uudised" | "raadio" | "ilm"')
    expect(turn).not.toContain('postimees.ee')
    const { client: fresh, calls: freshCalls } = fakeClient(CLICK_LATER)
    await pageIntent(request(), { model: fresh })
    expect(String(freshCalls[0]?.user)).toContain('places: none')
    expect(INTENT_SYSTEM_PROMPT).toContain('# My places')
  })

  it('places: a place answer with a listed noun passes; an unlisted noun or an address is unclear', async () => {
    const page = { ...YOUTUBE, places: ['uudised', 'raadio'] }
    const { client } = fakeClient(answer({ intent: { kind: 'place', noun: 'uudised' }, say: 'avan uudised', done: true, plan: [] }))
    expect((await pageIntent(request({ page, utterance: 'vaata uudiseid' }), { model: client })).intent).toEqual({ kind: 'place', noun: 'uudised' })
    const { client: other } = fakeClient(answer({ intent: { kind: 'place', noun: 'pank' }, say: '', done: true, plan: [] }))
    expect((await pageIntent(request({ page }), { model: other })).intent.kind).toBe('unclear')
    const { client: address } = fakeClient(answer({ intent: { kind: 'place', noun: 'https://www.postimees.ee/' }, say: '', done: true, plan: [] }))
    expect((await pageIntent(request({ page }), { model: address })).intent.kind).toBe('unclear')
  })
})
// ---------- end of wake word and places ----------
// ---------- reading aloud (29.5) ----------
describe('reading aloud (29.5): the model may answer read', () => {
  it('read: the tool schema has read with what page, box, selection, continue or stop', () => {
    const found: Array<Record<string, unknown>> = []
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk)
      if (node === null || typeof node !== 'object') return
      const o = node as Record<string, unknown>
      const props = o.properties as Record<string, { enum?: unknown[] }> | undefined
      if (props?.kind?.enum?.[0] === 'read') found.push(o)
      for (const v of Object.values(o)) walk(v)
    }
    walk(ANSWER_TOOL.input_schema)
    expect(found).toHaveLength(1)
    expect(found[0]?.required).toEqual(['kind', 'what'])
    const props = found[0]?.properties as Record<string, unknown> | undefined
    expect(props?.what).toEqual({ type: 'string', enum: ['page', 'box', 'selection', 'continue', 'stop'] })
  })

  it('read: an answer of read page passes; an unknown what is unclear', async () => {
    const { client } = fakeClient(answer({ intent: { kind: 'command', command: { kind: 'read', what: 'page' } }, say: '' }))
    expect((await pageIntent(request({ utterance: 'loe mulle seda lehte' }), { model: client })).intent).toEqual({ kind: 'command', command: { kind: 'read', what: 'page' } })
    const { client: wrong } = fakeClient(answer({ intent: { kind: 'command', command: { kind: 'read', what: 'all' } }, say: '' }))
    expect((await pageIntent(request({ utterance: 'loe kõik' }), { model: wrong })).intent.kind).toBe('unclear')
  })

  it('read: the prompt has the rules line', () => {
    expect(INTENT_SYSTEM_PROMPT).toContain('"loe ette", "loe mulle seda lehte", "ma ei näe, loe": read page')
    expect(INTENT_SYSTEM_PROMPT).toContain('"loe see ette" with an armed box: read box')
  })
})

describe('round 9 (30.5.3): usage and the provider', () => {
  it('usage: the answer carries the tokens of the ask and who answered, an unclear one too', async () => {
    const { client } = fakeClient(CLICK_LATER, reply({ stop: 'text' }))
    expect((await pageIntent(request(), { model: client })).usage).toEqual({ ...USAGE, provider: 'fake', model: 'fake-1' })
    const unclearAnswer = await pageIntent(request(), { model: client })
    expect(unclearAnswer.intent.kind).toBe('unclear')
    expect(unclearAnswer.usage).toEqual({ ...USAGE, provider: 'fake', model: 'fake-1' })
  })

  it('usage: in= counts the tokens not read from the cache (full price and cache writes)', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}))
    const { client } = fakeClient(reply({ stop: 'tool', call: { id: 't', name: 'answer', input: { intent: { kind: 'unclear', say: '' }, say: '' } }, usage: { input: 10, output: 3, cacheRead: 0, cacheWrite: 7000 }, provider: 'deepseek' }))
    await pageIntent(request(), { model: client })
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String))
    expect(logged.some((line) => /^\[intent\] kind=unclear done=true plan=0 care=quick ms=\d+ in=7010 out=3 cached=0 provider=deepseek$/.test(line))).toBe(true)
  })

  it('usage: an error line names the provider, never words', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}))
    const { client } = fakeClient(new ModelError('busy', 'deepseek', 'busy', 503))
    await expect(pageIntent(request({ utterance: 'mine vaata hiljem palun' }), { model: client })).rejects.toMatchObject({ code: 'upstream_unavailable' })
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String))
    expect(logged.some((line) => /^\[intent\] error=upstream_unavailable care=quick ms=\d+ provider=deepseek$/.test(line))).toBe(true)
    expect(logged.join('\n')).not.toContain('vaata hiljem')
  })
})

describe('round 9 (30.5.6): the shapes of the default model', () => {
  const PLACES = { ...YOUTUBE, places: ['uudised', 'raadio'] }
  const SAVED = { ...YOUTUBE, box: { present: true, text: '', armed: true, kind: 'field' as const }, saved: ['minu e-post'] }

  it('a place wrapped as a command is lifted out and validated', async () => {
    const { client } = fakeClient(answer({ intent: { kind: 'command', command: { kind: 'place', noun: 'uudised' } }, say: 'avan uudised', done: true, plan: [] }))
    expect((await pageIntent(request({ page: PLACES, utterance: 'vaata uudiseid' }), { model: client })).intent).toEqual({ kind: 'place', noun: 'uudised' })
  })

  it('an insertSaved wrapped as a command is lifted out and validated', async () => {
    const { client } = fakeClient(answer({ intent: { kind: 'command', command: { kind: 'insertSaved', name: 'minu e-post' } }, say: '', done: true, plan: [] }))
    expect((await pageIntent(request({ page: SAVED, utterance: 'pane mu email sinna' }), { model: client })).intent).toEqual({ kind: 'insertSaved', name: 'minu e-post' })
  })

  it('a lifted shape is still held to the page: an unlisted noun or name is unclear, and extra fields are dropped', async () => {
    const { client } = fakeClient(
      answer({ intent: { kind: 'command', command: { kind: 'place', noun: 'pank' } }, say: '', done: true, plan: [] }),
      answer({ intent: { kind: 'command', command: { kind: 'insertSaved', name: 'ema telefon' } }, say: '', done: true, plan: [] }),
      answer({ intent: { kind: 'command', command: { kind: 'place', noun: 'raadio', url: 'https://evil.example/' } }, say: '', done: true, plan: [] }),
    )
    expect((await pageIntent(request({ page: PLACES }), { model: client })).intent.kind).toBe('unclear')
    expect((await pageIntent(request({ page: SAVED }), { model: client })).intent.kind).toBe('unclear')
    expect((await pageIntent(request({ page: PLACES }), { model: client })).intent).toEqual({ kind: 'place', noun: 'raadio' })
  })

  it('no other kind is lifted: a wrapped dictate or unclear stays invalid', async () => {
    const armed = { ...YOUTUBE, box: { present: true, text: '', armed: true, kind: 'composer' as const } }
    const { client } = fakeClient(
      answer({ intent: { kind: 'command', command: { kind: 'dictate', text: 'tulen' } }, say: '', done: true, plan: [] }),
      answer({ intent: { kind: 'command', command: { kind: 'send' } }, say: '', done: true, plan: [] }),
    )
    expect((await pageIntent(request({ page: armed, utterance: 'tulen' }), { model: client })).intent.kind).toBe('unclear')
    expect((await pageIntent(request({ page: armed, utterance: 'saada' }), { model: client })).intent.kind).toBe('unclear')
  })

  it('the identical click after it failed is answered unclear; another id, or after a success, passes', async () => {
    const failed = [{ action: 'command clickItem 2', say: 'ava Vaata hiljem', ok: false, message: 'not_found' }]
    const passed = [{ action: 'command clickItem 2', say: 'ava Vaata hiljem', ok: true, message: '' }]
    const { client } = fakeClient(CLICK_LATER, answer({ intent: { kind: 'command', command: { kind: 'clickItem', id: 4 } }, say: '', done: true, plan: [] }), CLICK_LATER)
    expect((await pageIntent(request({ steps: failed }), { model: client })).intent.kind).toBe('unclear')
    expect((await pageIntent(request({ steps: failed }), { model: client })).intent).toEqual({ kind: 'command', command: { kind: 'clickItem', id: 4 } })
    expect((await pageIntent(request({ steps: passed }), { model: client })).intent).toEqual({ kind: 'command', command: { kind: 'clickItem', id: 2 } })
  })
})
