import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoxState, BrowserCommand, BrowserResult, PageContext } from '../../src/browser/protocol.ts'
import type { IntentAnswer, IntentRequest, TabSummary } from '../../src/core/pageIntent.ts'
import { pageIntentFrom } from '../../src/core/pageIntent.ts'
import type { RecognizerHandlers } from '../../src/speech/recognizer.ts'
import { STRINGS } from '../../src/core/strings.ts'
import { ASK_TIMEOUT_MS, INTENT_LOOP_BUDGET_MS, LONG_UTTERANCE_WORDS, MAX_STEP_FAILURES, SETTLE_MS, createEngine } from './engine.ts'
import { MAX_INTENT_STEPS } from '../../src/core/pageIntent.ts'
import type { AskFailure, InpageLogic } from './engine.ts'
import type { StripState } from './messages.ts'

const logic: InpageLogic = {
  initialInpage: (lang) => ({ lang, asleep: false, hints: false, undo: [] }),
  inpageStep: (session, utterance, box) => {
    if (utterance === 'kaks') return { session, commands: [{ kind: 'setText', text: 'a' }, { kind: 'pressSend' }], line: 'kaks' }
    if (utterance === 'vaikus') return { session, commands: [], line: 'midagi' }
    if (utterance === 'saada') return { session, commands: [{ kind: 'pressSend' }], line: 'saadan' }
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
  /** The model's answer. Default: unreachable. */
  ask?: (request: IntentRequest) => Promise<IntentAnswer | AskFailure>
  /** The page's readPage answer. Default: the box, three items, no media. */
  page?: (box: BoxState) => PageContext
  tabs?: TabSummary[]
  status?: 'live' | 'no_key' | 'unreachable'
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
  let handlers: RecognizerHandlers | null = null
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
  const thinking: boolean[] = []
  const modelProblems: string[] = []
  const used = options.logic ?? logic
  const engine = createEngine({
    logic: {
      ...used,
      inpageStep: (session, utterance, box) => {
        boxes.push(box)
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
      Object.assign(state, patch)
    },
    recognizer: (h, isInstant, onUnavailable) => {
      handlers = h
      instant = isInstant
      unavailable = onUnavailable
      return { supported: true, start: () => starts++, stop: () => undefined, setLang: () => undefined }
    },
    micBlocked: () => blocked++,
    ask: (request) => {
      asked.push(request)
      return options.ask ? options.ask(request) : Promise.resolve({ error: 'unreachable' })
    },
    tabs: () => Promise.resolve(options.tabs ?? TABS),
    status: () => Promise.resolve(options.status ?? 'live'),
  })
  const say = (text: string): void => handlers?.onUtterance(text)
  const partial = (text: string): void => handlers?.onInterim(text)
  return {
    engine,
    ran,
    state,
    heard,
    boxes,
    say,
    partial,
    page: () => page,
    maxInFlight: () => maxInFlight,
    unavailable: () => unavailable?.(),
    error: () => handlers?.onError('x'),
    instant: (t: string) => instant?.(t),
    blocked: () => blocked,
    starts: () => starts,
    asked,
    thinking,
    modelProblems,
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
    expect(SENTENCE.split(' ').length).toBeGreaterThanOrEqual(LONG_UTTERANCE_WORDS)
    t.say(SENTENCE)
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
    expect(seen).toEqual([
      { thinking: true, line: STRINGS.et.inpage.thinking },
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
