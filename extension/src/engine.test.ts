import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoxState, BrowserCommand, BrowserResult, PageContext } from '../../src/browser/protocol.ts'
import type { IntentAnswer, IntentRequest, TabSummary } from '../../src/core/pageIntent.ts'
import { pageIntentFrom } from '../../src/core/pageIntent.ts'
import { applyIntent, initialInpage, inpageInstant, inpagePreview, inpageResult, inpageStep } from '../../src/core/inpage.ts'
import type { SavedItem } from '../../src/core/saved.ts'
import type { SpendRecord } from '../../src/core/spend.ts'
import { STRINGS } from '../../src/core/strings.ts'
import { ASK_TIMEOUT_CAREFUL_MS, ASK_TIMEOUT_MS, BUSY_FROM_S, CAREFUL_WORDS, COMMAND_TIMEOUT_MS, ENROL_TIMEOUT_FACTOR, INTENT_LOOP_BUDGET_MS, JOB_WATCHDOG_MS, LAG_SHOWN_MS, LONG_COMMAND_WORDS, LONG_UTTERANCE_WORDS, MAX_STEP_FAILURES, PLACE_ASK_MS, SEND_PROBE_BOX, SETTLE_MS, STALE_MS, askTimeoutMs, createEngine } from './engine.ts'
import { MAX_CHAIN_MS, MAX_CHAIN_STEPS, MAX_INTENT_STEPS } from '../../src/core/pageIntent.ts'
import type { AskFailure, EngineHandlers, InpageLogic } from './engine.ts'
import type { StripState } from './messages.ts'
import { SPEAKER_REASONS, verdictFor } from '../../src/speech/asrProtocol.ts'
import type { SpeakerDecision, SpeakerReason } from '../../src/speech/asrProtocol.ts'

const logic: InpageLogic = {
  initialInpage: (lang) => ({ lang, asleep: false, hints: false, undo: [] }),
  inpageStep: (session, utterance, box) => {
    if (utterance === 'kaks') return { session, commands: [{ kind: 'setText', text: 'a' }, { kind: 'pressSend' }], line: 'kaks' }
    if (utterance === 'vaikus') return { session, commands: [], line: 'midagi' }
    if (utterance === 'saada') return { session, commands: [{ kind: 'pressSend' }], line: 'saadan' }
    // Round 5: the global cancel, and a page command the rules know (for the command timeout).
    if (utterance === 'katkesta') return { session, commands: [], line: STRINGS.et.inpage.cancelled, cancel: true }
    if (utterance === 'mine') return { session, commands: [{ kind: 'goTo', url: 'https://a.ee/' }], line: 'lähen' }
    return { session, commands: [{ kind: 'setText', text: `${box.text}${utterance}` }], line: 'kirjutan' }
  },
  inpageResult: (session, _commands, result) => ({ session, line: result.ok ? 'tehtud' : `viga: ${result.message}` }),
  inpageInstant: (_session, utterance) => utterance === 'saada',
  inpagePreview: () => null,
  applyIntent: (session, intent, page, say = '') => {
    const prefix = say === '' ? '' : `${say}: `
    switch (intent.kind) {
      case 'dictate':
        return { session, commands: [{ kind: 'setText', text: `${page.box.text}${intent.text}` }], line: `${prefix}mudel kirjutab` }
      case 'command':
        return { session, commands: [intent.command], line: `${prefix}teen` }
      case 'send':
        return { session, commands: [{ kind: 'pressSend' }], line: `${prefix}saadan` }
      case 'unclear':
        return { session, commands: [], line: intent.say || 'ei saanud aru' }
      default:
        return { session, commands: [], line: `${prefix}${intent.kind}` }
    }
  },
  pageIntentFrom,
}

/** Like the real core: dictation carries ask, so the engine consults the model. */
const asking: InpageLogic = {
  ...logic,
  inpageStep: (session, utterance, box) => {
    const step = logic.inpageStep(session, utterance, box)
    return step.commands[0]?.kind === 'setText' && utterance !== 'kaks' ? { ...step, ask: true } : step
  },
}

/** Like the stand-in: null while the words may be "saada", else the box text, a space, the partial. */
const previewing: InpageLogic = {
  ...logic,
  inpagePreview: (_session, partial, box) => {
    if (!box.present) return null
    if ('saada'.startsWith(partial)) return null
    return box.text === '' ? partial : `${box.text} ${partial}`
  },
}

interface Options {
  answers?: (command: BrowserCommand) => BrowserResult
  logic?: InpageLogic
  /** The box before anything is typed. */
  box?: BoxState
  /** How long the page takes to answer a setText. */
  setTextMs?: number
  /** How long the page takes to answer a goTo. */
  goToMs?: number
  /** The model's answer. Default: unreachable. signal: aborted when the engine gives the question up (round 3). */
  ask?: (request: IntentRequest, signal: AbortSignal) => Promise<IntentAnswer | AskFailure>
  /** The page's readPage answer. Default: the box, three items, no media. */
  page?: (box: BoxState) => PageContext
  tabs?: TabSummary[]
  status?: 'live' | 'no_key' | 'bad_token' | 'unreachable'
  /** Round 8 (29.4.1): wake mode with this word. */
  wakeWord?: string
  /** Round 9 (30.1): the server's address is hosted (wss://, or another host). */
  hosted?: boolean
  /** Issue #3 (B): Kuula ainult mind is on: nothing speech-driven runs without a verified owner decision. */
  onlyOwner?: boolean
}

const ITEMS = [
  { id: 1, role: 'link', text: 'Avaleht' },
  { id: 2, role: 'button', text: 'Otsi' },
  { id: 3, role: 'link', text: 'Vaata hiljem' },
]
const TABS: TabSummary[] = [
  { index: 1, title: 'YouTube', active: true },
  { index: 2, title: 'WhatsApp', active: false },
]
const answer = (intent: IntentAnswer['intent'], say = '', done?: boolean): IntentAnswer => (done === undefined ? { intent, say } : { intent, say, done })
const SENTENCE = 'ma jõuan homme kella kolmeks sinna kui buss õigel ajal tuleb ja keegi mind ära ei pea'

function setup(options: Options = {}) {
  const answers = options.answers ?? (() => ({ ok: true }))
  let handlers: EngineHandlers | null = null
  let unavailable: (() => void) | null = null
  let instant: ((text: string) => boolean) | null = null
  const ran: BrowserCommand[] = []
  const state: Partial<StripState> = {}
  const heard: string[] = []
  const boxes: BoxState[] = []
  let page: BoxState = options.box ?? { present: true, text: 'x', armed: true }
  let inFlight = 0
  let maxInFlight = 0
  let blocked = 0
  let starts = 0
  const asked: IntentRequest[] = []
  const signals: AbortSignal[] = []
  const lags: number[] = []
  const thinking: boolean[] = []
  const modelProblems: string[] = []
  const chains: string[] = []
  const busy: number[] = []
  const enrols: number[] = []
  // Round 9 (30.1): every problem and line published, and every connection state.
  const problems: string[] = []
  const lines: string[] = []
  const connections: string[] = []
  const spends: SpendRecord[] = []
  const used = options.logic ?? logic
  const engine = createEngine({
    logic: {
      ...used,
      inpageStep: (session, utterance, box) => {
        // The engine probes the rules with SEND_PROBE_BOX to tell a plain send: not a box it read.
        if (box !== SEND_PROBE_BOX) boxes.push(box)
        return used.inpageStep(session, utterance, box)
      },
    },
    lang: 'et',
    run: async (command) => {
      ran.push(command)
      if (command.kind === 'readBox') return { ok: true, box: { ...page } }
      if (command.kind === 'readPage') {
        const told = answers(command)
        if (!told.ok) return told
        const built = options.page ? options.page({ ...page }) : { url: 'https://www.youtube.com/', title: 'YouTube', box: { ...page }, items: ITEMS, media: null, hints: false }
        return { ok: true, page: built }
      }
      if (command.kind === 'goTo' && options.goToMs) await new Promise((resolve) => setTimeout(resolve, options.goToMs))
      if (command.kind === 'setText') {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        if (options.setTextMs) await new Promise((resolve) => setTimeout(resolve, options.setTextMs))
        inFlight -= 1
        page = { present: page.present, text: command.text, armed: page.armed }
      }
      return answers(command)
    },
    publish: (patch) => {
      if (patch.heard !== undefined) heard.push(patch.heard)
      if (patch.thinking !== undefined) thinking.push(patch.thinking)
      if (patch.modelProblem !== undefined) modelProblems.push(patch.modelProblem)
      if (patch.lag !== undefined) lags.push(patch.lag)
      if (patch.chain !== undefined) chains.push(patch.chain)
      if (patch.busySeconds !== undefined) busy.push(patch.busySeconds)
      if (patch.problem !== undefined) problems.push(patch.problem)
      if (patch.line !== undefined) lines.push(patch.line)
      if (patch.connection !== undefined) connections.push(patch.connection)
      Object.assign(state, patch)
    },
    recognizer: (h, isInstant, onUnavailable) => {
      handlers = h
      instant = isInstant
      unavailable = onUnavailable
      return { supported: true, start: () => starts++, stop: () => undefined, setLang: () => undefined, enrol: (seconds) => enrols.push(seconds) }
    },
    micBlocked: () => blocked++,
    ask: (request, signal) => {
      asked.push(request)
      signals.push(signal)
      return options.ask ? options.ask(request, signal) : Promise.resolve({ error: 'unreachable' })
    },
    tabs: () => Promise.resolve(options.tabs ?? TABS),
    status: () => Promise.resolve(options.status ?? 'live'),
    ...(options.wakeWord === undefined ? {} : { wakeWord: options.wakeWord }),
    ...(options.hosted === undefined ? {} : { hosted: options.hosted }),
    ...(options.onlyOwner === undefined ? {} : { onlyOwner: options.onlyOwner }),
    spend: (record) => spends.push(record),
  })
  const say = (text: string): void => handlers?.onUtterance(text)
  /** Round 4: the recogniser continues the last utterance ("siis ..."). */
  const continued = (text: string, added: string): void => handlers?.onUtteranceContinued(text, added)
  /** Round 4 (review): the recogniser dropped someone else's final; the server answered an enrolment. */
  const foreign = (): void => handlers?.onForeign()
  const enrolled = (ok: boolean): void => handlers?.onEnrolled(ok, 8)
  const partial = (text: string): void => handlers?.onInterim(text)
  const lag = (ms: number): void => handlers?.onLag(ms)
  /** The page changes the box on its own (the site, or a click with the eye tracker). */
  const edit = (text: string): void => {
    page = { ...page, text }
  }
  return {
    engine,
    ran,
    state,
    heard,
    boxes,
    say,
    continued,
    partial,
    lag,
    edit,
    page: () => page,
    maxInFlight: () => maxInFlight,
    unavailable: () => unavailable?.(),
    error: () => handlers?.onError('x'),
    instant: (t: string) => instant?.(t),
    blocked: () => blocked,
    starts: () => starts,
    asked,
    signals,
    lags,
    thinking,
    modelProblems,
    chains,
    busy,
    enrols,
    foreign,
    enrolled,
    problems,
    lines,
    connections,
    connection: (s: 'connecting' | 'connected' | 'down'): void => handlers?.onConnection?.(s),
    spends,
    /** Round 10: the handlers the engine gave the recogniser, to call with a decision. */
    handlers: () => handlers,
  }
}

const texts = (ran: BrowserCommand[]): string[] => ran.flatMap((c) => (c.kind === 'setText' ? [c.text] : c.kind === 'readBox' ? [] : [c.kind]))

afterEach(() => {
  vi.useRealTimers()
})

describe('the in-page engine', () => {
  it('reads the box, runs the step and shows the result line', async () => {
    const t = setup()
    t.engine.toggle()
    expect(t.state.listening).toBe(true)
    t.say('tere')
    await t.engine.idle()
    expect(t.ran).toEqual([{ kind: 'readBox' }, { kind: 'setText', text: 'xtere' }])
    expect(t.state.heard).toBe('tere')
    expect(t.state.line).toBe('tehtud')
  })

  it('stops at the first failing command and reports it', async () => {
    const t = setup({ answers: (c) => (c.kind === 'setText' ? { ok: false, code: 'not_found', message: 'no box' } : { ok: true }) })
    t.engine.start()
    t.say('kaks')
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'setText'])
    expect(t.state.line).toBe('viga: no box')
  })

  it('handles utterances one at a time, in order', async () => {
    const t = setup()
    t.engine.start()
    t.say('a')
    t.say('b')
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'setText', 'readBox', 'setText'])
  })

  it('keeps the step line when there is nothing to run', async () => {
    const t = setup()
    t.engine.start()
    t.say('vaikus')
    await t.engine.idle()
    expect(t.state.line).toBe('midagi')
  })

  it('says plainly when the speech model is unreachable, and tries again on the next toggle', () => {
    const t = setup()
    t.engine.toggle()
    t.unavailable()
    expect(t.state.listening).toBe(false)
    expect(t.state.problem).toBe(STRINGS.et.strip.modelUnreachable)
    t.engine.toggle()
    expect(t.starts()).toBe(2)
    expect(t.state.problem).toBe('')
  })

  it('asks for the microphone when it is refused', () => {
    const t = setup()
    t.engine.start()
    t.error()
    expect(t.blocked()).toBe(1)
    expect(t.state.problem).toBe(STRINGS.et.strip.micBlocked)
  })

  it('uses inpageInstant as the recogniser isInstant', () => {
    const t = setup()
    expect(t.instant('saada')).toBe(true)
    expect(t.instant('tere')).toBe(false)
  })
})

describe('live dictation (21.3)', () => {
  it('types each preview into the box while he speaks, reading the box once', async () => {
    const t = setup({ logic: previewing, box: { present: true, text: 'Tere.', armed: true } })
    t.engine.start()
    t.partial('ma')
    await t.engine.idle()
    t.partial('ma jõuan')
    await t.engine.idle()
    expect(t.ran).toEqual([
      { kind: 'readBox' },
      { kind: 'setText', text: 'Tere. ma' },
      { kind: 'setText', text: 'Tere. ma jõuan' },
    ])
    expect(t.page().text).toBe('Tere. ma jõuan')
  })

  it('gives inpageStep the base, not the box with the preview in it', async () => {
    const t = setup({ logic: previewing, box: { present: true, text: 'Tere.', armed: true } })
    t.engine.start()
    t.partial('ma')
    t.partial('ma jõuan')
    await t.engine.idle()
    t.say('ma jõuan')
    await t.engine.idle()
    expect(t.boxes).toEqual([{ present: true, text: 'Tere.', armed: true }])
    expect(t.ran.filter((c) => c.kind === 'readBox')).toHaveLength(1)
    expect(t.page().text).toBe('Tere.ma jõuan')
  })

  it('takes back a preview that turns into a possible command, then runs the command', async () => {
    const t = setup({ logic: previewing, box: { present: true, text: 'Tere.', armed: true } })
    t.engine.start()
    t.partial('saadan')
    await t.engine.idle()
    t.partial('saa')
    await t.engine.idle()
    t.say('saada')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['Tere. saadan', 'Tere.', 'pressSend'])
  })

  it('a command final with a preview still in the box puts the base back before the command', async () => {
    const t = setup({ logic: previewing, box: { present: true, text: 'Tere.', armed: true } })
    t.engine.start()
    t.partial('tere')
    await t.engine.idle()
    t.say('saada')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['Tere. tere', 'Tere.', 'pressSend'])
  })

  it('a possible command is never typed', async () => {
    const t = setup({ logic: previewing, box: { present: true, text: '', armed: true } })
    t.engine.start()
    t.partial('s')
    t.partial('saa')
    t.partial('saada')
    await t.engine.idle()
    t.say('saada')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['pressSend'])
    expect(t.heard).toEqual(['s', 'saa', 'saada', 'saada'])
  })

  it('stopping in the middle of an utterance puts the base back', async () => {
    const t = setup({ logic: previewing, box: { present: true, text: 'Tere.', armed: true } })
    t.engine.start()
    t.partial('ma jõu')
    await t.engine.idle()
    t.engine.stop()
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['Tere. ma jõu', 'Tere.'])
    expect(t.page().text).toBe('Tere.')
  })

  it('with a slow page, only the newest preview is typed and never two at once', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: previewing, box: { present: true, text: '', armed: true }, setTextMs: 500 })
    t.engine.start()
    t.partial('ma')
    await vi.advanceTimersByTimeAsync(100)
    t.partial('ma jõuan')
    await vi.advanceTimersByTimeAsync(100)
    t.partial('ma jõuan homme')
    await vi.advanceTimersByTimeAsync(100)
    t.partial('ma jõuan homme kell')
    await vi.advanceTimersByTimeAsync(2000)
    expect(texts(t.ran)).toEqual(['ma', 'ma jõuan homme kell'])
    expect(t.maxInFlight()).toBe(1)
    t.say('ma jõuan homme kell kolm')
    await vi.advanceTimersByTimeAsync(1000)
    expect(texts(t.ran)).toEqual(['ma', 'ma jõuan homme kell', 'ma jõuan homme kell kolm'])
    expect(t.maxInFlight()).toBe(1)
  })

  it('the final waits for the preview in flight before its own setText', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: previewing, box: { present: true, text: '', armed: true }, setTextMs: 500 })
    t.engine.start()
    t.partial('ma jõuan')
    await vi.advanceTimersByTimeAsync(10)
    t.say('ma jõuan')
    await vi.advanceTimersByTimeAsync(2000)
    expect(texts(t.ran)).toEqual(['ma jõuan', 'ma jõuan'])
    expect(t.maxInFlight()).toBe(1)
  })

  it('types nothing without a box, but the strip shows every partial', async () => {
    const t = setup({ logic: previewing, box: { present: false, text: '', armed: false } })
    t.engine.start()
    t.partial('tere')
    t.partial('tere mari')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual([])
    expect(t.heard).toEqual(['tere', 'tere mari'])
  })

  it('the next utterance reads its base after the previous one has been typed', async () => {
    const t = setup({ logic: previewing, box: { present: true, text: '', armed: true } })
    t.engine.start()
    t.partial('üks')
    t.say('üks')
    t.partial('kaks')
    await t.engine.idle()
    t.say('kaks')
    await t.engine.idle()
    expect(t.boxes).toEqual([
      { present: true, text: '', armed: true },
      { present: true, text: 'üks', armed: true },
    ])
  })
})

