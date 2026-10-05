import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWebSpeechRecognizer } from './webSpeech.ts'

/** Stands in for the browser's SpeechRecognition: records every session that is opened. */
class FakeRecognition {
  static made: FakeRecognition[] = []
  continuous = false
  interimResults = false
  maxAlternatives = 1
  lang = ''
  onresult: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null

  constructor() {
    FakeRecognition.made.push(this)
  }

  start(): void {}

  stop(): void {
    this.onend?.()
  }

  /** The browser reports an error and then always ends the session. */
  fail(error: string): void {
    this.onerror?.({ error })
    this.onend?.()
  }
}

describe('Chrome recogniser', () => {
  let errors: string[]
  const handlers = {
    onUtterance: () => {},
    onInterim: () => {},
    onError: (message: string) => errors.push(message),
  }
  const never = (): boolean => false
  const latest = (): FakeRecognition => {
    const session = FakeRecognition.made.at(-1)
    if (!session) throw new Error('no session was opened')
    return session
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { webkitSpeechRecognition: FakeRecognition })
    FakeRecognition.made = []
    errors = []
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('opens a new session when the browser ends one after a silence', () => {
    const r = createWebSpeechRecognizer(handlers, 'en-US', never)
    r.start()
    expect(FakeRecognition.made).toHaveLength(1)
    latest().onend?.()
    vi.advanceTimersByTime(250)
    expect(FakeRecognition.made).toHaveLength(2)
    expect(errors).toEqual([])
  })

  it('keeps listening after an error the user need not see', () => {
    const r = createWebSpeechRecognizer(handlers, 'en-US', never)
    r.start()
    latest().fail('no-speech')
    vi.advanceTimersByTime(250)
    expect(FakeRecognition.made).toHaveLength(2)
    expect(errors).toEqual([])
  })

  it('stops for good when the speech service cannot be reached', () => {
    const r = createWebSpeechRecognizer(handlers, 'en-US', never)
    r.start()
    latest().fail('network')
    vi.advanceTimersByTime(10_000)
    expect(FakeRecognition.made).toHaveLength(1)
    expect(errors).toHaveLength(1)
  })

  it('says to use Google Chrome when the speech service cannot be reached', () => {
    const r = createWebSpeechRecognizer(handlers, 'en-US', never)
    r.start()
    latest().fail('network')
    expect(errors[0]).toMatch(/Google Chrome/)
  })

  it('stops and says so when another tab keeps taking the recogniser', () => {
    const r = createWebSpeechRecognizer(handlers, 'en-US', never)
    r.start()
    for (let i = 0; i < 3; i += 1) {
      latest().fail('aborted')
      vi.advanceTimersByTime(250)
    }
    vi.advanceTimersByTime(10_000)
    expect(FakeRecognition.made).toHaveLength(3)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/another tab/i)
  })

  it('keeps listening when a session is taken once and the next one holds', () => {
    const r = createWebSpeechRecognizer(handlers, 'en-US', never)
    r.start()
    for (let i = 0; i < 5; i += 1) {
      latest().fail('aborted')
      vi.advanceTimersByTime(250)
      latest().onend?.()
      vi.advanceTimersByTime(250)
    }
    expect(FakeRecognition.made).toHaveLength(11)
    expect(errors).toEqual([])
  })

  it('can be started again after it stopped on an error', () => {
    const r = createWebSpeechRecognizer(handlers, 'en-US', never)
    r.start()
    latest().fail('network')
    r.start()
    expect(FakeRecognition.made).toHaveLength(2)
  })

  it('stops for good on stop', () => {
    const r = createWebSpeechRecognizer(handlers, 'en-US', never)
    r.start()
    r.stop()
    vi.advanceTimersByTime(10_000)
    expect(FakeRecognition.made).toHaveLength(1)
  })
})
