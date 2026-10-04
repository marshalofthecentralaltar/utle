import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createScriptedRecognizer } from './scripted.ts'

describe('scripted recogniser', () => {
  let utterances: string[]
  let interims: string[]
  const handlers = {
    onUtterance: (text: string) => utterances.push(text),
    onInterim: (text: string) => interims.push(text),
    onError: () => {},
  }
  const timing = { startMs: 100, wordMs: 100, gapMs: 1000, pauseMs: 700, holdMs: 1200 }
  const isInstant = (text: string): boolean => text.replace(/\W/g, '').toLowerCase() === 'yes'

  beforeEach(() => {
    vi.useFakeTimers()
    utterances = []
    interims = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is supported and silent until started', () => {
    const r = createScriptedRecognizer(handlers, [{ text: 'move risks up' }], { ...timing, isInstant })
    expect(r.supported).toBe(true)
    vi.advanceTimersByTime(10_000)
    expect(utterances).toEqual([])
  })

  it('grows the interim text word by word and then delivers the utterance after the hold', () => {
    const r = createScriptedRecognizer(handlers, [{ text: 'move risks up' }], { ...timing, isInstant })
    r.start()
    vi.advanceTimersByTime(100 + 3 * 100)
    expect(interims.filter(Boolean)).toEqual(['move', 'move risks', 'move risks up'])
    expect(utterances).toEqual([])
    vi.advanceTimersByTime(1200)
    expect(utterances).toEqual(['move risks up'])
  })

  it('delivers an instant line without the hold', () => {
    const r = createScriptedRecognizer(handlers, [{ text: 'Yes.' }], { ...timing, isInstant })
    r.start()
    vi.advanceTimersByTime(100 + 100)
    expect(utterances).toEqual(['Yes.'])
  })

  it('sends a line with a pause as two finals that arrive as one utterance', () => {
    const r = createScriptedRecognizer(
      handlers,
      [{ text: 'change the deadline to Friday', pauseAfterWord: 3 }],
      { ...timing, isInstant },
    )
    r.start()
    vi.advanceTimersByTime(10_000)
    expect(utterances).toEqual(['change the deadline to Friday'])
  })

  it('plays lines in order', () => {
    const r = createScriptedRecognizer(handlers, [{ text: 'move risks up' }, { text: 'Yes.' }], { ...timing, isInstant })
    r.start()
    vi.advanceTimersByTime(20_000)
    expect(utterances).toEqual(['move risks up', 'Yes.'])
  })

  it('stops for good on stop', () => {
    const r = createScriptedRecognizer(handlers, [{ text: 'move risks up' }, { text: 'Yes.' }], { ...timing, isInstant })
    r.start()
    vi.advanceTimersByTime(250)
    r.stop()
    vi.advanceTimersByTime(20_000)
    expect(utterances).toEqual([])
  })
})
