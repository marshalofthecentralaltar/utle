import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoxState, BrowserCommand, BrowserResult } from '../../src/browser/protocol.ts'
import type { RecognizerHandlers } from '../../src/speech/recognizer.ts'
import { STRINGS } from '../../src/core/strings.ts'
import { createEngine } from './engine.ts'
import type { InpageLogic } from './engine.ts'
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
}

function setup(options: Options = {}) {
  const answers = options.answers ?? (() => ({ ok: true }))
  let handlers: RecognizerHandlers | null = null
  let unavailable: (() => void) | null = null
  let instant: ((text: string) => boolean) | null = null
  const ran: BrowserCommand[] = []
  const state: Partial<StripState> = {}
  const heard: string[] = []
  const boxes: BoxState[] = []
  let page: BoxState = options.box ?? { present: true, text: 'x' }
  let inFlight = 0
  let maxInFlight = 0
  let blocked = 0
  let starts = 0
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
      if (command.kind === 'setText') {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        if (options.setTextMs) await new Promise((resolve) => setTimeout(resolve, options.setTextMs))
        inFlight -= 1
        page = { present: page.present, text: command.text }
      }
      return answers(command)
    },
    publish: (patch) => {
      if (patch.heard !== undefined) heard.push(patch.heard)
      Object.assign(state, patch)
    },
    recognizer: (h, isInstant, onUnavailable) => {
      handlers = h
      instant = isInstant
      unavailable = onUnavailable
      return { supported: true, start: () => starts++, stop: () => undefined, setLang: () => undefined }
    },
    micBlocked: () => blocked++,
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
    const t = setup({ logic: previewing, box: { present: true, text: 'Tere.' } })
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
    const t = setup({ logic: previewing, box: { present: true, text: 'Tere.' } })
    t.engine.start()
    t.partial('ma')
    t.partial('ma jõuan')
    await t.engine.idle()
    t.say('ma jõuan')
    await t.engine.idle()
    expect(t.boxes).toEqual([{ present: true, text: 'Tere.' }])
    expect(t.ran.filter((c) => c.kind === 'readBox')).toHaveLength(1)
    expect(t.page().text).toBe('Tere.ma jõuan')
  })

  it('takes back a preview that turns into a possible command, then runs the command', async () => {
    const t = setup({ logic: previewing, box: { present: true, text: 'Tere.' } })
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
    const t = setup({ logic: previewing, box: { present: true, text: 'Tere.' } })
    t.engine.start()
    t.partial('tere')
    await t.engine.idle()
    t.say('saada')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual(['Tere. tere', 'Tere.', 'pressSend'])
  })

  it('a possible command is never typed', async () => {
    const t = setup({ logic: previewing, box: { present: true, text: '' } })
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
    const t = setup({ logic: previewing, box: { present: true, text: 'Tere.' } })
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
    const t = setup({ logic: previewing, box: { present: true, text: '' }, setTextMs: 500 })
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
    const t = setup({ logic: previewing, box: { present: true, text: '' }, setTextMs: 500 })
    t.engine.start()
    t.partial('ma jõuan')
    await vi.advanceTimersByTimeAsync(10)
    t.say('ma jõuan')
    await vi.advanceTimersByTimeAsync(2000)
    expect(texts(t.ran)).toEqual(['ma jõuan', 'ma jõuan'])
    expect(t.maxInFlight()).toBe(1)
  })

  it('types nothing without a box, but the strip shows every partial', async () => {
    const t = setup({ logic: previewing, box: { present: false, text: '' } })
    t.engine.start()
    t.partial('tere')
    t.partial('tere mari')
    await t.engine.idle()
    expect(texts(t.ran)).toEqual([])
    expect(t.heard).toEqual(['tere', 'tere mari'])
  })

  it('the next utterance reads its base after the previous one has been typed', async () => {
    const t = setup({ logic: previewing, box: { present: true, text: '' } })
    t.engine.start()
    t.partial('üks')
    t.say('üks')
    t.partial('kaks')
    await t.engine.idle()
    t.say('kaks')
    await t.engine.idle()
    expect(t.boxes).toEqual([
      { present: true, text: '' },
      { present: true, text: 'üks' },
    ])
  })
})