describe('understanding by meaning (M7)', () => {
  const armed: BoxState = { present: true, text: 'Tere.', armed: true }

  // M7.2: a short dictation into an armed box is typed first and verified after (the "type-first"
  // tests below). The box as the model sees it is the base: the box before the words.
  it('types a short dictation into an armed box at once, then asks the model; a command takes the words back and runs', async () => {
    const t = setup({ logic: asking, box: armed, ask: () => Promise.resolve(answer({ kind: 'command', command: { kind: 'clickItem', id: 3 } }, 'vaata hiljem')) })
    t.engine.start()
    t.say('pane vaata hiljem')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['Tere.pane vaata hiljem', 'readPage', 'Tere.', 'clickItem'])
    expect(t.thinking).toEqual([true, false])
    expect(t.asked).toHaveLength(1)
    expect(t.asked[0]).toMatchObject({ lang: 'et', utterance: 'pane vaata hiljem', tabs: TABS, recent: [] })
    expect(t.asked[0]?.steps).toBeUndefined()
    expect(t.asked[0]?.page.items).toEqual(ITEMS)
    expect(t.asked[0]?.page.box.text).toBe('Tere.')
    expect(t.page().text).toBe('Tere.')
    expect(t.state.line).toBe('tehtud')
    expect(t.state.modelProblem).toBe('')
  })

  it('type-first: the model saying dictation leaves the typed words alone, with no second setText', async () => {
    const t = setup({ logic: asking, box: armed, ask: () => Promise.resolve(answer({ kind: 'dictate', text: 'tulen' })) })
    t.engine.start()
    t.say('tulen')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['Tere.tulen', 'readPage'])
    expect(t.page().text).toBe('Tere.tulen')
    expect(t.state.line).toBe('tehtud')
    expect(t.state.thinking).toBe(false)
  })

  it('type-first: the model saying unclear leaves the typed words and the line alone', async () => {
    const t = setup({ logic: asking, box: armed, ask: () => Promise.resolve(answer({ kind: 'unclear', say: 'Mida?' })) })
    t.engine.start()
    t.say('hm')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['Tere.hm', 'readPage'])
    expect(t.state.line).toBe('tehtud')
  })

  it('type-first: the typed words are already there and the line already says so while the model thinks', async () => {
    let seenLine = ''
    let seenThinking = false
    let seenText = ''
    const t = setup({
      logic: asking,
      box: armed,
      ask: () => {
        seenLine = t.state.line ?? ''
        seenThinking = t.state.thinking ?? false
        seenText = t.page().text
        return Promise.resolve(answer({ kind: 'dictate', text: 'tere' }))
      },
    })
    t.engine.start()
    t.say('tere')
    await t.engine.idle()
    expect(seenLine).toBe('tehtud')
    expect(seenThinking).toBe(true)
    expect(seenText).toBe('Tere.tere')
  })

  it('type-first: a send arriving while the model still verifies waits, and sends the base, never the typed words', async () => {
    vi.useFakeTimers()
    const t = setup({
      logic: asking,
      box: armed,
      ask: () => new Promise((resolve) => setTimeout(() => resolve(answer({ kind: 'command', command: { kind: 'scroll', direction: 'down' } })), 1000)),
    })
    t.engine.start()
    t.say('keri alla palun')
    await vi.advanceTimersByTimeAsync(50)
    t.say('saada')
    await vi.advanceTimersByTimeAsync(40)
    // The send has not run: the utterance before it is still being verified.
    expect(texts(t.ran)).toEqual(['Tere.keri alla palun', 'readPage'])
    await vi.advanceTimersByTimeAsync(2000)
    expect(texts(t.ran)).toEqual(['Tere.keri alla palun', 'readPage', 'Tere.', 'scroll', 'pressSend'])
    expect(t.boxes.map((b) => b.text)).toEqual(['Tere.', 'Tere.'])
  })

  it('type-first: the session is the one from before the typing when the model answers a command', async () => {
    const seen: string[][] = []
    const withUndo: InpageLogic = {
      ...asking,
      inpageStep: (session, utterance, box) => {
        const step = asking.inpageStep(session, utterance, box)
        return step.ask ? { ...step, session: { ...session, undo: [...session.undo, box.text] } } : step
      },
      applyIntent: (session, intent, page, say) => {
        seen.push(session.undo)
        return asking.applyIntent(session, intent, page, say)
      },
    }
    const t = setup({ logic: withUndo, box: armed, ask: () => Promise.resolve(answer({ kind: 'command', command: { kind: 'scroll', direction: 'down' } })) })
    t.engine.start()
    t.say('keri alla palun')
    await t.engine.idle()
    expect(seen).toEqual([[]])
  })

  it('wait-first: with no armed box, shows the thinking line and waits for the model', async () => {
    let seen = ''
    const t = setup({
      logic: asking,
      box: { present: true, text: '', armed: false },
      ask: () => {
        seen = t.state.line ?? ''
        return Promise.resolve(answer({ kind: 'unclear', say: 'Mida?' }))
      },
    })
    t.engine.start()
    t.say('hm')
    await t.engine.idle()
    expect(seen).toBe(STRINGS.et.inpage.thinking)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage'])
    expect(t.state.thinking).toBe(false)
    expect(t.state.line).toBe('Mida?')
  })

  it('does not ask about a long utterance into an armed box: that is a sentence', async () => {
    const t = setup({ logic: asking, box: armed })
    t.engine.start()
    // Round 4: the limit is high (a chain of commands can be long), so a very long sentence is built here.
    const long = Array.from({ length: LONG_UTTERANCE_WORDS + 1 }, (_, i) => (i % 2 ? 'homme' : 'tulen')).join(' ')
    expect(long.split(' ').length).toBeGreaterThanOrEqual(LONG_UTTERANCE_WORDS)
    t.say(long)
    await t.engine.idle()
    expect(t.asked).toHaveLength(0)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'setText'])
    expect(t.thinking).toEqual([])
  })

  it('asks about an utterance of thirteen words into an armed box, after typing it', async () => {
    const t = setup({ logic: asking, box: armed, ask: () => Promise.resolve(answer({ kind: 'dictate', text: 'x' })) })
    t.engine.start()
    const thirteen = SENTENCE.split(' ').slice(0, LONG_UTTERANCE_WORDS - 1).join(' ')
    t.say(thirteen)
    await t.engine.idle()
    expect(t.asked).toHaveLength(1)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'setText', 'readPage'])
  })

  it('asks about a long utterance when the box is not armed', async () => {
    const t = setup({ logic: asking, box: { present: true, text: '', armed: false }, ask: () => Promise.resolve(answer({ kind: 'command', command: { kind: 'scroll', direction: 'down' } })) })
    t.engine.start()
    t.say(SENTENCE)
    await t.engine.idle()
    expect(t.asked).toHaveLength(1)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'scroll'])
  })

  it('does not ask about a command the rules recognised', async () => {
    const t = setup({ logic: asking, box: armed })
    t.engine.start()
    t.say('saada')
    await t.engine.idle()
    expect(t.asked).toHaveLength(0)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'pressSend'])
  })

  it('without a model, the rules\' step runs and the strip says the understanding is off, once', async () => {
    const t = setup({ logic: asking, box: armed, ask: () => Promise.resolve({ error: 'no_model' }) })
    t.engine.start()
    t.say('tere')
    await t.engine.idle()
    t.say('tere')
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'setText', 'readPage', 'readBox', 'setText', 'readPage'])
    expect(t.state.modelProblem).toBe(STRINGS.et.inpage.modelOff)
    expect(t.modelProblems).toEqual(['', STRINGS.et.inpage.modelOff])
    expect(t.thinking).toEqual([true, false, true, false])
  })

  it('when the server cannot be reached, the rules\' step runs silently', async () => {
    const t = setup({ logic: asking, box: armed, ask: () => Promise.resolve({ error: 'unreachable' }) })
    t.engine.start()
    t.say('tere')
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'setText', 'readPage'])
    expect(t.state.line).toBe('tehtud')
    expect(t.state.modelProblem).toBe('')
    expect(t.state.thinking).toBe(false)
  })

  it('a bad answer falls back to the rules\' step', async () => {
    const t = setup({ logic: asking, box: armed, ask: () => Promise.resolve({ error: 'bad' }) })
    t.engine.start()
    t.say('tere')
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'setText', 'readPage'])
    expect(t.page().text).toBe('Tere.tere')
  })

  it('an answer about an item the page does not have is not understood', async () => {
    const t = setup({ logic: asking, box: { present: true, text: '', armed: false }, ask: () => Promise.resolve(answer({ kind: 'command', command: { kind: 'clickItem', id: 99 } })) })
    t.engine.start()
    t.say('vajuta sinna')
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage'])
    expect(t.state.line).toBe('ei saanud aru')
  })

  it('gives up on the model after the timeout and keeps the typed words', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: armed, ask: () => new Promise(() => undefined) })
    t.engine.start()
    t.say('tere')
    await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_MS - 1)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'setText', 'readPage'])
    expect(t.state.thinking).toBe(true)
    await vi.advanceTimersByTimeAsync(2)
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'setText', 'readPage'])
    expect(t.page().text).toBe('Tere.tere')
    expect(t.state.thinking).toBe(false)
  })

  it('gives up on the model after the timeout and runs the rules\' step when nothing was typed', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: { present: true, text: '', armed: false }, ask: () => new Promise(() => undefined) })
    t.engine.start()
    t.say('tere')
    await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_MS - 1)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage'])
    await vi.advanceTimersByTimeAsync(2)
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'setText'])
    expect(t.state.thinking).toBe(false)
  })

  it('the final replaces the preview typed while he spoke, and a command from the model takes both back', async () => {
    const t = setup({ logic: { ...asking, inpagePreview: previewing.inpagePreview }, box: armed, ask: () => Promise.resolve(answer({ kind: 'command', command: { kind: 'clickItem', id: 2 } })) })
    t.engine.start()
    t.partial('vajuta')
    await t.engine.idle()
    t.say('vajuta otsi')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['Tere. vajuta', 'Tere.vajuta otsi', 'readPage', 'Tere.', 'clickItem'])
    expect(t.page().text).toBe('Tere.')
    // The model saw the box as it was before the words, not with the preview or the final in it.
    expect(t.asked[0]?.page.box.text).toBe('Tere.')
  })

  it('keeps the final\'s text when the model answers dictation', async () => {
    const t = setup({ logic: { ...asking, inpagePreview: previewing.inpagePreview }, box: armed, ask: () => Promise.resolve(answer({ kind: 'dictate', text: ' tulen' })) })
    t.engine.start()
    t.partial('tulen')
    await t.engine.idle()
    t.say('tulen')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['Tere. tulen', 'Tere.tulen', 'readPage'])
  })

  it('tells the model the last three lines, from before the utterance', async () => {
    const t = setup({ logic: asking, box: { present: true, text: '', armed: false }, ask: () => Promise.resolve(answer({ kind: 'unclear', say: '' })) })
    t.engine.start()
    for (const word of ['a', 'b', 'c']) {
      t.say(word)
      await t.engine.idle()
    }
    t.say('d')
    await t.engine.idle()
    expect(t.asked.map((r) => r.recent)).toEqual([[], ['ei saanud aru'], ['ei saanud aru', 'ei saanud aru'], ['ei saanud aru', 'ei saanud aru', 'ei saanud aru']])
  })

  it('type-first: the lines the model hears are those from before the utterance, not its own typing', async () => {
    const t = setup({ logic: asking, box: armed, ask: () => Promise.resolve(answer({ kind: 'dictate', text: 'a' })) })
    t.engine.start()
    t.say('a')
    await t.engine.idle()
    t.say('b')
    await t.engine.idle()
    expect(t.asked.map((r) => r.recent)).toEqual([[], ['kirjutan', 'tehtud']])
  })

  it('builds the page from the box when readPage fails', async () => {
    const t = setup({
      logic: asking,
      box: armed,
      answers: (c) => (c.kind === 'readPage' ? { ok: false, code: 'failed', message: 'no page' } : { ok: true }),
      ask: () => Promise.resolve(answer({ kind: 'send' })),
    })
    t.engine.start()
    t.say('saada ära')
    await t.engine.idle()
    expect(t.asked[0]?.page).toEqual({ url: '', title: '', box: armed, items: [], media: null, hints: false })
    expect(texts(t.ran)).toEqual(['Tere.saada ära', 'readPage', 'Tere.', 'pressSend'])
  })

  it('clips the lines it tells the model, so a long line never makes the request a 400', async () => {
    const long = 'x'.repeat(260)
    const wordy: InpageLogic = { ...asking, applyIntent: (session) => ({ session, commands: [], line: long }) }
    // An unarmed box: the model's line is shown (with an armed box the typed words stay and so does their line).
    const t = setup({ logic: wordy, box: { present: true, text: '', armed: false }, ask: () => Promise.resolve(answer({ kind: 'unclear', say: '' })) })
    t.engine.start()
    t.say('a')
    await t.engine.idle()
    t.say('b')
    await t.engine.idle()
    expect(t.asked[1]?.recent).toEqual([long.slice(0, 200)])
  })

  it('clips the page to what the request schema takes', async () => {
    const t = setup({
      logic: asking,
      box: { present: true, text: 'y'.repeat(5000), armed: true },
      page: (box) => ({ url: `https://a.ee/${'u'.repeat(3000)}`, title: 't'.repeat(400), box, items: [], media: null, hints: false }),
      ask: () => Promise.resolve(answer({ kind: 'unclear', say: '' })),
    })
    t.engine.start()
    t.say('a')
    await t.engine.idle()
    const page = t.asked[0]?.page
    expect(page?.url).toHaveLength(2000)
    expect(page?.title).toHaveLength(300)
    expect(page?.box.text).toHaveLength(4000)
  })

  it('a step that throws does not stop the utterances after it', async () => {
    const throwing: InpageLogic = {
      ...logic,
      inpageStep: (session, utterance, box) => {
        if (utterance === 'paha') throw new Error('bug')
        return logic.inpageStep(session, utterance, box)
      },
    }
    const t = setup({ logic: throwing })
    t.engine.start()
    t.say('paha')
    await t.engine.idle()
    t.say('tere')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['xtere'])
    expect(t.state.line).toBe('tehtud')
  })

  it('tells him before he speaks when the server has no key', async () => {
    const t = setup({ status: 'no_key' })
    await t.engine.idle()
    expect(t.state.modelProblem).toBe(STRINGS.et.inpage.modelOff)
    const live = setup({ status: 'live' })
    await live.engine.idle()
    expect(live.state.modelProblem).toBe('')
  })

  it('says the server token is wrong when the server answers 401, and asks no model (27.3)', async () => {
    const t = setup({ status: 'bad_token' })
    await t.engine.idle()
    expect(t.state.modelProblem).toBe(STRINGS.et.strip.badToken)
    // The socket's upgrade fails with the same 401: the strip names the token, not a missing model.
    t.engine.start()
    t.unavailable()
    expect(t.state.problem).toBe(STRINGS.et.strip.badToken)
  })
})

