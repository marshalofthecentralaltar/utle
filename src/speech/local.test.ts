import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTANT_SETTLE_MS, LOCAL_HOLD_MS } from './asrProtocol.ts'
import { createLocalRecognizer } from './local.ts'
import type { AudioSource, SocketEvents, SocketLike } from './local.ts'

/** Stands in for the browser's WebSocket: records what is sent and lets the test play the server. */
class FakeSocket implements SocketLike {
  static made: FakeSocket[] = []
  readyState = 0
  sent: unknown[] = []
  closed = false
  private readonly events: SocketEvents

  constructor(events: SocketEvents) {
    this.events = events
    FakeSocket.made.push(this)
  }
  send(data: ArrayBuffer): void {
    this.sent.push(data)
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    this.readyState = 3
    this.events.close()
  }
  /** The server answers. */
  says(message: object): void {
    this.readyState = 1
    this.events.message(JSON.stringify(message))
  }
  /** The connection fails or drops. */
  drops(): void {
    this.close()
  }
}

class FakeAudio implements AudioSource {
  static made: FakeAudio[] = []
  onFrame: ((samples: Float32Array<ArrayBuffer>) => void) | null = null
  stopped = false
  fail = false
  constructor() {
    FakeAudio.made.push(this)
  }
  start(onFrame: (samples: Float32Array<ArrayBuffer>) => void): Promise<void> {
    if (this.fail) return Promise.reject(new Error('NotAllowedError'))
    this.onFrame = onFrame
    return Promise.resolve()
  }
  stop(): void {
    this.stopped = true
  }
}

