import { describe, expect, it } from 'vitest'
import { FELL_BACK, NOTHING_LEFT } from './asrProtocol.ts'
import { withFallback } from './pick.ts'
import type { Recognizer } from './recognizer.ts'

class FakeEngine implements Recognizer {
  running = false
  lang = ''
  readonly supported: boolean
  constructor(supported: boolean) {
    this.supported = supported
  }
  start(): void {
    this.running = true
  }
  stop(): void {
    this.running = false
  }
  setLang(lang: string): void {
    this.lang = lang
  }
}

describe('choosing the recogniser', () => {
  const setup = (chromeSupported = true) => {
    const notices: string[] = []
    const errors: string[] = []
    let unavailable: () => void = () => {}
    const local = new FakeEngine(true)
    const made: { chrome: FakeEngine | null; lang: string } = { chrome: null, lang: '' }
    const r = withFallback(
      (onUnavailable) => {
        unavailable = onUnavailable
        return local
      },
      (lang) => {
        made.lang = lang
        made.chrome = new FakeEngine(chromeSupported)
        return made.chrome
      },
      'et-EE',
      { onNotice: (m) => notices.push(m), onError: (m) => errors.push(m) },
    )
    return { r, local, made, notices, errors, fail: () => unavailable() }
  }

  it('listens with the local recogniser first', () => {
    const { r, local, made } = setup()
    r.start()
    expect(local.running).toBe(true)
    expect(made.chrome).toBeNull()
  })

  it('switches to Chrome in the current language, keeps listening and says so once', () => {
    const { r, made, notices, errors, fail } = setup()
    r.start()
    r.setLang('en-US')
    fail()
    fail()
    expect(made.chrome?.running).toBe(true)
    expect(made.lang).toBe('en-US')
    expect(notices).toEqual([FELL_BACK])
    expect(errors).toEqual([])
    r.stop()
    expect(made.chrome?.running).toBe(false)
  })

  it('switches without starting when the microphone was off', () => {
    const { r, made, fail } = setup()
    fail()
    expect(made.chrome?.running).toBe(false)
    r.start()
    expect(made.chrome?.running).toBe(true)
  })

  it('reports an error when this browser has no recognition of its own either', () => {
    const { r, errors, notices, fail } = setup(false)
    r.start()
    fail()
    expect(errors).toEqual([NOTHING_LEFT])
    expect(notices).toEqual([])
    expect(r.supported).toBe(false)
  })
})