describe('multi-step utterances (M7.2)', () => {
  const unarmed: BoxState = { present: false, text: '', armed: false }
  const goTo = (url: string): IntentAnswer['intent'] => ({ kind: 'command', command: { kind: 'goTo', url } })
  const click = (id: number): IntentAnswer['intent'] => ({ kind: 'command', command: { kind: 'clickItem', id } })

  /** Answers in order; the last one repeats. */
  const script = (...answers: IntentAnswer[]) => {
    let i = 0
    return () => Promise.resolve(answers[Math.min(i++, answers.length - 1)] as IntentAnswer)
  }

  it('runs a second step after a fresh look at the page when the model says it is not done', async () => {
    const t = setup({
      logic: asking,
      box: unarmed,
      ask: script(answer(goTo('https://www.youtube.com/'), 'lähen youtube\'i', false), answer({ kind: 'command', command: { kind: 'siteSearch', query: 'kassivideod' } }, 'otsin', true)),
    })
    t.engine.start()
    t.say('mine youtube\'i ja otsi kassivideod')
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'goTo', 'readPage', 'siteSearch'])
    expect(t.asked).toHaveLength(2)
    expect(t.asked[0]?.steps).toBeUndefined()
    expect(t.asked[1]?.utterance).toBe('mine youtube\'i ja otsi kassivideod')
    expect(t.asked[1]?.steps).toEqual([{ action: 'command goTo', say: 'lähen youtube\'i', ok: true, message: '' }])
    expect(t.asked[1]?.recent).toEqual([])
    expect(t.state.line).toBe('tehtud')
    expect(t.state.thinking).toBe(false)
  })

  it('keeps thinking across the steps, shows each step\'s say, and stops thinking at the end', async () => {
    const seen: { thinking: boolean; line: string }[] = []
    const t = setup({
      logic: asking,
      box: unarmed,
      ask: (request) => {
        seen.push({ thinking: t.state.thinking ?? false, line: t.state.line ?? '' })
        return request.steps === undefined ? Promise.resolve(answer(goTo('https://www.youtube.com/'), 'lähen', false)) : Promise.resolve(answer(click(2), 'vajutan', true))
      },
    })
    t.engine.start()
    t.say('mine youtube\'i ja vajuta otsi')
    await t.engine.idle()
    // Round 5: the "ja" makes the ask careful, so the longer thinking line shows.
    expect(seen).toEqual([
      { thinking: true, line: STRINGS.et.inpage.thinkingLong },
      { thinking: true, line: 'tehtud' },
    ])
    expect(t.thinking).toEqual([true, false])
    expect(t.state.thinking).toBe(false)
  })

  it('names the item in the step it reports', async () => {
    const t = setup({ logic: asking, box: unarmed, ask: script(answer(click(3), 'vaata hiljem', false), answer({ kind: 'unclear', say: 'Valmis.' })) })
    t.engine.start()
    t.say('pane vaata hiljem ja mängi')
    await t.engine.idle()
    expect(t.asked[1]?.steps).toEqual([{ action: 'command clickItem 3', say: 'vaata hiljem', ok: true, message: '' }])
  })

  it('stops at MAX_INTENT_STEPS steps however long the model says it is not done', async () => {
    const t = setup({ logic: asking, box: unarmed, ask: script(answer({ kind: 'command', command: { kind: 'scroll', direction: 'down' } }, 'kerin', false)) })
    t.engine.start()
    t.say('keri päris alla')
    await t.engine.idle()
    expect(t.asked).toHaveLength(MAX_INTENT_STEPS)
    expect(t.ran.filter((c) => c.kind === 'scroll')).toHaveLength(MAX_INTENT_STEPS)
    expect(t.asked[MAX_INTENT_STEPS - 1]?.steps).toHaveLength(MAX_INTENT_STEPS - 1)
    expect(t.state.thinking).toBe(false)
  })

  it('reports one failed step back to the model, and stops after MAX_STEP_FAILURES failures', async () => {
    const t = setup({
      logic: asking,
      box: unarmed,
      answers: (c) => (c.kind === 'clickItem' ? { ok: false, code: 'not_found', message: 'gone' } : { ok: true }),
      ask: script(answer(click(1), 'avan', false)),
    })
    t.engine.start()
    t.say('ava esimene ja mängi')
    await t.engine.idle()
    expect(t.asked).toHaveLength(MAX_STEP_FAILURES)
    expect(t.asked[1]?.steps).toEqual([{ action: 'command clickItem 1', say: 'avan', ok: false, message: 'viga: gone' }])
    expect(t.state.line).toBe('viga: gone')
    expect(t.state.thinking).toBe(false)
  })

  it('asks once more after a failed step even when the model said it was done', async () => {
    let clicks = 0
    const t = setup({
      logic: asking,
      box: unarmed,
      answers: (c) => (c.kind === 'clickItem' && clicks++ === 0 ? { ok: false, code: 'not_found', message: 'gone' } : { ok: true }),
      ask: script(answer(click(1), 'avan koerte video', true), answer({ kind: 'command', command: { kind: 'siteSearch', query: 'koer' } }, 'otsin koer', true)),
    })
    t.engine.start()
    t.say('ava koerte video')
    await t.engine.idle()
    expect(t.asked).toHaveLength(2)
    expect(t.asked[1]?.steps).toEqual([{ action: 'command clickItem 1', say: 'avan koerte video', ok: false, message: 'viga: gone' }])
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'clickItem', 'readPage', 'siteSearch'])
  })

  it('a failed step followed by a good one goes on', async () => {
    let clicks = 0
    const t = setup({
      logic: asking,
      box: unarmed,
      answers: (c) => (c.kind === 'clickItem' && clicks++ === 0 ? { ok: false, code: 'not_found', message: 'gone' } : { ok: true }),
      ask: script(answer(click(1), 'avan', false), answer(click(2), 'avan teise', false), answer({ kind: 'command', command: { kind: 'media', action: 'play' } }, 'mängin', true)),
    })
    t.engine.start()
    t.say('ava esimene ja mängi')
    await t.engine.idle()
    expect(t.asked).toHaveLength(3)
    expect(t.asked[2]?.steps?.map((s) => s.ok)).toEqual([false, true])
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'clickItem', 'readPage', 'clickItem', 'readPage', 'media'])
  })

  it('an unclear answer mid-loop stops the loop and shows its say', async () => {
    const t = setup({ logic: asking, box: unarmed, ask: script(answer(goTo('https://www.youtube.com/'), 'lähen', false), answer({ kind: 'unclear', say: 'Ei leia otsingut.' })) })
    t.engine.start()
    t.say('mine youtube\'i ja otsi kassivideod')
    await t.engine.idle()
    expect(t.asked).toHaveLength(2)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'goTo', 'readPage'])
    expect(t.state.line).toBe('Ei leia otsingut.')
    expect(t.state.thinking).toBe(false)
  })

  it('the model failing mid-loop stops the loop with the last step\'s line', async () => {
    let n = 0
    const t = setup({
      logic: asking,
      box: unarmed,
      ask: () => (n++ === 0 ? Promise.resolve(answer(goTo('https://www.youtube.com/'), 'lähen', false)) : Promise.resolve({ error: 'unreachable' })),
    })
    t.engine.start()
    t.say('mine youtube\'i ja otsi kassivideod')
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'goTo', 'readPage'])
    expect(t.state.line).toBe('tehtud')
  })

  it('type-first into an armed box also follows the model\'s further steps', async () => {
    const t = setup({
      logic: asking,
      box: { present: true, text: 'Tere.', armed: true },
      ask: script(answer({ kind: 'command', command: { kind: 'openConversation', name: 'Mari' } }, 'avan Mari', false), answer({ kind: 'dictate', text: 'jõuan' }, 'kirjutan', true)),
    })
    t.engine.start()
    t.say('ava Mari vestlus ja kirjuta et jõuan')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['Tere.ava Mari vestlus ja kirjuta et jõuan', 'readPage', 'Tere.', 'openConversation', 'readPage', 'Tere.jõuan'])
    // The second look at the page is the page as it is, not with the base text put over it.
    expect(t.asked[1]?.page.box.text).toBe('Tere.')
    expect(t.asked[1]?.steps).toEqual([{ action: 'command openConversation', say: 'avan Mari', ok: true, message: '' }])
  })

  it('takes no further step once INTENT_LOOP_BUDGET_MS has passed since the utterance arrived', async () => {
    vi.useFakeTimers()
    const slow = Math.ceil(INTENT_LOOP_BUDGET_MS / 2) + 1
    const t = setup({ logic: asking, box: unarmed, goToMs: slow, ask: script(answer(goTo('https://www.youtube.com/'), 'lähen', false)) })
    t.engine.start()
    t.say('mine youtube\'i ja otsi kassivideod')
    await vi.advanceTimersByTimeAsync(INTENT_LOOP_BUDGET_MS * 3)
    // Two slow goTos (plus SETTLE_MS between them) pass the budget; without it the loop would have run MAX_INTENT_STEPS of them.
    expect(slow + SETTLE_MS + slow).toBeGreaterThan(INTENT_LOOP_BUDGET_MS)
    expect(t.ran.filter((c) => c.kind === 'goTo')).toHaveLength(2)
    expect(t.asked).toHaveLength(2)
    expect(t.state.thinking).toBe(false)
  })
})

describe('the queue keeps up (round 3)', () => {
  const armed: BoxState = { present: true, text: 'Tere.', armed: true }
  const unarmed: BoxState = { present: false, text: '', armed: false }
  const goTo = (url: string): IntentAnswer['intent'] => ({ kind: 'command', command: { kind: 'goTo', url } })
  const scroll: IntentAnswer['intent'] = { kind: 'command', command: { kind: 'scroll', direction: 'down' } }
  const after = (ms: number, a: IntentAnswer | AskFailure) => new Promise<IntentAnswer | AskFailure>((resolve) => setTimeout(() => resolve(a), ms))
  /** The first question is answered at once, the second never (the engine must give it up itself). */
  const thenHang = (first: IntentAnswer) => {
    let n = 0
    return () => (n++ === 0 ? Promise.resolve(first) : new Promise<IntentAnswer>(() => undefined))
  }

  it('an utterance that waited longer than STALE_MS gets the rules alone, with the catching-up suffix', async () => {
    vi.useFakeTimers()
    // The first typing holds the queue longer than STALE_MS; the second utterance waits behind it.
    const t = setup({ logic: asking, box: armed, setTextMs: STALE_MS + 500, ask: () => Promise.resolve(answer({ kind: 'dictate', text: 'a' })) })
    t.engine.start()
    t.say('a')
    await vi.advanceTimersByTimeAsync(100)
    t.say('b')
    await vi.advanceTimersByTimeAsync(STALE_MS * 3)
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'setText', 'readBox', 'setText'])
    expect(t.page().text).toBe('Tere.ab')
    expect(t.asked).toHaveLength(0)
    expect(t.state.line).toBe(`tehtud ${STRINGS.et.inpage.catchingUp}`)
    expect(t.thinking).toEqual([])
  })

  it('a fresh utterance gets no suffix', async () => {
    const t = setup({ logic: asking, box: armed, ask: () => Promise.resolve(answer({ kind: 'dictate', text: 'a' })) })
    t.engine.start()
    t.say('a')
    await t.engine.idle()
    expect(t.state.line).toBe('tehtud')
  })

  it('barge-in: a new utterance stops a multi-step loop after the command in hand, and aborts the question in flight', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: unarmed, ask: thenHang(answer(goTo('https://www.youtube.com/'), 'lähen', false)) })
    t.engine.start()
    t.say('mine youtube\'i ja otsi kassivideod')
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 100)
    // The first step ran; the second question is in flight.
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'goTo', 'readPage'])
    expect(t.signals[1]?.aborted).toBe(false)
    t.say('vaikus')
    await vi.advanceTimersByTimeAsync(100)
    expect(t.signals[1]?.aborted).toBe(true)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'goTo', 'readPage', 'readBox'])
    expect(t.asked).toHaveLength(2)
    expect(t.state.line).toBe('midagi')
    expect(t.state.thinking).toBe(false)
    await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_MS * 2)
    expect(t.asked).toHaveLength(2)
  })

  it('barge-in: a new utterance arriving during a step lets the step finish and asks for no further one', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: unarmed, goToMs: 1000, ask: () => Promise.resolve(answer(goTo('https://www.youtube.com/'), 'lähen', false)) })
    t.engine.start()
    t.say('mine youtube\'i ja otsi kassivideod')
    await vi.advanceTimersByTimeAsync(100)
    t.say('vaikus')
    await vi.advanceTimersByTimeAsync(3000)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'goTo', 'readBox'])
    expect(t.asked).toHaveLength(1)
  })

  it('barge-in: a question still being asked for the first step is given up, the rules\' step runs, and the newcomer goes on', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: { present: true, text: '', armed: false }, ask: () => new Promise(() => undefined) })
    t.engine.start()
    t.say('a')
    await vi.advanceTimersByTimeAsync(10)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage'])
    t.say('vaikus')
    await vi.advanceTimersByTimeAsync(10)
    expect(t.signals[0]?.aborted).toBe(true)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'setText', 'readBox'])
    expect(t.state.line).toBe('midagi')
    expect(t.state.thinking).toBe(false)
  })

  it('barge-in: a queued job is not cancelled', async () => {
    vi.useFakeTimers()
    // Review R3 M3: "mine" runs a slow page command; "otsi ilm" queues behind it; "vaikus" arrives
    // while the page command still runs. The queued one has started no model work, so it is still asked.
    const t = setup({ logic: asking, box: unarmed, goToMs: 1000, ask: () => Promise.resolve(answer(scroll, 'kerin')) })
    t.engine.start()
    t.say('mine')
    await vi.advanceTimersByTimeAsync(10)
    t.say('otsi ilm')
    await vi.advanceTimersByTimeAsync(10)
    t.say('vaikus')
    await vi.advanceTimersByTimeAsync(2000)
    expect(t.asked.map((r) => r.utterance)).toEqual(['otsi ilm'])
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'goTo', 'readBox', 'readPage', 'scroll', 'readBox'])
    expect(t.signals[0]?.aborted).toBe(false)
  })

  it('barge-in: a running model ask is cancelled', async () => {
    vi.useFakeTimers()
    // The first utterance's question is in flight; the second queues; the third arrives. Only the
    // question in flight is given up (the rules' step runs for it); the queued one is still asked.
    let n = 0
    const t = setup({ logic: asking, box: unarmed, ask: () => (n++ === 0 ? new Promise<IntentAnswer>(() => undefined) : Promise.resolve(answer(scroll, 'kerin'))) })
    t.engine.start()
    t.say('a')
    await vi.advanceTimersByTimeAsync(10)
    expect(t.asked).toHaveLength(1)
    t.say('otsi ilm')
    t.say('vaikus')
    await vi.advanceTimersByTimeAsync(10)
    expect(t.signals[0]?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.asked.map((r) => r.utterance)).toEqual(['a', 'otsi ilm'])
    expect(t.signals[1]?.aborted).toBe(false)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'setText', 'readBox', 'readPage', 'scroll', 'readBox'])
    expect(t.state.line).toBe('midagi')
  })

  it('two dictations in a row do not wait for each other\'s verification: the second is typed before the first\'s answer', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: armed, ask: () => after(1000, answer({ kind: 'dictate', text: 'x' })) })
    t.engine.start()
    t.say('a')
    await vi.advanceTimersByTimeAsync(10)
    t.say('b')
    await vi.advanceTimersByTimeAsync(10)
    expect(texts(t.ran)).toEqual(['Tere.a', 'readPage', 'Tere.ab', 'readPage'])
    // The first verification was given up for the newer words; the second runs.
    expect(t.signals[0]?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(t.asked).toHaveLength(2)
    expect(t.signals[1]?.aborted).toBe(false)
    expect(t.page().text).toBe('Tere.ab')
    expect(t.state.thinking).toBe(false)
  })

  it('a send waits for the verification pending and does not cancel it', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: armed, ask: () => after(1000, answer({ kind: 'dictate', text: 'tulen' })) })
    t.engine.start()
    t.say('tulen')
    await vi.advanceTimersByTimeAsync(10)
    t.say('saada')
    await vi.advanceTimersByTimeAsync(500)
    expect(t.signals[0]?.aborted).toBe(false)
    expect(texts(t.ran)).toEqual(['Tere.tulen', 'readPage'])
    await vi.advanceTimersByTimeAsync(1000)
    expect(texts(t.ran)).toEqual(['Tere.tulen', 'readPage', 'pressSend'])
    expect(t.boxes.map((b) => b.text)).toEqual(['Tere.', 'Tere.tulen'])
  })

  it('a send still gives up a multi-step loop', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: unarmed, ask: thenHang(answer(goTo('https://www.youtube.com/'), 'lähen', false)) })
    t.engine.start()
    t.say('mine youtube\'i ja otsi kassivideod')
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 100)
    t.say('saada')
    await vi.advanceTimersByTimeAsync(100)
    expect(t.signals[1]?.aborted).toBe(true)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'goTo', 'readPage', 'readBox', 'pressSend'])
  })

  it('a command verdict that comes after the box has changed touches nothing and says so', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: armed, ask: () => after(1000, answer(scroll)) })
    t.engine.start()
    t.say('keri alla palun')
    await vi.advanceTimersByTimeAsync(100)
    t.edit('Tere.keri alla palun ja veel')
    await vi.advanceTimersByTimeAsync(2000)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'setText', 'readPage', 'readBox'])
    expect(t.page().text).toBe('Tere.keri alla palun ja veel')
    expect(t.state.line).toBe(STRINGS.et.inpage.lateCommand('keri alla palun'))
    expect(t.state.thinking).toBe(false)
  })

  it('a command verdict that comes while the box reads as typed takes the words back and runs', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: armed, ask: () => after(1000, answer(scroll)) })
    t.engine.start()
    t.say('keri alla palun')
    await vi.advanceTimersByTimeAsync(2000)
    expect(texts(t.ran)).toEqual(['Tere.keri alla palun', 'readPage', 'Tere.', 'scroll'])
    expect(t.page().text).toBe('Tere.')
    expect(t.state.line).toBe('tehtud')
  })

  it('a verification whose typing failed still runs the command, without a revert', async () => {
    const t = setup({ logic: asking, box: armed, answers: (c) => (c.kind === 'setText' ? { ok: false, code: 'not_found', message: 'no box' } : { ok: true }), ask: () => Promise.resolve(answer(scroll)) })
    t.engine.start()
    t.say('keri alla palun')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['Tere.keri alla palun', 'readPage', 'scroll'])
  })

  it('thinking stays on while any question is in flight', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: armed, ask: () => after(1000, answer({ kind: 'dictate', text: 'x' })) })
    t.engine.start()
    t.say('a')
    await vi.advanceTimersByTimeAsync(10)
    t.say('saada')
    await vi.advanceTimersByTimeAsync(10)
    expect(t.state.thinking).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(t.thinking).toEqual([true, false])
  })

  it('the loop takes no further step after INTENT_LOOP_BUDGET_MS, now 15 s', () => {
    expect(INTENT_LOOP_BUDGET_MS).toBe(15_000)
    expect(STALE_MS).toBe(3000)
  })

  it('the lag threshold is below the server\'s 1500 ms backlog, where every drop is reported', () => {
    expect(LAG_SHOWN_MS).toBeLessThan(1500)
  })

  it('clears the lag line when listening stops, since the server then sends no lag of 0', () => {
    const t = setup()
    t.engine.start()
    t.lag(LAG_SHOWN_MS + 500)
    expect(t.lags).toEqual([LAG_SHOWN_MS + 500])
    t.engine.stop()
    expect(t.lags).toEqual([LAG_SHOWN_MS + 500, 0])
    expect(t.state.lag).toBe(0)
    t.engine.start()
    t.engine.stop()
    expect(t.lags).toEqual([LAG_SHOWN_MS + 500, 0])
  })

  it('publishes the recogniser\'s lag above LAG_SHOWN_MS and clears it once below', () => {
    const t = setup()
    t.lag(500)
    expect(t.lags).toEqual([])
    t.lag(LAG_SHOWN_MS + 500)
    expect(t.lags).toEqual([LAG_SHOWN_MS + 500])
    t.lag(LAG_SHOWN_MS + 900)
    t.lag(1000)
    expect(t.lags).toEqual([LAG_SHOWN_MS + 500, LAG_SHOWN_MS + 900, 0])
    t.lag(0)
    expect(t.lags).toEqual([LAG_SHOWN_MS + 500, LAG_SHOWN_MS + 900, 0])
  })
})

