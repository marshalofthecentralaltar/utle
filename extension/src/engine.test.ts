import { describe, expect, it } from 'vitest'
import type { BrowserCommand, BrowserResult } from '../../src/browser/protocol.ts'
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
    return { session, commands: [{ kind: 'setText', text: `${box.text}${utterance}` }], line: 'kirjutan' }
  },
  inpageResult: (session, _commands, result) => ({ session, line: result.ok ? 'tehtud' : `viga: ${result.message}` }),
  inpageInstant: (_session, utterance) => utterance === 'saada',
}

function setup(answers: (command: BrowserCommand) => BrowserResult = () => ({ ok: true })) {
  let handlers: RecognizerHandlers | null = null
  let unavailable: (() => void) | null = null
  let instant: ((text: string) => boolean) | null = null
  const ran: BrowserCommand[] = []
  const state: Partial<StripState> = {}
  let blocked = 0
  let starts = 0
  const engine = createEngine({
    logic,
    lang: 'et',
    run: async (command) => {
      ran.push(command)
      if (command.kind === 'readBox') return { ok: true, box: { present: true, text: 'x' } }
      return answers(command)
    },
    publish: (patch) => Object.assign(state, patch),
    recognizer: (h, isInstant, onUnavailable) => {
      handlers = h
      instant = isInstant
      unavailable = onUnavailable
      return { supported: true, start: () => starts++, stop: () => undefined, setLang: () => undefined }
    },
    micBlocked: () => blocked++,
  })
  const say = (text: string): void => handlers?.onUtterance(text)
  return { engine, ran, state, say, unavailable: () => unavailable?.(), error: () => handlers?.onError('x'), instant: (t: string) => instant?.(t), blocked: () => blocked, starts: () => starts }
}

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
    const t = setup((c) => (c.kind === 'setText' ? { ok: false, code: 'not_found', message: 'no box' } : { ok: true }))
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