describe('local recogniser (browser side)', () => {
  let utterances: string[]
  let interims: string[]
  let errors: string[]
  let unavailable: number
  let failMic: boolean

  const handlers = {
    onUtterance: (text: string) => utterances.push(text),
    onInterim: (text: string) => interims.push(text),
    onError: (message: string) => errors.push(message),
  }
  const isInstant = (text: string): boolean => text === 'jah'
  const make = () =>
    createLocalRecognizer(handlers, isInstant, {
      onUnavailable: () => (unavailable += 1),
      connect: (events) => new FakeSocket(events),
      audio: () => {
        const audio = new FakeAudio()
        audio.fail = failMic
        return audio
      },
    })
  const socket = (): FakeSocket => {
    const s = FakeSocket.made.at(-1)
    if (!s) throw new Error('no socket was opened')
    return s
  }

  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.made = []
    FakeAudio.made = []
    utterances = []
    interims = []
    errors = []
    unavailable = 0
    failMic = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens the microphone only when the server is ready, and streams its frames', async () => {
    const r = make()
    r.start()
    expect(FakeAudio.made).toHaveLength(0)
    socket().says({ type: 'ready' })
    await Promise.resolve()
    const frame = new Float32Array([0.1, 0.2])
    FakeAudio.made[0]?.onFrame?.(frame)
    expect(socket().sent).toEqual([frame.buffer])
  })

  it('shows a partial as interim and sends a final through the assembler', () => {
    const r = make()
    r.start()
    socket().says({ type: 'ready' })
    socket().says({ type: 'partial', text: 'ava uus' })
    expect(interims.at(-1)).toBe('ava uus')
    socket().says({ type: 'final', text: 'ava uus vaheleht' })
    expect(interims.at(-1)).toBe('')
    expect(utterances).toEqual([])
    vi.advanceTimersByTime(LOCAL_HOLD_MS - 1)
    expect(utterances).toEqual([])
    vi.advanceTimersByTime(1)
    expect(utterances).toEqual(['ava uus vaheleht'])
  })

  it('joins two finals across a pause, and releases a quick reply at once', () => {
    const r = make()
    r.start()
    socket().says({ type: 'ready' })
    socket().says({ type: 'final', text: 'kirjuta Marile' })
    vi.advanceTimersByTime(300)
    socket().says({ type: 'partial', text: 'et' })
    vi.advanceTimersByTime(300)
    socket().says({ type: 'final', text: 'et ma jõuan' })
    vi.advanceTimersByTime(LOCAL_HOLD_MS)
    expect(utterances).toEqual(['kirjuta Marile et ma jõuan'])

    socket().says({ type: 'final', text: 'jah' })
    expect(utterances.at(-1)).toBe('jah')
  })

  it('releases a quick reply from a partial that has settled, and not again when its final arrives', () => {
    const r = make()
    r.start()
    socket().says({ type: 'ready' })
    socket().says({ type: 'partial', text: 'jah' })
    vi.advanceTimersByTime(INSTANT_SETTLE_MS - 1)
    expect(utterances).toEqual([])
    vi.advanceTimersByTime(1)
    expect(utterances).toEqual(['jah'])
    expect(interims.at(-1)).toBe('')

    // The server's final for the same word, with its own casing and punctuation, is swallowed.
    socket().says({ type: 'partial', text: 'Jah.' })
    vi.advanceTimersByTime(INSTANT_SETTLE_MS)
    socket().says({ type: 'final', text: 'Jah.' })
    vi.advanceTimersByTime(5000)
    expect(utterances).toEqual(['jah'])

    // A later, different utterance still arrives.
    socket().says({ type: 'partial', text: 'muuda pealkirja' })
    socket().says({ type: 'final', text: 'muuda pealkirja' })
    vi.advanceTimersByTime(LOCAL_HOLD_MS)
    expect(utterances).toEqual(['jah', 'muuda pealkirja'])
  })

  it('drops a final that hears the released command again a little differently', () => {
    const r = make()
    r.start()
    socket().says({ type: 'ready' })
    for (const [partial, final] of [['jah', 'Jahh.'], ['jah', 'Jah ja']] as const) {
      socket().says({ type: 'partial', text: partial })
      vi.advanceTimersByTime(INSTANT_SETTLE_MS)
      socket().says({ type: 'final', text: final })
      vi.advanceTimersByTime(5000)
    }
    expect(utterances).toEqual(['jah', 'jah'])
  })

  it('delivers only the new words when speech goes on after a released quick reply', () => {
    const r = make()
    r.start()
    socket().says({ type: 'ready' })
    socket().says({ type: 'partial', text: 'jah' })
    vi.advanceTimersByTime(INSTANT_SETTLE_MS)
    socket().says({ type: 'partial', text: 'jah, aga muuda' })
    socket().says({ type: 'final', text: 'Jah, aga muuda pealkirja.' })
    vi.advanceTimersByTime(LOCAL_HOLD_MS)
    expect(utterances).toEqual(['jah', 'aga muuda pealkirja.'])
  })

  it('does not release a quick reply early when the partial grows before it settles', () => {
    const r = make()
    r.start()
    socket().says({ type: 'ready' })
    socket().says({ type: 'partial', text: 'jah' })
    vi.advanceTimersByTime(INSTANT_SETTLE_MS - 100)
    socket().says({ type: 'partial', text: 'jah, aga muuda pealkirja' })
    vi.advanceTimersByTime(INSTANT_SETTLE_MS * 3)
    expect(utterances).toEqual([])
    socket().says({ type: 'final', text: 'jah, aga muuda pealkirja' })
    vi.advanceTimersByTime(LOCAL_HOLD_MS)
    expect(utterances).toEqual(['jah, aga muuda pealkirja'])
  })

  it('does not release a quick reply from a partial while an earlier final is held', () => {
    const r = make()
    r.start()
    socket().says({ type: 'ready' })
    socket().says({ type: 'final', text: 'kirjuta' })
    socket().says({ type: 'partial', text: 'jah' })
    vi.advanceTimersByTime(INSTANT_SETTLE_MS)
    expect(utterances).toEqual([])
    socket().says({ type: 'final', text: 'jah' })
    vi.advanceTimersByTime(LOCAL_HOLD_MS)
    expect(utterances).toEqual(['kirjuta jah'])
  })

  it('gives up at once when the server says the model is unavailable', () => {
    const r = make()
    r.start()
    socket().says({ type: 'unavailable', reason: 'model_missing' })
    socket().close()
    expect(unavailable).toBe(1)
    vi.advanceTimersByTime(10_000)
    expect(FakeSocket.made).toHaveLength(1)
    expect(errors).toEqual([])
  })

  it('gives up at once when the socket is refused', () => {
    const r = make()
    r.start()
    socket().drops()
    expect(unavailable).toBe(1)
    vi.advanceTimersByTime(10_000)
    expect(FakeSocket.made).toHaveLength(1)
  })

  it('reconnects a dropped connection, a bounded number of times', async () => {
    const r = make()
    r.start()
    socket().says({ type: 'ready' })
    await Promise.resolve()
    socket().drops()
    expect(FakeAudio.made[0]?.stopped).toBe(true)
    vi.advanceTimersByTime(500)
    expect(FakeSocket.made).toHaveLength(2)
    // Back again: the count of tries starts over.
    socket().says({ type: 'ready' })
    socket().drops()
    for (let i = 0; i < 3; i += 1) {
      vi.advanceTimersByTime(500)
      socket().drops()
    }
    expect(FakeSocket.made).toHaveLength(5)
    expect(unavailable).toBe(1)
    vi.advanceTimersByTime(10_000)
    expect(FakeSocket.made).toHaveLength(5)
  })

  it('stop closes the socket and the microphone and opens nothing again', async () => {
    const r = make()
    r.start()
    socket().says({ type: 'ready' })
    await Promise.resolve()
    socket().says({ type: 'final', text: 'pooleli' })
    r.stop()
    expect(socket().closed).toBe(true)
    expect(FakeAudio.made[0]?.stopped).toBe(true)
    vi.advanceTimersByTime(10_000)
    expect(FakeSocket.made).toHaveLength(1)
    expect(utterances).toEqual([])
    expect(unavailable).toBe(0)
    expect(interims.at(-1)).toBe('')
  })

  it('says so and stops when the microphone is blocked', async () => {
    failMic = true
    const r = make()
    r.start()
    socket().says({ type: 'ready' })
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(socket().closed).toBe(true)
    expect(unavailable).toBe(0)
  })
})