describe('chains of goals (round 4)', () => {
  const unarmed: BoxState = { present: false, text: '', armed: false }
  const goTo = (url: string): IntentAnswer['intent'] => ({ kind: 'command', command: { kind: 'goTo', url } })
  const click = (id: number): IntentAnswer['intent'] => ({ kind: 'command', command: { kind: 'clickItem', id } })
  const search = (query: string): IntentAnswer['intent'] => ({ kind: 'command', command: { kind: 'siteSearch', query } })
  const SCROLL: IntentAnswer['intent'] = { kind: 'command', command: { kind: 'scroll', direction: 'down' } }
  const planned = (intent: IntentAnswer['intent'], say: string, done: boolean, plan: string[]): IntentAnswer => ({ intent, say, done, plan })
  const script = (...answers: IntentAnswer[]) => {
    let i = 0
    return () => Promise.resolve(answers[Math.min(i++, answers.length - 1)] as IntentAnswer)
  }
  /** The first answer, then a question that never answers (the engine must give it up). */
  const thenHang = (first: IntentAnswer) => {
    let n = 0
    return (): Promise<IntentAnswer | AskFailure> => (n++ === 0 ? Promise.resolve(first) : new Promise(() => undefined))
  }
  /** Answers in order, then hangs until the test resolves it. */
  const thenWait = (...answers: IntentAnswer[]) => {
    let i = 0
    let release: ((a: IntentAnswer) => void) | null = null
    const ask = (): Promise<IntentAnswer | AskFailure> =>
      i < answers.length
        ? Promise.resolve(answers[i++] as IntentAnswer)
        : new Promise<IntentAnswer>((resolve) => {
            release = resolve
          })
    return { ask, resolve: (a: IntentAnswer) => release?.(a) }
  }
  const UTTERANCE = "mine youtube'i otsi kassivideod ja mängi esimene"

  it('works through the goals one by one: the first ask has no chain, each later one its goal and the chain, steps reset', async () => {
    const t = setup({
      logic: asking,
      box: unarmed,
      ask: script(planned(goTo('https://www.youtube.com/'), 'lähen youtube', true, ['otsi kassivideod', 'mängi esimene']), answer(search('kassivideod'), 'otsin', true), answer(click(3), 'mängin', true)),
    })
    t.engine.start()
    t.say(UTTERANCE)
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'goTo', 'readPage', 'siteSearch', 'readPage', 'clickItem'])
    expect(t.asked).toHaveLength(3)
    expect(t.asked[0]?.chain).toBeUndefined()
    expect(t.asked[0]?.utterance).toBe(UTTERANCE)
    expect(t.asked[1]?.utterance).toBe('otsi kassivideod')
    expect(t.asked[1]?.steps).toBeUndefined()
    expect(t.asked[1]?.chain).toEqual({ original: UTTERANCE, completed: ["mine youtube'i"], goal: 'otsi kassivideod', remaining: ['mängi esimene'] })
    expect(t.asked[2]?.utterance).toBe('mängi esimene')
    expect(t.asked[2]?.chain).toEqual({ original: UTTERANCE, completed: ["mine youtube'i", 'otsi kassivideod'], goal: 'mängi esimene', remaining: [] })
    expect(t.chains).toEqual(["1/3 · mine youtube'i", '2/3 · otsi kassivideod', '3/3 · mängi esimene', ''])
    expect(t.state.chain).toBe('')
    expect(t.state.line).toBe('tehtud')
    expect(t.state.thinking).toBe(false)
  })

  it('a goal may take several steps: the steps go back to the model with the chain, and the next goal starts afresh', async () => {
    const t = setup({
      logic: asking,
      box: unarmed,
      ask: (request) => {
        if (request.chain === undefined) return Promise.resolve(planned(goTo('https://web.whatsapp.com/'), 'lähen whatsappi', true, ['ava Karini viimane sõnum', 'kustuta see']))
        if (request.chain.goal === 'ava Karini viimane sõnum') return Promise.resolve(request.steps === undefined ? answer(SCROLL, 'kerin', false) : answer(click(2), 'avan', true))
        return Promise.resolve(answer(click(1), 'kustutan', true))
      },
    })
    t.engine.start()
    t.say('mine whatsappi, ava Karini viimane sõnum, kustuta see')
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'goTo', 'readPage', 'scroll', 'readPage', 'clickItem', 'readPage', 'clickItem'])
    expect(t.asked[2]?.steps).toEqual([{ action: 'command scroll', say: 'kerin', ok: true, message: '' }])
    expect(t.asked[2]?.chain?.goal).toBe('ava Karini viimane sõnum')
    expect(t.asked[3]?.steps).toBeUndefined()
    expect(t.asked[3]?.chain).toEqual({ original: 'mine whatsappi, ava Karini viimane sõnum, kustuta see', completed: ['mine whatsappi', 'ava Karini viimane sõnum'], goal: 'kustuta see', remaining: [] })
    expect(t.chains).toEqual(['1/3 · mine whatsappi', '2/3 · ava Karini viimane sõnum', '3/3 · kustuta see', ''])
  })

  it('stops on unclear, clears the chain line, and never asks for the goals left', async () => {
    const t = setup({
      logic: asking,
      box: unarmed,
      ask: script(planned(goTo('https://www.youtube.com/'), 'lähen', true, ['otsi kassivideod', 'mängi esimene']), answer({ kind: 'unclear', say: 'Ei leia otsingut.' })),
    })
    t.engine.start()
    t.say(UTTERANCE)
    await t.engine.idle()
    expect(t.asked).toHaveLength(2)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'goTo', 'readPage'])
    expect(t.state.line).toBe('Ei leia otsingut.')
    expect(t.chains).toEqual(["1/3 · mine youtube'i", '2/3 · otsi kassivideod', ''])
    expect(t.state.thinking).toBe(false)
  })

  it('an unclear "Valmis" after a good step counts the goal as done and the chain goes on', async () => {
    const t = setup({
      logic: asking,
      box: unarmed,
      ask: (request) => {
        if (request.chain === undefined) return Promise.resolve(planned(goTo('https://www.youtube.com/'), 'lähen', false, ['mängi esimene']))
        if (request.chain.goal === "mine youtube'i") return Promise.resolve(answer({ kind: 'unclear', say: 'Valmis.' }))
        return Promise.resolve(answer(click(3), 'mängin', true))
      },
    })
    t.engine.start()
    t.say("mine youtube'i ja mängi esimene")
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'goTo', 'readPage', 'readPage', 'clickItem'])
    expect(t.asked.map((r) => r.utterance)).toEqual(["mine youtube'i ja mängi esimene", "mine youtube'i", 'mängi esimene'])
    expect(t.chains.at(-1)).toBe('')
  })

  it('stops after two failed steps for one goal', async () => {
    const t = setup({
      logic: asking,
      box: unarmed,
      answers: (c) => (c.kind === 'clickItem' ? { ok: false, code: 'not_found', message: 'gone' } : { ok: true }),
      ask: script(planned(goTo('https://www.youtube.com/'), 'lähen', true, ['mängi esimene', 'pane heli vaiksemaks']), answer(click(1), 'mängin', true)),
    })
    t.engine.start()
    t.say("mine youtube'i mängi esimene ja pane heli vaiksemaks")
    await t.engine.idle()
    expect(t.ran.filter((c) => c.kind === 'clickItem')).toHaveLength(MAX_STEP_FAILURES)
    expect(t.asked).toHaveLength(1 + MAX_STEP_FAILURES)
    expect(t.asked.at(-1)?.chain?.goal).toBe('mängi esimene')
    expect(t.chains.at(-1)).toBe('')
  })

  it('stops at MAX_CHAIN_STEPS page steps in all, however many goals are left', async () => {
    // Fake timers: the engine waits SETTLE_MS between steps, and 15 real waits of 300 ms made this
    // test take about 5 s of wall time, so it timed out on a loaded machine.
    vi.useFakeTimers()
    const plan = Array.from({ length: 12 }, (_, i) => `keri ${i + 1}`)
    const t = setup({
      logic: asking,
      box: unarmed,
      ask: (request) => Promise.resolve(request.chain === undefined ? planned(SCROLL, 'kerin', false, plan) : answer(SCROLL, 'kerin', request.steps !== undefined)),
    })
    t.engine.start()
    t.say('keri alla ' + plan.join(' ja '))
    const idle = t.engine.idle()
    await vi.advanceTimersByTimeAsync(SETTLE_MS * (MAX_CHAIN_STEPS + 1))
    await idle
    expect(t.ran.filter((c) => c.kind === 'scroll')).toHaveLength(MAX_CHAIN_STEPS)
    expect(t.asked).toHaveLength(MAX_CHAIN_STEPS)
    expect(t.asked.at(-1)?.chain?.remaining.length).toBeGreaterThan(0)
    expect(t.chains.at(-1)).toBe('')
    expect(t.state.thinking).toBe(false)
  })

  it('takes no further goal once MAX_CHAIN_MS has passed since the utterance arrived', async () => {
    vi.useFakeTimers()
    // Round 5: one command is cut at COMMAND_TIMEOUT_MS and a goal at JOB_WATCHDOG_MS, so each goal
    // takes just under the command cap: the fifth goal ends past MAX_CHAIN_MS and no sixth is asked.
    const slow = COMMAND_TIMEOUT_MS - 1000
    const t = setup({
      logic: asking,
      box: unarmed,
      goToMs: slow,
      ask: (request) => Promise.resolve(request.chain === undefined ? planned(goTo('https://a.ee/'), 'a', true, ['b', 'c', 'd', 'e', 'f', 'g']) : answer(goTo('https://b.ee/'), 'b', true)),
    })
    t.engine.start()
    t.say('a ja b ja c ja d ja e ja f ja g')
    await vi.advanceTimersByTimeAsync(MAX_CHAIN_MS * 3)
    expect(t.ran.filter((c) => c.kind === 'goTo')).toHaveLength(5)
    expect(t.asked).toHaveLength(5)
    expect(t.chains.at(-1)).toBe('')
  })

  it('barge-in: a new utterance cancels the chain, aborts the question in flight, and publishes an empty chain line', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: unarmed, ask: thenHang(planned(goTo('https://www.youtube.com/'), 'lähen', true, ['otsi kassivideod', 'mängi esimene'])) })
    t.engine.start()
    t.say(UTTERANCE)
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 100)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'goTo', 'readPage'])
    expect(t.state.chain).toBe('2/3 · otsi kassivideod')
    t.say('vaikus')
    await vi.advanceTimersByTimeAsync(100)
    expect(t.signals[1]?.aborted).toBe(true)
    expect(t.asked).toHaveLength(2)
    expect(t.chains).toEqual(["1/3 · mine youtube'i", '2/3 · otsi kassivideod', ''])
    expect(t.state.line).toBe('midagi')
    await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_MS * 2)
    expect(t.asked).toHaveLength(2)
  })

  it('a plain send does not cancel a chain: it waits and sends after it', async () => {
    vi.useFakeTimers()
    const model = thenWait(planned(goTo('https://www.youtube.com/'), 'lähen', true, ['otsi kassivideod']))
    const t = setup({ logic: asking, box: unarmed, ask: model.ask })
    t.engine.start()
    t.say("mine youtube'i ja otsi kassivideod")
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 100)
    expect(t.state.chain).toBe('2/2 · otsi kassivideod')
    t.say('saada')
    await vi.advanceTimersByTimeAsync(100)
    expect(t.signals[1]?.aborted).toBe(false)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'goTo', 'readPage'])
    model.resolve(answer(search('kassivideod'), 'otsin', true))
    await vi.advanceTimersByTimeAsync(100)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'goTo', 'readPage', 'siteSearch', 'readBox', 'pressSend'])
    expect(t.chains.at(-1)).toBe('')
  })

  it('a continued utterance appends its goals to what was just done, and does not barge in', async () => {
    vi.useFakeTimers()
    const model = thenWait()
    const t = setup({ logic: asking, box: unarmed, ask: model.ask })
    t.engine.start()
    t.say("mine youtube'i")
    await vi.advanceTimersByTimeAsync(10)
    expect(t.asked).toHaveLength(1)
    // The continuation arrives while the first question is in flight: nothing is given up.
    t.continued("mine youtube'i siis otsi kassivideod", 'siis otsi kassivideod')
    await vi.advanceTimersByTimeAsync(10)
    expect(t.signals[0]?.aborted).toBe(false)
    expect(t.state.heard).toBe("mine youtube'i siis otsi kassivideod")
    model.resolve(answer(goTo('https://www.youtube.com/'), 'lähen', true))
    await vi.advanceTimersByTimeAsync(10)
    model.resolve(answer(search('kassivideod'), 'otsin', true))
    await vi.advanceTimersByTimeAsync(10)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'goTo', 'readBox', 'readPage', 'siteSearch'])
    expect(t.asked[1]?.utterance).toBe('siis otsi kassivideod')
    expect(t.asked[1]?.chain).toEqual({ original: "mine youtube'i siis otsi kassivideod", completed: ["mine youtube'i"], goal: 'siis otsi kassivideod', remaining: [] })
    expect(t.chains).toEqual(['2/2 · siis otsi kassivideod', ''])
  })

  it('a continued utterance that holds several goals plans them after the goals already done', async () => {
    const t = setup({
      logic: asking,
      box: unarmed,
      ask: (request) => {
        if (request.chain === undefined) return Promise.resolve(planned(goTo('https://web.whatsapp.com/'), 'lähen', true, ['ava Karin']))
        if (request.chain.goal === 'ava Karin') return Promise.resolve(answer({ kind: 'command', command: { kind: 'openConversation', name: 'Karin' } }, 'avan', true))
        if (request.chain.goal === 'siis kustuta see ja saada') return Promise.resolve(planned(click(1), 'kustutan', true, ['saada']))
        return Promise.resolve(answer({ kind: 'unclear', say: 'Ütle „saada“.' }))
      },
    })
    t.engine.start()
    t.say('mine whatsappi ja ava Karin')
    await t.engine.idle()
    t.continued('mine whatsappi ja ava Karin siis kustuta see ja saada', 'siis kustuta see ja saada')
    await t.engine.idle()
    expect(t.asked.map((r) => r.utterance)).toEqual(['mine whatsappi ja ava Karin', 'ava Karin', 'siis kustuta see ja saada', 'saada'])
    expect(t.asked[3]?.chain).toEqual({ original: 'mine whatsappi ja ava Karin siis kustuta see ja saada', completed: ['mine whatsappi', 'ava Karin', 'siis kustuta see'], goal: 'saada', remaining: [] })
    // The continued goal is shown whole first, then narrowed to its first part once the model has planned the rest.
    expect(t.chains).toEqual(['1/2 · mine whatsappi', '2/2 · ava Karin', '', '3/3 · siis kustuta see ja saada', '3/4 · siis kustuta see', '4/4 · saada', ''])
  })

  it('a continued utterance that waited is still asked: it is not stale', async () => {
    vi.useFakeTimers()
    const model = thenWait()
    const t = setup({ logic: asking, box: unarmed, ask: model.ask })
    t.engine.start()
    t.say("mine youtube'i")
    await vi.advanceTimersByTimeAsync(10)
    t.continued("mine youtube'i siis otsi kassivideod", 'siis otsi kassivideod')
    await vi.advanceTimersByTimeAsync(STALE_MS + 1000)
    model.resolve(answer(goTo('https://www.youtube.com/'), 'lähen', true))
    await vi.advanceTimersByTimeAsync(10)
    expect(t.asked).toHaveLength(2)
    expect(t.asked[1]?.utterance).toBe('siis otsi kassivideod')
  })

  it('names the hovered item in the step it reports', async () => {
    const t = setup({ logic: asking, box: unarmed, ask: script(answer({ kind: 'command', command: { kind: 'hover', id: 3 } }, 'hõljun', false), answer({ kind: 'unclear', say: 'Valmis.' })) })
    t.engine.start()
    t.say('ava viimane sõnum')
    await t.engine.idle()
    expect(t.asked[1]?.steps).toEqual([{ action: 'command hover 3', say: 'hõljun', ok: true, message: '' }])
  })
})

