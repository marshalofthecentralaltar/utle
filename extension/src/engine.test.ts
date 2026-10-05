import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoxState, BrowserCommand, BrowserResult, PageContext } from '../../src/browser/protocol.ts'
import type { IntentAnswer, IntentRequest, TabSummary } from '../../src/core/pageIntent.ts'
import { pageIntentFrom } from '../../src/core/pageIntent.ts'
import type { RecognizerHandlers } from '../../src/speech/recognizer.ts'
import { STRINGS } from '../../src/core/strings.ts'
import { ASK_TIMEOUT_MS, createEngine } from './engine.ts'
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
const answer = (intent: IntentAnswer['intent'], say = ''): IntentAnswer => ({ intent, say })

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

  it('asks the model about a short dictation into an armed box and runs its step', async () => {
    const t = setup({ logic: asking, box: armed, ask: () => Promise.resolve(answer({ kind: 'command', command: { kind: 'clickItem', id: 3 } }, 'vaata hiljem')) })
    t.engine.start()
    t.say('pane vaata hiljem')
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'clickItem'])
    expect(t.thinking).toEqual([true, false])
    expect(t.asked).toHaveLength(1)
    expect(t.asked[0]).toMatchObject({ lang: 'et', utterance: 'pane vaata hiljem', tabs: TABS, recent: [] })
    expect(t.asked[0]?.page.items).toEqual(ITEMS)
    expect(t.state.line).toBe('tehtud')
    expect(t.state.modelProblem).toBe('')
  })

  it('shows the thinking line while it waits', async () => {
    let seen = ''
    const t = setup({
      logic: asking,
      box: armed,
      ask: () => {
        seen = t.state.line ?? ''
        return Promise.resolve(answer({ kind: 'unclear', say: 'Mida?' }))
      },
    })
    t.engine.start()
    t.say('hm')
    await t.engine.idle()
    expect(seen).toBe(STRINGS.et.inpage.thinking)
    expect(t.state.thinking).toBe(false)
    expect(t.state.line).toBe('Mida?')
  })

  it('does not ask about a long utterance into an armed box: that is a sentence', async () => {
    const t = setup({ logic: asking, box: armed })
    t.engine.start()
    t.say('ma jõuan homme kella kolmeks sinna kui buss õigel ajal tuleb')
    await t.engine.idle()
    expect(t.asked).toHaveLength(0)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'setText'])
    expect(t.thinking).toEqual([])
  })

  it('asks about a long utterance when the box is not armed', async () => {
    const t = setup({ logic: asking, box: { present: true, text: '', armed: false }, ask: () => Promise.resolve(answer({ kind: 'command', command: { kind: 'scroll', direction: 'down' } })) })
    t.engine.start()
    t.say('ma jõuan homme kella kolmeks sinna kui buss õigel ajal tuleb')
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
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'setText', 'readBox', 'readPage', 'setText'])
    expect(t.state.modelProblem).toBe(STRINGS.et.inpage.modelOff)
    expect(t.modelProblems).toEqual(['', STRINGS.et.inpage.modelOff])
    expect(t.thinking).toEqual([true, false, true, false])
  })

  it('when the server cannot be reached, the rules\' step runs silently', async () => {
    const t = setup({ logic: asking, box: armed, ask: () => Promise.resolve({ error: 'unreachable' }) })
    t.engine.start()
    t.say('tere')
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'setText'])
    expect(t.state.line).toBe('tehtud')
    expect(t.state.modelProblem).toBe('')
    expect(t.state.thinking).toBe(false)
  })

  it('a bad answer falls back to the rules\' step', async () => {
    const t = setup({ logic: asking, box: armed, ask: () => Promise.resolve({ error: 'bad' }) })
    t.engine.start()
    t.say('tere')
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'setText'])
  })

  it('an answer about an item the page does not have is not understood', async () => {
    const t = setup({ logic: asking, box: armed, ask: () => Promise.resolve(answer({ kind: 'command', command: { kind: 'clickItem', id: 99 } })) })
    t.engine.start()
    t.say('vajuta sinna')
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage'])
    expect(t.state.line).toBe('ei saanud aru')
  })

  it('gives up on the model after the timeout and runs the rules\' step', async () => {
    vi.useFakeTimers()
    const t = setup({ logic: asking, box: armed, ask: () => new Promise(() => undefined) })
    t.engine.start()
    t.say('tere')
    await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_MS - 1)
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage'])
    await vi.advanceTimersByTimeAsync(2)
    await t.engine.idle()
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'setText'])
    expect(t.state.thinking).toBe(false)
  })

  it('takes back the preview typed while he spoke when the model answers a command', async () => {
    const t = setup({ logic: { ...asking, inpagePreview: previewing.inpagePreview }, box: armed, ask: () => Promise.resolve(answer({ kind: 'command', command: { kind: 'clickItem', id: 2 } })) })
    t.engine.start()
    t.partial('vajuta')
    await t.engine.idle()
    t.say('vajuta otsi')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['Tere. vajuta', 'readPage', 'Tere.', 'clickItem'])
    expect(t.page().text).toBe('Tere.')
    // The model saw the box as it was before the words, not with the preview in it.
    expect(t.asked[0]?.page.box.text).toBe('Tere.')
  })

  it('keeps the preview when the model answers dictation', async () => {
    const t = setup({ logic: { ...asking, inpagePreview: previewing.inpagePreview }, box: armed, ask: () => Promise.resolve(answer({ kind: 'dictate', text: ' tulen' })) })
    t.engine.start()
    t.partial('tulen')
    await t.engine.idle()
    t.say('tulen')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['Tere. tulen', 'readPage', 'Tere. tulen'])
  })

  it('tells the model the last three lines', async () => {
    const t = setup({ logic: asking, box: armed, ask: () => Promise.resolve(answer({ kind: 'unclear', say: '' })) })
    t.engine.start()
    for (const word of ['a', 'b', 'c']) {
      t.say(word)
      await t.engine.idle()
    }
    t.say('d')
    await t.engine.idle()
    expect(t.asked.map((r) => r.recent)).toEqual([[], ['ei saanud aru'], ['ei saanud aru', 'ei saanud aru'], ['ei saanud aru', 'ei saanud aru', 'ei saanud aru']])
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
    expect(t.ran.map((c) => c.kind)).toEqual(['readBox', 'readPage', 'pressSend'])
  })

  it('clips the lines it tells the model, so a long line never makes the request a 400', async () => {
    const long = 'x'.repeat(260)
    const wordy: InpageLogic = { ...asking, applyIntent: (session) => ({ session, commands: [], line: long }) }
    const t = setup({ logic: wordy, box: armed, ask: () => Promise.resolve(answer({ kind: 'unclear', say: '' })) })
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