describe('review of round 4', () => {
  const unarmed: BoxState = { present: false, text: '', armed: false }
  const goTo = (url: string): IntentAnswer['intent'] => ({ kind: 'command', command: { kind: 'goTo', url } })

  it("a foreign final takes back the preview its partials typed, without waiting for the owner's next words", async () => {
    const t = setup({ logic: previewing, box: { present: true, text: 'Tere.', armed: true } })
    t.engine.start()
    t.partial('pane')
    t.partial('pane telekas kinni')
    await t.engine.idle()
    expect(t.page().text).toBe('Tere. pane telekas kinni')
    t.foreign()
    await t.engine.idle()
    expect(t.page().text).toBe('Tere.')
    // The owner's next utterance starts from the base, as a new one.
    t.partial('ma')
    await t.engine.idle()
    expect(t.page().text).toBe('Tere. ma')
  })

  it('a plan that only repeats the utterance or the goal starts no chain, so the same goal is never asked twice', async () => {
    const t = setup({ logic: asking, box: unarmed, ask: () => Promise.resolve({ intent: goTo('https://www.youtube.com/'), say: 'lähen youtube', done: true, plan: ["Mine YouTube'i.", 'lähen youtube', "mine youtube'i"] }) })
    t.engine.start()
    t.say("mine youtube'i")
    await t.engine.idle()
    expect(t.asked).toHaveLength(1)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'goTo'])
    expect(t.chains).toEqual([])
  })

  it('a plan on a later goal adds only goals the chain does not know, and duplicates once', async () => {
    const t = setup({
      logic: asking,
      box: unarmed,
      ask: (request) => {
        if (request.chain === undefined) return Promise.resolve({ intent: goTo('https://www.youtube.com/'), say: '', done: true, plan: ['otsi kassivideod', 'mängi esimene'] })
        if (request.chain.goal === 'otsi kassivideod') return Promise.resolve({ intent: { kind: 'command', command: { kind: 'siteSearch', query: 'kassivideod' } } as const, say: '', done: true, plan: ['otsi kassivideod', "mine youtube'i", 'mängi esimene', 'pane heli maha', 'pane heli maha'] })
        return Promise.resolve({ intent: { kind: 'unclear', say: 'x' } as const, say: '' })
      },
    })
    t.engine.start()
    t.say("mine youtube'i otsi kassivideod ja mängi esimene")
    await t.engine.idle()
    expect(t.asked.map((r) => r.utterance)).toEqual(["mine youtube'i otsi kassivideod ja mängi esimene", 'otsi kassivideod', 'pane heli maha'])
    expect(t.asked[2]?.chain?.remaining).toEqual(['mängi esimene'])
  })

  it('a continued utterance after a long one carries goals clipped to what the request schema takes', async () => {
    const long = Array.from({ length: 60 }, (_, i) => `sõna${i}`).join(' ')
    const t = setup({ logic: asking, box: unarmed, ask: () => Promise.resolve({ intent: { kind: 'unclear', say: 'x' }, say: '' }) })
    t.engine.start()
    t.say(long)
    await t.engine.idle()
    t.continued(`${long} siis saada`, 'siis saada')
    await t.engine.idle()
    expect(t.asked).toHaveLength(2)
    expect(t.asked[0]?.utterance.length).toBeLessThanOrEqual(500)
    expect(t.asked[1]?.chain?.completed.map((g) => g.length)).toEqual([200])
    expect(t.asked[1]?.chain?.original.length).toBeLessThanOrEqual(1000)
  })

  it('a plain send reads the box after what it waited for, not the base from before', async () => {
    const t = setup({ logic: previewing, box: { present: true, text: 'x', armed: true } })
    t.engine.start()
    t.partial('saa')
    await t.engine.idle()
    // The page (or a chain) changed the box since the send's partials began.
    t.edit('uus')
    t.say('saada')
    await t.engine.idle()
    expect(t.boxes.at(-1)?.text).toBe('uus')
    expect(t.ran.filter((c) => c.kind === 'pressSend')).toHaveLength(1)
  })

  it('while the server learns his voice nothing he says is typed or run, until the answer comes', async () => {
    const t = setup({ logic: previewing, box: { present: true, text: 'Tere.', armed: true } })
    t.engine.enrol(8)
    expect(t.starts()).toBe(1)
    expect(t.enrols).toEqual([8])
    t.partial('tere')
    t.say('tere mina olen')
    t.continued('tere mina olen siis räägin', 'siis räägin')
    await t.engine.idle()
    expect(t.ran).toEqual([])
    expect(t.heard).toEqual([])
    t.enrolled(true)
    t.say('ma jõuan')
    await t.engine.idle()
    expect(t.page().text).toBe('Tere.ma jõuan')
  })

  it('an enrolment the server never answers ends on its own', async () => {
    vi.useFakeTimers()
    const t = setup({ box: unarmed })
    t.engine.enrol(8)
    t.say('vaikus')
    await vi.advanceTimersByTimeAsync(10)
    expect(t.ran).toEqual([])
    await vi.advanceTimersByTimeAsync(8 * 1000 * ENROL_TIMEOUT_FACTOR + 10)
    t.say('vaikus')
    await vi.advanceTimersByTimeAsync(10)
    expect(t.state.line).toBe('midagi')
  })
})

describe('round 5, BRAIN lane: care, never stuck, single fields', () => {
  const unarmed: BoxState = { present: false, text: '', armed: false }
  const armed: BoxState = { present: true, text: 'Tere.', armed: true }
  const single: BoxState = { present: true, text: '', armed: true, kind: 'field', fieldKind: 'text', single: true, label: 'Nimi' }
  const goTo = (url: string): IntentAnswer['intent'] => ({ kind: 'command', command: { kind: 'goTo', url } })
  const scroll: IntentAnswer['intent'] = { kind: 'command', command: { kind: 'scroll', direction: 'down' } }
  const planned = (intent: IntentAnswer['intent'], say: string, done: boolean, plan: string[]): IntentAnswer => ({ intent, say, done, plan })
  const after = (ms: number, a: IntentAnswer | AskFailure) => new Promise<IntentAnswer | AskFailure>((resolve) => setTimeout(() => resolve(a), ms))
  /** The first answer, then a question that never answers. */
  const thenHang = (first: IntentAnswer) => {
    let n = 0
    return (): Promise<IntentAnswer | AskFailure> => (n++ === 0 ? Promise.resolve(first) : new Promise(() => undefined))
  }
  const EIGHT = 'ava palun see uus video mis eile tuli'

  it('the constants: careful asks wait 14 s, quick ones 9 s; the watchdog is 25 s; a command 20 s; seconds from 3', () => {
    expect(askTimeoutMs('careful')).toBe(ASK_TIMEOUT_CAREFUL_MS)
    expect(askTimeoutMs('quick')).toBe(ASK_TIMEOUT_MS)
    expect(askTimeoutMs(undefined)).toBe(ASK_TIMEOUT_MS)
    expect(ASK_TIMEOUT_CAREFUL_MS).toBe(14_000)
    expect(JOB_WATCHDOG_MS).toBe(25_000)
    expect(COMMAND_TIMEOUT_MS).toBe(20_000)
    expect(BUSY_FROM_S).toBe(3)
    expect(CAREFUL_WORDS).toBe(8)
    expect(LONG_COMMAND_WORDS).toBe(14)
  })

  it('a short utterance is asked quickly, with the short thinking line', async () => {
    const t = setup({ logic: asking, box: unarmed, ask: () => Promise.resolve(answer(scroll, 'kerin')) })
    t.engine.start()
    t.say('keri natuke')
    await t.engine.idle()
    expect(t.asked[0]?.care).toBe('quick')
    expect(t.heard).toEqual(['keri natuke'])
  })

  it('eight words or more, or a connective, is asked with care, and the line says it thinks longer', async () => {
    const lines: string[] = []
    const t = setup({
      logic: asking,
      box: unarmed,
      ask: () => {
        lines.push(t.state.line ?? '')
        return Promise.resolve(answer(scroll, 'kerin'))
      },
    })
    t.engine.start()
    t.say(EIGHT)
    await t.engine.idle()
    t.say('keri alla ja')
    await t.engine.idle()
    t.say('keri natuke')
    await t.engine.idle()
    expect(EIGHT.split(' ')).toHaveLength(CAREFUL_WORDS)
    expect(t.asked.map((r) => r.care)).toEqual(['careful', 'careful', 'quick'])
    expect(lines).toEqual([STRINGS.et.inpage.thinkingLong, STRINGS.et.inpage.thinkingLong, STRINGS.et.inpage.thinking])
  })

  it('every ask in a chain is careful, even when the first ask was quick', async () => {
    const t = setup({
      logic: asking,
      box: unarmed,
      ask: (request) => Promise.resolve(request.chain === undefined ? planned(goTo('https://www.youtube.com/'), 'lähen', true, ['otsi kassivideod']) : answer(scroll, 'otsin', true)),
    })
    t.engine.start()
    t.say("mine youtube'i otsi kassivideod")
    await t.engine.idle()
    expect(t.asked.map((r) => r.care)).toEqual(['quick', 'careful'])
  })

  it('a careful ask is given up only after ASK_TIMEOUT_CAREFUL_MS; a quick one after ASK_TIMEOUT_MS', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: unarmed, ask: () => new Promise(() => undefined) })
    t.engine.start()
    t.say(EIGHT)
    await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_MS + 100)
    expect(t.signals[0]?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_CAREFUL_MS - ASK_TIMEOUT_MS)
    expect(t.signals[0]?.aborted).toBe(true)
  })

  it('publishes the busy seconds from 3 s on, every second, and 0 when the job is over', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: unarmed, ask: () => after(5500, answer(scroll, 'kerin')) })
    t.engine.start()
    t.say('keri natuke')
    await vi.advanceTimersByTimeAsync(2900)
    expect(t.busy).toEqual([])
    await vi.advanceTimersByTimeAsync(200)
    expect(t.busy).toEqual([3])
    await vi.advanceTimersByTimeAsync(2000)
    expect(t.busy).toEqual([3, 4, 5])
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.busy).toEqual([3, 4, 5, 0])
    expect(t.state.busySeconds).toBe(0)
  })

  it('the watchdog gives a job up after JOB_WATCHDOG_MS: the question is aborted, the line says so, the dots and the seconds go', async () => {
    vi.useFakeTimers()
    // A careful ask that takes 13 s, then a 19 s goTo the model wants more after: the goal crosses 25 s mid-command.
    const t = setup({ logic: asking, box: unarmed, goToMs: COMMAND_TIMEOUT_MS - 1000, ask: () => after(13_000, answer(goTo('https://a.ee/'), 'lähen', false)) })
    t.engine.start()
    t.say(EIGHT)
    await vi.advanceTimersByTimeAsync(JOB_WATCHDOG_MS - 100)
    expect(t.state.busySeconds).toBeGreaterThan(20)
    expect(t.state.thinking).toBe(true)
    expect(t.state.line).toBe('lähen: teen')
    await vi.advanceTimersByTimeAsync(200)
    expect(t.state.line).toBe(STRINGS.et.inpage.tookTooLong)
    expect(t.state.thinking).toBe(false)
    expect(t.state.busySeconds).toBe(0)
    // The command in hand finishes, then nothing more: no second ask, no late result line.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(t.asked).toHaveLength(1)
    expect(t.ran.filter((c) => c.kind === 'goTo')).toHaveLength(1)
    expect(t.state.line).toBe(STRINGS.et.inpage.tookTooLong)
    expect(t.busy.at(-1)).toBe(0)
    // The engine is free: the next utterance is handled.
    t.say('vaikus')
    await vi.advanceTimersByTimeAsync(10)
    expect(t.state.line).toBe('midagi')
  })

  it('the watchdog is per goal: a chain that moves is not given up at 25 s in all', async () => {
    vi.useFakeTimers()
    const slow = 12_000
    const t = setup({
      logic: asking,
      box: unarmed,
      goToMs: slow,
      ask: (request) => Promise.resolve(request.chain === undefined ? planned(goTo('https://a.ee/'), 'a', true, ['b', 'c']) : answer(goTo('https://b.ee/'), 'b', true)),
    })
    t.engine.start()
    t.say('a ja b ja c')
    await vi.advanceTimersByTimeAsync(3 * (slow + SETTLE_MS) + 1000)
    expect(t.ran.filter((c) => c.kind === 'goTo')).toHaveLength(3)
    expect(t.state.line).not.toBe(STRINGS.et.inpage.tookTooLong)
    expect(t.chains.at(-1)).toBe('')
  })

  it('"katkesta" cancels a running chain: the question is aborted, the chain line and the dots go, the model is not asked', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: unarmed, ask: thenHang(planned(goTo('https://www.youtube.com/'), 'lähen', true, ['otsi kassivideod', 'mängi esimene'])) })
    t.engine.start()
    t.say("mine youtube'i, otsi kassivideod ja mängi esimene")
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 100)
    expect(t.state.chain).toBe('2/3 · otsi kassivideod')
    expect(t.state.thinking).toBe(true)
    t.say('katkesta')
    await vi.advanceTimersByTimeAsync(10)
    expect(t.signals[1]?.aborted).toBe(true)
    expect(t.state.line).toBe(STRINGS.et.inpage.cancelled)
    expect(t.state.chain).toBe('')
    expect(t.state.thinking).toBe(false)
    // Under 3 s: no seconds were ever shown, so none are published back to 0.
    expect(t.state.busySeconds ?? 0).toBe(0)
    await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_CAREFUL_MS * 2)
    // Two asks for the chain, none for "katkesta" and none after it.
    expect(t.asked).toHaveLength(2)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'goTo', 'readPage'])
    expect(t.state.line).toBe(STRINGS.et.inpage.cancelled)
  })

  it('"katkesta" gives up a pending verification (the words stay), takes back the live preview, and drops what is queued', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: { ...asking, inpagePreview: previewing.inpagePreview }, box: armed, ask: () => new Promise(() => undefined) })
    t.engine.start()
    t.say('keri alla palun')
    await vi.advanceTimersByTimeAsync(10)
    // Typed first; the verification hangs in the background.
    expect(t.page().text).toBe('Tere.keri alla palun')
    expect(t.state.thinking).toBe(true)
    // The next utterance is being spoken: its preview is in the box.
    t.partial('ma jõu')
    await vi.advanceTimersByTimeAsync(10)
    expect(t.page().text).toBe('Tere.keri alla palun ma jõu')
    t.say('katkesta')
    await vi.advanceTimersByTimeAsync(10)
    expect(t.signals[0]?.aborted).toBe(true)
    expect(t.page().text).toBe('Tere.keri alla palun')
    expect(t.state.line).toBe(STRINGS.et.inpage.cancelled)
    expect(t.state.thinking).toBe(false)
    await t.engine.idle()
    expect(t.asked).toHaveLength(1)
    // Nothing of the cancelled work ran: no scroll, no late line.
    expect(t.ran.some((c) => c.kind === 'scroll')).toBe(false)
    expect(t.state.line).toBe(STRINGS.et.inpage.cancelled)
  })

  it('"katkesta" while asleep or with words in the box is still the cancel through the real rules, never a soft word', () => {
    // The probe goes through the logic given; the real core's answer is tested in inpage.test.ts.
    const t = setup({ logic: asking, box: armed })
    t.engine.start()
    t.say('katkesta')
    expect(t.state.line).toBe(STRINGS.et.inpage.cancelled)
    expect(t.ran).toEqual([])
  })

  it('a single-line field waits for the model and types what it dictates, nothing before', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: single, ask: () => after(500, answer({ kind: 'dictate', text: 'Mari Maasikas' }, '')) })
    t.engine.start()
    t.say('mari maasikas')
    await vi.advanceTimersByTimeAsync(100)
    expect(texts(t.ran)).toEqual(['readPage'])
    expect(t.state.line).toBe(STRINGS.et.inpage.thinking)
    await vi.advanceTimersByTimeAsync(500)
    expect(texts(t.ran)).toEqual(['readPage', 'Mari Maasikas'])
    expect(t.state.line).toBe('tehtud')
  })

  it('a single-line field whose model gave no answer gets nothing typed, and the line says so', async () => {
    const t = setup({ logic: asking, box: single, ask: () => Promise.resolve({ error: 'unreachable' }) })
    t.engine.start()
    t.say('mari maasikas')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['readPage'])
    expect(t.state.line).toBe(STRINGS.et.inpage.fieldUnverified)
  })

  it('a single-line field with no model at all still gets the rules\' typing', async () => {
    const t = setup({ logic: asking, box: single, ask: () => Promise.resolve({ error: 'no_model' }) })
    t.engine.start()
    t.say('mari maasikas')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['readPage', 'mari maasikas'])
  })

  it('a long sentence typed first stays in the box when the verdict is one plain command with nothing after it', async () => {
    const t = setup({ logic: asking, box: armed, ask: () => Promise.resolve(answer(scroll, 'kerin', true)) })
    t.engine.start()
    expect(SENTENCE.split(' ').length).toBeGreaterThanOrEqual(LONG_COMMAND_WORDS)
    t.say(SENTENCE)
    await t.engine.idle()
    expect(texts(t.ran)).toEqual([`Tere.${SENTENCE}`, 'readPage'])
    expect(t.page().text).toBe(`Tere.${SENTENCE}`)
    expect(t.state.line).toBe(STRINGS.et.inpage.keptWords)
  })

  it('a long sentence is still taken back when the verdict carries a plan or asks for more', async () => {
    const t = setup({ logic: asking, box: armed, ask: () => Promise.resolve(planned(scroll, 'kerin', true, ['mängi esimene'])) })
    t.engine.start()
    t.say(SENTENCE)
    await t.engine.idle()
    expect(t.ran.some((c) => c.kind === 'scroll')).toBe(true)
    expect(t.page().text).toBe('Tere.')
  })

  it('a page command that never answers fails with timed_out after COMMAND_TIMEOUT_MS, and the queue goes on', async () => {
    vi.useFakeTimers()
    const t = setup({ box: unarmed, goToMs: 10 * COMMAND_TIMEOUT_MS })
    t.engine.start()
    t.say('mine')
    await vi.advanceTimersByTimeAsync(COMMAND_TIMEOUT_MS - 100)
    expect(t.state.line).toBe('lähen')
    await vi.advanceTimersByTimeAsync(200)
    expect(t.state.line).toBe('viga: timed_out')
    t.say('vaikus')
    await vi.advanceTimersByTimeAsync(10)
    expect(t.state.line).toBe('midagi')
  })

  it('review: a single-line field he armed types the rules\' words when the model cannot tell', async () => {
    const t = setup({ logic: asking, box: single, ask: () => Promise.resolve(answer({ kind: 'unclear', say: 'Mida?' })) })
    t.engine.start()
    t.say('mari maasikas')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['readPage', 'mari maasikas'])
    expect(t.state.line).toBe('tehtud')
  })

  it('review: an unarmed box with an unclear verdict still gets nothing', async () => {
    const t = setup({ logic: asking, box: { ...single, armed: false }, ask: () => Promise.resolve(answer({ kind: 'unclear', say: 'Mida?' })) })
    t.engine.start()
    t.say('mari maasikas')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['readPage'])
  })
})

describe('round 6: saved values (Minu andmed: names only, insertSaved, entry mode)', () => {
  const EMAIL: SavedItem = { id: 'e1', name: 'minu e-post', value: 'ralf.tamm@gmail.com', kind: 'email' }
  const PHONE: SavedItem = { id: 't1', name: 'minu telefon', value: '+37251234567', kind: 'tel' }
  const real: InpageLogic = { initialInpage, inpageStep, inpageResult, inpageInstant, inpagePreview, applyIntent, pageIntentFrom }
  const nothing: BoxState = { present: false, text: '', armed: false }
  const emailField: BoxState = { present: true, text: '', armed: true, kind: 'field', fieldKind: 'email', single: true, label: 'E-post' }
  const FORM_ITEMS = [{ id: 3, role: 'field', text: 'E-post' }]

  it('saved: the request for /api/intent carries the names only, never a value', async () => {
    const t = setup({ logic: real, box: nothing, ask: () => Promise.resolve(answer({ kind: 'unclear', say: '' })) })
    t.engine.setSaved([EMAIL, PHONE])
    t.engine.start()
    t.say('pane mu email sinna')
    await t.engine.idle()
    expect(t.asked).toHaveLength(1)
    const request = t.asked[0]
    expect(request?.page.saved).toEqual(['minu e-post', 'minu telefon'])
    const wire = JSON.stringify(request)
    expect(wire).not.toContain('ralf.tamm@gmail.com')
    expect(wire).not.toContain('+37251234567')
    expect(wire).not.toContain('37251234567')
  })

  it('saved: with nothing saved the request has no saved field at all', async () => {
    const t = setup({ logic: real, box: nothing, ask: () => Promise.resolve(answer({ kind: 'unclear', say: '' })) })
    t.engine.start()
    t.say('ava midagi huvitavat')
    await t.engine.idle()
    expect(t.asked[0]?.page.saved).toBeUndefined()
  })

  it('saved: the rules type a named value into an armed field at once, without asking the model', async () => {
    const t = setup({ logic: real, box: emailField })
    t.engine.setSaved([EMAIL])
    t.engine.start()
    expect(t.instant('minu meil')).toBe(true)
    t.say('minu meil')
    await t.engine.idle()
    expect(t.asked).toHaveLength(0)
    expect(texts(t.ran)).toEqual(['ralf.tamm@gmail.com'])
    expect(t.state.line).toBe(STRINGS.et.inpage.insertedSaved('ralf.tamm@gmail.com', 'minu e-post'))
  })

  it('insertSaved: the model focuses the field, then names the saved value; the engine types the local value', async () => {
    let focused = false
    const answers = [answer({ kind: 'command', command: { kind: 'focusItem', id: 3 } }, 'valin e-posti', false), answer({ kind: 'insertSaved', name: 'minu e-post' }, '', true)]
    const t = setup({
      logic: real,
      box: nothing,
      answers: (c) => {
        if (c.kind === 'focusItem') focused = true
        return { ok: true }
      },
      page: (b) => ({ url: 'https://www.eesti.ee/et/taotlus', title: 'Taotlus', box: focused ? emailField : b, items: FORM_ITEMS, media: null, hints: false }),
      ask: () => Promise.resolve(answers.shift() ?? { error: 'unreachable' }),
    })
    t.engine.setSaved([EMAIL])
    t.engine.start()
    t.say('täida see mu meiliga')
    await t.engine.idle()
    expect(t.asked).toHaveLength(2)
    expect(t.asked[1]?.steps?.[0]?.action).toBe('command focusItem 3')
    expect(t.ran.filter((c) => c.kind === 'setText')).toEqual([{ kind: 'setText', text: 'ralf.tamm@gmail.com' }])
    expect(t.asked.every((r) => !JSON.stringify(r).includes('ralf.tamm'))).toBe(true)
  })

  it('insertSaved: a name the model made up is rejected by pageIntentFrom and nothing is typed', async () => {
    const t = setup({ logic: real, box: nothing, ask: () => Promise.resolve(answer({ kind: 'insertSaved', name: 'ema telefon' }, '', true)) })
    t.engine.setSaved([EMAIL])
    t.engine.start()
    t.say('pane siia see asi mis mul on')
    await t.engine.idle()
    expect(t.ran.some((c) => c.kind === 'setText')).toBe(false)
  })

  it('entry mode (saved values by voice): every utterance goes to the page as savedEntry, instant, never typed, never asked', async () => {
    const t = setup({ logic: real, box: emailField })
    t.engine.start()
    t.engine.setEntry(true)
    expect(t.instant('r')).toBe(true)
    t.partial('ralf')
    t.say('r')
    t.say('katkesta')
    await t.engine.idle()
    expect(t.ran).toEqual([{ kind: 'savedEntry', utterance: 'r' }, { kind: 'savedEntry', utterance: 'katkesta' }])
    expect(t.asked).toHaveLength(0)
    t.engine.setEntry(false)
    expect(t.instant('r')).toBe(false)
  })

  it('entry mode ends when the page does not answer (not in front), and the line says so', async () => {
    const t = setup({ logic: real, box: emailField, answers: (c) => (c.kind === 'savedEntry' ? { ok: false, code: 'not_found', message: 'no page' } : { ok: true }) })
    t.engine.start()
    t.engine.setEntry(true)
    t.say('r')
    await t.engine.idle()
    expect(t.state.line).toBe(STRINGS.et.inpage.entryGone)
    t.say('a')
    await t.engine.idle()
    expect(t.ran.filter((c) => c.kind === 'savedEntry')).toHaveLength(1)
  })
})

// ---------- document mode (29.2) ----------

/** The real core, so the engine's document mode is tested with the rules it runs in the extension. */
const REAL: InpageLogic = { initialInpage, inpageStep, inpageResult, inpageInstant, inpagePreview, applyIntent, pageIntentFrom }

interface DocOptions {
  ask?: (request: IntentRequest) => Promise<IntentAnswer | AskFailure>
}

/** An engine on one page whose box keeps its document flag (the shared setup's page does not). */
function docSetup(start: BoxState, options: DocOptions = {}) {
  let handlers: EngineHandlers | null = null
  let page: BoxState = { ...start }
  const ran: BrowserCommand[] = []
  const asked: IntentRequest[] = []
  const spoken: Array<{ text: string; lang: string }> = []
  const state: Partial<StripState> = {}
  const engine = createEngine({
    logic: REAL,
    lang: 'et',
    run: async (command) => {
      ran.push(command)
      if (command.kind === 'readBox') return { ok: true, box: { ...page } }
      if (command.kind === 'readPage') return { ok: true, page: { url: 'https://kirjand.example/', title: 'Kirjand', box: { ...page }, items: [], media: null, hints: false } }
      if (command.kind === 'setText') page = { ...page, text: command.text }
      if (command.kind === 'format' && command.style === 'paragraph') page = { ...page, text: `${page.text}\n` }
      return { ok: true, box: { ...page } }
    },
    publish: (patch) => {
      Object.assign(state, patch)
    },
    recognizer: (h) => {
      handlers = h
      return { supported: true, start: () => undefined, stop: () => undefined, setLang: () => undefined }
    },
    micBlocked: () => undefined,
    ask: (request) => {
      asked.push(request)
      return options.ask ? options.ask(request) : Promise.resolve({ error: 'unreachable' })
    },
    tabs: () => Promise.resolve([]),
    status: () => Promise.resolve('live'),
    speak: (text, lang, onEnd) => {
      spoken.push({ text, lang })
      onEnd()
    },
  })
  engine.start()
  return {
    engine,
    ran,
    asked,
    spoken,
    state,
    say: (text: string): void => handlers?.onUtterance(text),
    page: () => page,
  }
}

const DOC = (text: string): BoxState => ({ present: true, text, armed: true, document: true })
const CHAT = (text: string): BoxState => ({ present: true, text, armed: true, kind: 'composer' })

describe('document mode (29.2): the engine', () => {
  const WORDS: ReadonlyArray<readonly [string, BrowserCommand['kind']]> = [
    ['välja', 'pressKey'],
    ['sulge', 'closeTab'],
    ['edasi', 'history'],
    ['tagasi', 'history'],
    ['paus', 'media'],
  ]
  for (const [word, kind] of WORDS) {
    it(`document mode: in it, "${word}" is typed into the document and nothing else runs`, async () => {
      const t = docSetup(DOC('Ta läks'))
      t.say(word)
      await t.engine.idle()
      expect(t.page().text).toBe(`Ta läks ${word}`)
      expect(t.ran.map((c) => c.kind).filter((k) => k !== 'readBox')).toEqual(['setText'])
      expect(t.asked).toHaveLength(0)
    })
    it(`document mode: outside it, "${word}" in an empty chat box runs ${kind}`, async () => {
      const t = docSetup(CHAT(''))
      t.say(word)
      await t.engine.idle()
      expect(t.page().text).toBe('')
      expect(t.ran.map((c) => c.kind)).toContain(kind)
    })
  }

  it('document mode: dictation goes straight in, the model is never asked to verify it', async () => {
    const t = docSetup(DOC('Eesti suvi on lühike.'), { ask: () => Promise.resolve({ intent: { kind: 'command', command: { kind: 'scroll', direction: 'down' } }, say: 'kerin' }) })
    t.say('päike paistab hilisõhtuni ja metsad on täis marju')
    await t.engine.idle()
    expect(t.asked).toHaveLength(0)
    expect(t.page().text).toBe('Eesti suvi on lühike. Päike paistab hilisõhtuni ja metsad on täis marju')
  })

  it('document mode: outside it, the same dictation is verified (and a command verdict takes it back)', async () => {
    const t = docSetup(CHAT('Tere.'), { ask: () => Promise.resolve({ intent: { kind: 'command', command: { kind: 'scroll', direction: 'down' } }, say: 'kerin' }) })
    t.say('päike paistab hilisõhtuni')
    await t.engine.idle()
    expect(t.asked).toHaveLength(1)
    expect(t.page().text).toBe('Tere.')
  })

  it('document mode: an utterance with a command verb is asked before anything is typed; its dictation verdict types it', async () => {
    const t = docSetup(DOC('Eesti suvi on lühike.'), { ask: () => Promise.resolve({ intent: { kind: 'dictate', text: 'muuda maailma paremaks' }, say: '' }) })
    t.say('muuda maailma paremaks')
    await t.engine.idle()
    expect(t.asked).toHaveLength(1)
    // Only the model's typing: nothing was typed first and taken back.
    expect(t.ran.filter((c) => c.kind === 'setText')).toEqual([{ kind: 'setText', text: 'Eesti suvi on lühike. Muuda maailma paremaks' }])
  })

  it('document mode: an utterance with a command verb and no model is typed by the rules', async () => {
    const t = docSetup(DOC('Eesti suvi on lühike.'))
    t.say('vali hea pealkiri')
    await t.engine.idle()
    expect(t.asked).toHaveLength(1)
    expect(t.page().text).toBe('Eesti suvi on lühike. Vali hea pealkiri')
  })

  it('document mode: "saada" sends nothing and the strip says so', async () => {
    const t = docSetup(DOC('Eesti suvi on lühike.'))
    t.say('saada')
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind).filter((k) => k !== 'readBox')).toEqual([])
    expect(t.state.line).toBe('Dokumendis ei saadeta.')
    expect(t.page().text).toBe('Eesti suvi on lühike.')
  })
})

describe('document mode (29.2): a pause does not end the sentence', () => {
  it('pause: 15 s between the two halves of a sentence yields one sentence', async () => {
    vi.useFakeTimers()
    const t = docSetup(DOC(''))
    t.say('minu arvates on see')
    await vi.advanceTimersByTimeAsync(15_000)
    t.say('väga hea mõte')
    await vi.advanceTimersByTimeAsync(100)
    await t.engine.idle()
    expect(t.page().text).toBe('Minu arvates on see väga hea mõte')
  })

  it('pause: 25 s between them yields two sentences', async () => {
    vi.useFakeTimers()
    const t = docSetup(DOC(''))
    t.say('minu arvates on see')
    await vi.advanceTimersByTimeAsync(25_000)
    t.say('väga hea mõte')
    await vi.advanceTimersByTimeAsync(100)
    await t.engine.idle()
    expect(t.page().text).toBe('Minu arvates on see. Väga hea mõte')
  })

  it('pause: the window runs from the last final, so three halves 15 s apart stay one sentence', async () => {
    vi.useFakeTimers()
    const t = docSetup(DOC(''))
    t.say('minu arvates')
    await vi.advanceTimersByTimeAsync(15_000)
    t.say('on see')
    await vi.advanceTimersByTimeAsync(15_000)
    t.say('väga hea mõte')
    await vi.advanceTimersByTimeAsync(100)
    await t.engine.idle()
    expect(t.page().text).toBe('Minu arvates on see väga hea mõte')
  })

  it('pause: "punkt" and "uus lõik" are the breaks', async () => {
    vi.useFakeTimers()
    const t = docSetup(DOC(''))
    for (const u of ['eesti suvi on lühike', 'punkt', 'päike paistab', 'uus lõik', 'sügis toob vihma']) {
      t.say(u)
      await vi.advanceTimersByTimeAsync(5000)
    }
    await t.engine.idle()
    expect(t.page().text).toBe('Eesti suvi on lühike. Päike paistab\nSügis toob vihma')
    expect(t.ran).toContainEqual({ kind: 'format', style: 'paragraph' })
  })

  it('pause: outside document mode a chat box closes each final as before', async () => {
    vi.useFakeTimers()
    const t = docSetup(CHAT(''))
    t.say('minu arvates on see')
    await vi.advanceTimersByTimeAsync(15_000)
    t.say('väga hea mõte')
    await vi.advanceTimersByTimeAsync(100)
    await t.engine.idle()
    expect(t.page().text).toBe('Minu arvates on see. Väga hea mõte.')
  })
})

describe('reading back (29.2): the engine hands the text to speak', () => {
  it('loe: "loe viimane lause ette" hands exactly the last sentence of the box to speak', async () => {
    const t = docSetup(DOC('Eesti suvi on lühike. Päike paistab hilisõhtuni ja metsad on täis marju.'))
    t.say('loe viimane lause ette')
    await t.engine.idle()
    expect(t.spoken).toEqual([{ text: 'Päike paistab hilisõhtuni ja metsad on täis marju.', lang: 'et-EE' }])
    expect(t.ran.map((c) => c.kind).filter((k) => k !== 'readBox')).toEqual([])
    expect(t.asked).toHaveLength(0)
  })

  it('loe: "loe see ette" hands the whole box, in a chat box too', async () => {
    const t = docSetup(CHAT('Tere. Jõuan homme.'))
    t.say('loe see ette')
    await t.engine.idle()
    expect(t.spoken).toEqual([{ text: 'Tere. Jõuan homme.', lang: 'et-EE' }])
  })
})
// ---------- wake word and places (29.4) ----------
/** Round 8: a logic that records what reached the rules. */
const recording = (seen: string[], base: InpageLogic = logic): InpageLogic => ({
  ...base,
  inpageStep: (session, utterance, box) => {
    if (box !== SEND_PROBE_BOX) seen.push(utterance)
    return base.inpageStep(session, utterance, box)
  },
})

describe('wake mode (29.4.1)', () => {
  const DROPPED = [
    'keri alla', 'saada', 'tere Mari', 'ma tahtsin ütelda et tulen', 'ütlesin talle', 'ütles et tuleb', 'ütleb ta', 'mine', 'kas sa kuuled', 'kell on viis',
    'jah', 'ei', 'aitäh', 'kaks', 'see on hea', 'ma ütlen sulle', 'okei', 'vaikus', 'kuule', 'tule siia',
  ]
  const WOKEN: ReadonlyArray<readonly [string, string]> = [
    ['Ütle, keri alla', 'keri alla'],
    ['ütle tere Mari', 'tere Mari'],
    ['ütel jõuan kell viis', 'jõuan kell viis'],
    ['Üтле, aitäh', 'aitäh'],
    ['ütle mine', 'mine'],
    ['ÜTLE homme', 'homme'],
    ['ütle... kas sobib', 'kas sobib'],
    ['Ütle: jah', 'jah'],
    ['ütle vaikus', 'vaikus'],
    ['ütle kaks', 'kaks'],
  ]

  it('wake: 20 finals without the word go nowhere and 10 with it are acted on, the word stripped', async () => {
    const seen: string[] = []
    // No armed box: no dictation window opens, so every final needs the word.
    const t = setup({ logic: recording(seen), box: { present: true, text: '', armed: false }, wakeWord: 'Ütle' })
    t.engine.start()
    expect(t.state.line).toBe(STRINGS.et.wake.prompt('Ütle'))
    for (const final of DROPPED) t.say(final)
    await t.engine.idle()
    expect(seen).toEqual([])
    expect(t.ran.filter((c) => c.kind !== 'readBox')).toEqual([])
    // The strip still shows what was heard.
    expect(t.heard.at(-1)).toBe('tule siia')
    for (const [final] of WOKEN) t.say(final)
    await t.engine.idle()
    expect(seen).toEqual(WOKEN.map(([, want]) => want))
    expect(t.state.wakeOpen ?? false).toBe(false)
  })

  it('wake: a partial is shown but never previewed while the window is closed, and no quick reply skips the gate', async () => {
    const t = setup({ logic: previewing, box: { present: true, text: 'Tere.', armed: true }, wakeWord: 'Ütle' })
    t.engine.start()
    t.partial('ma jõuan')
    await t.engine.idle()
    expect(t.heard.at(-1)).toBe('ma jõuan')
    expect(t.ran).toEqual([])
    expect(t.instant('saada')).toBe(false)
  })

  it('wake: the voice entry flow of Minu andmed is not gated', async () => {
    const t = setup({ wakeWord: 'Ütle' })
    t.engine.start()
    t.engine.setEntry(true)
    t.say('r')
    await t.engine.idle()
    expect(t.ran).toEqual([{ kind: 'savedEntry', utterance: 'r' }])
  })

  it('wake: a continuation of a woken final passes; one of a dropped final is gated on its own', async () => {
    const seen: string[] = []
    const t = setup({ logic: recording(seen), box: { present: true, text: '', armed: false }, wakeWord: 'Ütle' })
    t.engine.start()
    t.say('ütle mine')
    t.continued('ütle mine siis kaks', 'siis kaks')
    t.say('tere')
    t.continued('tere siis vaikus', 'siis vaikus')
    await t.engine.idle()
    expect(seen).toEqual(['mine', 'siis kaks'])
  })
})

describe('the dictation window (29.4.1)', () => {
  const ARMED: BoxState = { present: true, text: '', armed: true }

  it('window: opens on the first woken final into an armed box, stays open for finals without the word, closes after 20 s of silence', async () => {
    vi.useFakeTimers()
    const seen: string[] = []
    const t = setup({ logic: recording(seen), box: ARMED, wakeWord: 'Ütle' })
    t.engine.start()
    t.say('tere')
    await t.engine.idle()
    expect(seen).toEqual([])
    t.say('Ütle, tere Mari')
    await t.engine.idle()
    expect(t.state.wakeOpen).toBe(true)
    t.say('jõuan kell viis')
    await t.engine.idle()
    await vi.advanceTimersByTimeAsync(19_000)
    expect(t.state.wakeOpen).toBe(true)
    // A partial is speech: the window stays open 20 s from it.
    t.partial('ja')
    await vi.advanceTimersByTimeAsync(19_000)
    expect(t.state.wakeOpen).toBe(true)
    t.say('ja siis koju')
    await t.engine.idle()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(t.state.wakeOpen).toBe(false)
    expect(t.state.line).toBe(STRINGS.et.wake.closed)
    t.say('see läheb kuhugi')
    await t.engine.idle()
    expect(seen).toEqual(['tere Mari', 'jõuan kell viis', 'ja siis koju'])
  })

  it('window: "aitab" closes it and types nothing', async () => {
    vi.useFakeTimers()
    const seen: string[] = []
    const t = setup({ logic: recording(seen), box: ARMED, wakeWord: 'Ütle' })
    t.engine.start()
    t.say('ütle tere')
    await t.engine.idle()
    expect(t.state.wakeOpen).toBe(true)
    t.say('aitab')
    await t.engine.idle()
    expect(t.state.wakeOpen).toBe(false)
    expect(t.state.line).toBe(STRINGS.et.wake.closed)
    t.say('veel midagi')
    await t.engine.idle()
    expect(seen).toEqual(['tere'])
  })

  it('window: a plain send is acted on and closes it; a woken command into an armed box does not open it', async () => {
    vi.useFakeTimers()
    const seen: string[] = []
    const t = setup({ logic: recording(seen), box: ARMED, wakeWord: 'Ütle' })
    t.engine.start()
    t.say('ütle mine')
    await t.engine.idle()
    expect(t.state.wakeOpen ?? false).toBe(false)
    t.say('ütle tere')
    await t.engine.idle()
    expect(t.state.wakeOpen).toBe(true)
    t.say('saada')
    await t.engine.idle()
    expect(t.ran.some((c) => c.kind === 'pressSend')).toBe(true)
    expect(t.state.wakeOpen).toBe(false)
    t.say('tere jälle')
    await t.engine.idle()
    expect(seen).toEqual(['mine', 'tere', 'saada'])
  })

  it('window: stopping closes it; the next start needs the word again', async () => {
    vi.useFakeTimers()
    const seen: string[] = []
    const t = setup({ logic: recording(seen), box: ARMED, wakeWord: 'Ütle' })
    t.engine.start()
    t.say('ütle tere')
    await t.engine.idle()
    t.engine.stop()
    expect(t.state.wakeOpen).toBe(false)
    t.engine.start()
    t.say('veel')
    await t.engine.idle()
    expect(seen).toEqual(['tere'])
  })

  it('window: without wake mode nothing is gated and wakeOpen is never published', async () => {
    const seen: string[] = []
    const t = setup({ logic: recording(seen) })
    t.engine.start()
    t.say('tere')
    await t.engine.idle()
    expect(seen).toEqual(['tere'])
    expect(t.state.wakeOpen).toBeUndefined()
  })
})

describe('Minu kohad in the engine (29.4.2)', () => {
  const NO_BOX: BoxState = { present: false, text: '', armed: false }

  it('places: "vaata uudiseid" opens his own address by the rules, before inpage.ts; in an armed box it is words', async () => {
    const seen: string[] = []
    const t = setup({ logic: recording(seen), box: NO_BOX })
    t.engine.setPlaces([{ noun: 'uudised', url: 'https://www.err.ee/', label: 'ERR' }])
    t.say('vaata uudiseid')
    await t.engine.idle()
    expect(t.ran).toContainEqual({ kind: 'goTo', url: 'https://www.err.ee/' })
    expect(seen).toEqual([])
    const armed = setup({ logic: recording(seen), box: { present: true, text: '', armed: true } })
    armed.say('vaata uudiseid')
    await armed.engine.idle()
    expect(seen).toEqual(['vaata uudiseid'])
    expect(armed.ran.some((c) => c.kind === 'goTo')).toBe(false)
  })

  it('places: the model is told the nouns only, and its place answer opens the address from his list', async () => {
    const t = setup({
      logic: asking,
      box: NO_BOX,
      ask: (request) => Promise.resolve(answer(request.page.places?.includes('raadio') === true ? { kind: 'place', noun: 'raadio' } : { kind: 'unclear', say: '' }, 'avan raadio')),
    })
    t.engine.setPlaces([
      { noun: 'raadio', url: 'https://r2.err.ee/', label: 'Raadio 2' },
      { noun: 'ilm', url: 'https://www.ilmateenistus.ee/', label: 'Ilm' },
    ])
    t.say('lase muusikat raadiost')
    await t.engine.idle()
    expect(t.asked[0]?.page.places).toEqual(['raadio', 'ilm'])
    expect(JSON.stringify(t.asked[0])).not.toContain('err.ee')
    expect(t.ran).toContainEqual({ kind: 'goTo', url: 'https://r2.err.ee/' })
  })

  it('places: a noun the model names that is not in his list opens nothing', async () => {
    const t = setup({ logic: asking, box: NO_BOX, ask: () => Promise.resolve(answer({ kind: 'place', noun: 'pank' })) })
    t.say('ava mu pank palun kohe')
    await t.engine.idle()
    expect(t.ran.some((c) => c.kind === 'goTo')).toBe(false)
  })
})
describe('saving a place by voice (29.4.3)', () => {
  const NO_BOX: BoxState = { present: false, text: '', armed: false }
  const onPage = (command: BrowserCommand): BrowserResult =>
    command.kind === 'savePlace' || command.kind === 'removePlace' ? { ok: true, tab: { title: 'Postimees', url: 'https://www.postimees.ee/' } } : { ok: true }

  it('voice place: "lisa koht uudised" sends savePlace for the tab in front and the strip names the address', async () => {
    const seen: string[] = []
    const t = setup({ logic: recording(seen), box: NO_BOX, answers: onPage })
    t.say('lisa koht uudised')
    await t.engine.idle()
    expect(t.ran).toContainEqual({ kind: 'savePlace', noun: 'uudised' })
    expect(t.state.line).toBe('Koht „uudised“ salvestatud: postimees.ee')
    expect(seen).toEqual([])
  })

  it('voice place: "lisa koht" alone asks for the word, and the next final is it', async () => {
    const t = setup({ box: NO_BOX, answers: onPage })
    t.say('lisa koht')
    await t.engine.idle()
    expect(t.state.line).toBe(STRINGS.et.wake.placeAsk)
    expect(t.ran.some((c) => c.kind === 'savePlace')).toBe(false)
    t.say('Uudised.')
    await t.engine.idle()
    expect(t.ran).toContainEqual({ kind: 'savePlace', noun: 'uudised' })
    // Asked once: a later word is ordinary speech again.
    t.say('pank')
    await t.engine.idle()
    expect(t.ran.filter((c) => c.kind === 'savePlace')).toHaveLength(1)
  })

  it('voice place: an answer that is a command ends the question and runs as usual; the question lapses after 20 s', async () => {
    vi.useFakeTimers()
    const seen: string[] = []
    const t = setup({ logic: recording(seen), box: NO_BOX, answers: onPage })
    t.say('lisa koht')
    await t.engine.idle()
    t.say('mine')
    await t.engine.idle()
    expect(seen).toEqual(['mine'])
    t.say('lisa koht')
    await t.engine.idle()
    await vi.advanceTimersByTimeAsync(PLACE_ASK_MS + 1)
    t.say('uudised')
    await t.engine.idle()
    expect(t.ran.some((c) => c.kind === 'savePlace')).toBe(false)
    expect(seen).toEqual(['mine', 'uudised'])
  })

  it('voice place: "eemalda koht uudised" removes his place; an unknown one is named, with no command', async () => {
    const t = setup({ box: NO_BOX, answers: onPage })
    t.engine.setPlaces([{ noun: 'uudised', url: 'https://www.postimees.ee/', label: 'Postimees' }])
    t.say('eemalda koht uudised')
    await t.engine.idle()
    expect(t.ran).toContainEqual({ kind: 'removePlace', noun: 'uudised' })
    expect(t.state.line).toBe(STRINGS.et.wake.placeRemoved('uudised'))
    t.say('eemalda koht pank')
    await t.engine.idle()
    expect(t.ran.filter((c) => c.kind === 'removePlace')).toHaveLength(1)
    expect(t.state.line).toBe(STRINGS.et.wake.placeNotThere('pank'))
  })

  it('voice place: a page that cannot be saved says so', async () => {
    const t = setup({ box: NO_BOX, answers: (c) => (c.kind === 'savePlace' ? { ok: false, code: 'not_allowed', message: 'chrome://' } : { ok: true }) })
    t.say('see on mu uudised')
    await t.engine.idle()
    expect(t.state.line).toBe(STRINGS.et.wake.placeNotSaved)
  })
})
// ---------- end of wake word and places ----------
// ---------- reading aloud (29.5) ----------
describe('reading aloud (29.5): "stopp" while reading stops the reading first', () => {
  const real: InpageLogic = { initialInpage, inpageStep, inpageResult, inpageInstant, inpagePreview, applyIntent, pageIntentFrom }
  /** An engine on the real rules; reading: undefined leaves the dependency out, as before this round. */
  const make = (reading: (() => boolean) | undefined, box: BoxState) => {
    const ran: BrowserCommand[] = []
    const lines: string[] = []
    const heard: string[] = []
    let handlers: EngineHandlers | null = null
    let page = { ...box }
    const engine = createEngine({
      logic: real,
      lang: 'et',
      run: (command) => {
        ran.push(command)
        if (command.kind === 'readBox') return Promise.resolve({ ok: true, box: { ...page } })
        if (command.kind === 'setText') page = { ...page, text: command.text }
        return Promise.resolve({ ok: true })
      },
      publish: (patch) => {
        if (patch.line !== undefined) lines.push(patch.line)
        if (patch.heard !== undefined) heard.push(patch.heard)
      },
      recognizer: (h) => {
        handlers = h
        return { supported: true, start: () => undefined, stop: () => undefined, setLang: () => undefined }
      },
      micBlocked: () => undefined,
      ask: () => Promise.resolve({ error: 'unreachable' }),
      tabs: () => Promise.resolve([]),
      status: () => Promise.resolve('live'),
      ...(reading === undefined ? {} : { reading }),
    })
    return { engine, ran, lines, heard, say: (t: string) => handlers?.onUtterance(t), continued: (t: string, added: string) => handlers?.onUtteranceContinued(t, added), partial: (t: string) => handlers?.onInterim(t) }
  }
  const WORDS: BoxState = { present: true, text: 'Tere, kuidas läheb', armed: true }
  const EMPTY: BoxState = { present: false, text: '', armed: false }
  const pageCommands = (ran: BrowserCommand[]): BrowserCommand[] => ran.filter((c) => c.kind !== 'readBox')

  for (const word of ['stopp', 'Aitab.', 'stop', 'lõpeta lugemine', 'seis', 'stop reading', 'paus', 'Peata.']) {
    it(`read: "${word}" while reading runs read stop at once (in the handler), and nothing else, even with words in the box`, async () => {
      const t = make(() => true, WORDS)
      t.say(word)
      // In the handler itself: not behind the queue.
      expect(t.ran).toEqual([{ kind: 'read', what: 'stop' }])
      await t.engine.idle()
      expect(pageCommands(t.ran)).toEqual([{ kind: 'read', what: 'stop' }])
      expect(t.lines.at(-1)).toBe('Lugemine seis.')
    })
  }

  it('read: a continued utterance ending in "stopp" while reading stops the reading too', async () => {
    const t = make(() => true, EMPTY)
    t.continued('keri alla stopp', 'stopp')
    await t.engine.idle()
    expect(pageCommands(t.ran)).toEqual([{ kind: 'read', what: 'stop' }])
  })

  it('read: the filter: while reading every other final and every partial is dropped unseen (the echo of the voice is never shown, typed or run)', async () => {
    const t = make(() => true, WORDS)
    t.partial('tartu raamatukogu avab')
    t.say('Tartu raamatukogu avab uue lugemissaali')
    t.say('keri alla')
    t.say('loe edasi')
    t.continued('keri alla ja ava seaded', 'ava seaded')
    await t.engine.idle()
    expect(t.ran).toEqual([])
    expect(t.heard).toEqual([])
    t.say('stopp')
    expect(t.ran).toEqual([{ kind: 'read', what: 'stop' }])
    expect(t.heard).toEqual(['stopp'])
  })

  it('read: the filter ends with the reading: the same words are heard and run again', async () => {
    let reading = true
    const t = make(() => reading, EMPTY)
    t.say('keri alla')
    reading = false
    t.say('keri alla')
    await t.engine.idle()
    expect(pageCommands(t.ran)).toEqual([{ kind: 'scroll', direction: 'down' }])
    expect(t.heard).toEqual(['keri alla'])
  })

  for (const box of [WORDS, EMPTY]) {
    for (const word of ['stopp', 'aitab']) {
      it(`read: "${word}" when not reading does exactly what it did before this round (box ${box.text === '' ? 'empty' : 'with words'})`, async () => {
        const before = make(undefined, box)
        before.say(word)
        await before.engine.idle()
        const now = make(() => false, box)
        now.say(word)
        await now.engine.idle()
        expect(now.ran).toEqual(before.ran)
        expect(now.lines).toEqual(before.lines)
        expect(now.ran.some((c) => c.kind === 'read')).toBe(false)
      })
    }
  }
})

// ---------- the first run (30.1, ONBOARD lane): server-down lines and the connection dot ----------
describe('the server going away and coming back (30.1)', () => {
  const S = STRINGS.et.strip
  const count = (list: string[], value: string): number => list.filter((x) => x === value).length

  it('server down: a local address says the local line once, however often the socket fails; listening stays on', async () => {
    const t = setup()
    t.engine.start()
    await t.engine.idle()
    t.connection('connecting')
    t.connection('down')
    t.connection('down')
    t.connection('down')
    expect(t.state.problem).toBe(S.serverDownLocal)
    expect(count(t.problems, S.serverDownLocal)).toBe(1)
    expect(t.state.listening).toBe(true)
    expect(t.state.connection).toBe('down')
    expect(S.serverDownLocal).toBe('Kõneserver ei vasta. Palu abilisel see käivitada (npm run dev).')
    expect(STRINGS.en.strip.serverDownLocal).toBe('The speech server is not answering. Ask your helper to start it (npm run dev).')
  })

  it('hosted: a hosted address says the hosted line instead', async () => {
    const t = setup({ hosted: true })
    t.engine.start()
    await t.engine.idle()
    t.connection('down')
    expect(t.state.problem).toBe(S.serverDownHosted)
    expect(S.serverDownHosted).toBe('Kõneserver ei vasta. Kontrolli internetiühendust või palu abilisel vaadata serverit.')
    expect(STRINGS.en.strip.serverDownHosted).toBe('The speech server is not answering. Check the internet connection or ask your helper to look at the server.')
  })

  it('server down: a 401 from the status says the wrong-token line, not the down line', async () => {
    const t = setup({ status: 'bad_token', hosted: true })
    t.engine.start()
    await t.engine.idle()
    t.connection('down')
    expect(t.state.problem).toBe(S.badToken)
    expect(t.problems).not.toContain(S.serverDownHosted)
  })

  it('server back: "Server vastab jälle." once when the socket is ready again, and the problem clears', async () => {
    const t = setup()
    t.engine.start()
    await t.engine.idle()
    t.connection('connecting')
    t.connection('connected')
    expect(t.lines).not.toContain(S.serverBack)
    t.connection('down')
    t.connection('connected')
    t.connection('connected')
    expect(t.state.problem).toBe('')
    expect(t.state.line).toBe(S.serverBack)
    expect(count(t.lines, S.serverBack)).toBe(1)
    expect(S.serverBack).toBe('Server vastab jälle.')
    expect(STRINGS.en.strip.serverBack).toBe('The server is answering again.')
    // A second outage is a new one: the line is said again, once.
    t.connection('down')
    t.connection('down')
    t.connection('connected')
    expect(count(t.problems, S.serverDownLocal)).toBe(2)
    expect(count(t.lines, S.serverBack)).toBe(2)
  })

  it('server down: turning listening off ends the outage; the next failing start says the line again', async () => {
    const t = setup()
    t.engine.start()
    await t.engine.idle()
    t.connection('down')
    t.engine.stop()
    t.engine.start()
    t.connection('connecting')
    t.connection('down')
    expect(count(t.problems, S.serverDownLocal)).toBe(2)
    expect(t.lines).not.toContain(S.serverBack)
  })

  it('server down: the connection dot follows the socket (connecting, connected, down)', async () => {
    const t = setup()
    t.engine.start()
    await t.engine.idle()
    t.connection('connecting')
    t.connection('connected')
    t.connection('down')
    t.connection('connected')
    expect(t.connections.slice(-4)).toEqual(['connecting', 'connected', 'down', 'connected'])
  })
})

describe('round 9 (30.5.4): spend per task', () => {
  const unarmed: BoxState = { present: false, text: '', armed: false }
  const armed: BoxState = { present: true, text: 'Tere.', armed: true }
  const goTo = (url: string): IntentAnswer['intent'] => ({ kind: 'command', command: { kind: 'goTo', url } })
  const click = (id: number): IntentAnswer['intent'] => ({ kind: 'command', command: { kind: 'clickItem', id } })
  const SCROLL: IntentAnswer['intent'] = { kind: 'command', command: { kind: 'scroll', direction: 'down' } }
  const USAGE = { input: 100, output: 10, cacheRead: 6900, cacheWrite: 0, provider: 'anthropic', model: 'claude-sonnet-5-5' }
  const paid = (intent: IntentAnswer['intent'], say: string, done: boolean, plan?: string[]): IntentAnswer => ({ intent, say, done, ...(plan ? { plan } : {}), usage: USAGE })
  const script = (...answers: Array<IntentAnswer | AskFailure>) => {
    let i = 0
    return () => Promise.resolve(answers[Math.min(i++, answers.length - 1)] as IntentAnswer | AskFailure)
  }
  const thenHang = (first: IntentAnswer) => {
    let n = 0
    return (): Promise<IntentAnswer | AskFailure> => (n++ === 0 ? Promise.resolve(first) : new Promise(() => undefined))
  }
  const after = (ms: number, a: IntentAnswer | AskFailure) => new Promise<IntentAnswer | AskFailure>((resolve) => setTimeout(() => resolve(a), ms))

  it('spend: three asks and a failed step make one record, done, with the tokens summed', async () => {
    const t = setup({
      logic: asking,
      box: unarmed,
      answers: (c) => (c.kind === 'clickItem' ? { ok: false, code: 'not_found', message: 'gone' } : { ok: true }),
      // goTo with more to do; a click that misses (asked again although it said done); a scroll that ends it.
      ask: script(paid(goTo('https://www.youtube.com/'), 'lähen', false), paid(click(1), 'mängin', true), paid(SCROLL, 'kerin', true)),
    })
    t.engine.start()
    t.say('mine youtube ja mängi midagi')
    await t.engine.idle()
    expect(t.asked).toHaveLength(3)
    expect(t.spends).toHaveLength(1)
    expect(t.spends[0]).toMatchObject({ outcome: 'done', asks: 3, steps: 3, goals: 1, input: 300, cacheRead: 20_700, output: 30, provider: 'anthropic', model: 'claude-sonnet-5-5' })
    expect(t.spends[0]?.ms).toBeGreaterThanOrEqual(0)
  })

  it('spend: a chain counts its goals and every ask of every goal', async () => {
    const t = setup({
      logic: asking,
      box: unarmed,
      ask: (request) => Promise.resolve(request.chain === undefined ? paid(goTo('https://a.ee/'), 'a', true, ['b', 'c']) : paid(goTo('https://b.ee/'), 'b', true)),
    })
    t.engine.start()
    t.say('a ja b ja c')
    await t.engine.idle()
    expect(t.spends).toEqual([expect.objectContaining({ outcome: 'done', asks: 3, steps: 3, goals: 3, input: 300 })])
  })

  it('spend: a task the rules finish with no model is outcome rules, no asks', async () => {
    const t = setup()
    t.engine.start()
    t.say('tere')
    t.say('vaikus')
    await t.engine.idle()
    expect(t.spends).toEqual([
      { outcome: 'rules', asks: 0, steps: 0, goals: 1, input: 0, cacheRead: 0, output: 0, ms: 0, provider: '', model: '' },
      { outcome: 'rules', asks: 0, steps: 0, goals: 1, input: 0, cacheRead: 0, output: 0, ms: 0, provider: '', model: '' },
    ])
  })

  it('spend: an unclear answer with nothing run is outcome unclear', async () => {
    const t = setup({ logic: asking, box: unarmed, ask: script(paid({ kind: 'unclear', say: 'Mida?' }, '', true)) })
    t.engine.start()
    t.say('kaks kolm neli')
    await t.engine.idle()
    expect(t.spends).toEqual([expect.objectContaining({ outcome: 'unclear', asks: 1, steps: 0, input: 100 })])
  })

  it('spend: an ask with no answer counts as an ask with no tokens, outcome stopped', async () => {
    const t = setup({ logic: asking, box: unarmed, ask: script({ error: 'unreachable' }) })
    t.engine.start()
    t.say('kaks kolm neli')
    await t.engine.idle()
    expect(t.spends).toEqual([expect.objectContaining({ outcome: 'stopped', asks: 1, input: 0, output: 0, provider: '' })])
  })

  it('spend: a type-first dictation reports once, from its verification: done', async () => {
    const t = setup({ logic: asking, box: armed, ask: script(paid({ kind: 'dictate', text: 'tulen' }, '', true)) })
    t.engine.start()
    t.say('tulen')
    await t.engine.idle()
    expect(t.spends).toEqual([expect.objectContaining({ outcome: 'done', asks: 1, steps: 0, input: 100 })])
  })

  it('spend: "katkesta" during a chain records the chain as cancelled, with the asks it made', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: unarmed, ask: thenHang(paid(goTo('https://www.youtube.com/'), 'lähen', true, ['otsi kassivideod', 'mängi esimene'])) })
    t.engine.start()
    t.say("mine youtube'i, otsi kassivideod ja mängi esimene")
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 100)
    t.say('katkesta')
    await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_CAREFUL_MS * 2)
    const chain = t.spends.find((r) => r.asks > 0)
    expect(chain).toMatchObject({ outcome: 'cancelled', asks: 2, input: 100 })
  })

  it('spend: the watchdog records tookTooLong', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: unarmed, goToMs: COMMAND_TIMEOUT_MS - 1000, ask: () => after(13_000, paid(goTo('https://a.ee/'), 'lähen', false)) })
    t.engine.start()
    t.say('ava palun see uus video mis eile tuli')
    await vi.advanceTimersByTimeAsync(JOB_WATCHDOG_MS + 60_000)
    expect(t.spends).toEqual([expect.objectContaining({ outcome: 'tookTooLong', asks: 1, input: 100 })])
  })

  it('spend: the records carry counts and names only, never the words or the page', async () => {
    const t = setup({ logic: asking, box: unarmed, ask: script(paid(goTo('https://www.youtube.com/watch?v=x'), 'avan kassivideo', true)) })
    t.engine.start()
    t.say('ava kassivideo palun')
    await t.engine.idle()
    const text = JSON.stringify(t.spends)
    for (const secret of ['kassivideo', 'youtube', 'avan', 'palun']) expect(text).not.toContain(secret)
    expect(Object.keys(t.spends[0] ?? {}).sort()).toEqual(['asks', 'cacheRead', 'goals', 'input', 'model', 'ms', 'outcome', 'output', 'provider', 'steps'])
  })
})

// Issue #3 work package A: the baseline that fails on main. With Kuula ainult mind on, nothing
// speech-driven may reach the page or the model before the server verified the owner's voice for
// that very segment.
describe('issue #3: only the owner, fail closed in the engine', () => {
  it('a partial with only-owner on types nothing into the box and is not shown', async () => {
    const t = setup({ onlyOwner: true })
    t.engine.start()
    t.partial('saada')
    t.partial('saada see')
    await t.engine.idle()
    expect(t.ran.filter((c) => c.kind === 'setText')).toEqual([])
    expect(t.heard).toEqual([])
  })

  it('an utterance without a speaker decision runs nothing, asks no model and is not shown', async () => {
    const t = setup({ onlyOwner: true })
    t.engine.start()
    t.say('saada')
    t.say(SENTENCE)
    t.continued(`${SENTENCE} siis saada`, 'siis saada')
    await t.engine.idle()
    expect(t.ran).toEqual([])
    expect(t.asked).toEqual([])
    expect(t.heard).toEqual([])
  })
})

describe('only the owner, the engine wall (round 10, ARCHITECTURE 31.4): zero side effects per deny case', () => {
  const decided = (reason: SpeakerReason, over: Partial<SpeakerDecision> = {}): SpeakerDecision => ({ segmentId: 1, sessionId: 's', profileVersion: 'v1-x', verdict: verdictFor(reason), reason, timings: { judgeMs: 10 }, ...over })
  const say = (t: ReturnType<typeof setup>, text: string, decision?: SpeakerDecision): void => {
    const h = t.handlers()
    if (decision === undefined) h?.onUtterance(text)
    else h?.onUtterance(text, decision)
  }
  /** Nothing ran on the page, nothing was asked of the model, nothing was shown or queued. */
  const nothing = async (t: ReturnType<typeof setup>): Promise<void> => {
    await t.engine.idle()
    expect(t.ran).toEqual([])
    expect(t.asked).toEqual([])
    expect(t.heard).toEqual([])
    expect(t.spends).toEqual([])
  }
  const denials: Array<[string, SpeakerDecision | undefined]> = [
    ['no decision', undefined],
    ...SPEAKER_REASONS.filter((r) => r !== 'verified_owner').map((r): [string, SpeakerDecision] => [r, decided(r)]),
    ['owner verdict without verified_owner', decided('insufficient_audio', { verdict: 'owner' })],
    ['verified_owner reason without the owner verdict', decided('verified_owner', { verdict: 'unknown' })],
  ]
  for (const [name, decision] of denials) {
    it(`denies ${name}: no setText, no command, no /api/intent, no queue, no strip words`, async () => {
      const t = setup({ onlyOwner: true, ask: () => Promise.resolve(answer({ kind: 'command', command: { kind: 'clickItem', id: 3 } }, 'x')) })
      t.engine.start()
      t.partial('saada')
      say(t, 'saada', decision)
      say(t, SENTENCE, decision)
      say(t, 'katkesta', decision)
      say(t, "ava youtube'i", decision)
      t.handlers()?.onUtteranceContinued(`${SENTENCE} siis saada`, 'siis saada', decision)
      await nothing(t)
    })
  }

  it('a verified owner utterance runs as before, and its partials are still never typed', async () => {
    const t = setup({ onlyOwner: true })
    t.engine.start()
    t.partial('tere')
    say(t, 'tere', decided('verified_owner'))
    await t.engine.idle()
    expect(t.ran).toEqual([{ kind: 'readBox' }, { kind: 'setText', text: 'xtere' }])
    expect(t.heard).toEqual(['tere'])
  })

  it('the wake word does not authorize: an unverified "ütle ..." opens nothing and runs nothing', async () => {
    const t = setup({ onlyOwner: true, wakeWord: 'ütle' })
    t.engine.start()
    t.partial('ütle tere')
    say(t, 'ütle tere')
    say(t, 'tere')
    await nothing(t)
  })

  it('the voice entry flow takes nothing unverified', async () => {
    const t = setup({ onlyOwner: true })
    t.engine.start()
    t.engine.setEntry(true)
    say(t, 'minu nimi on Mari', decided('rejected_other'))
    await nothing(t)
  })

  it('with the mode off the handlers are the very same as before', async () => {
    const t = setup()
    t.engine.start()
    t.partial('te')
    say(t, 'tere')
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toContain('setText')
  })
})
