import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONNECTIVE_HOLD_MS } from '../core/chain.ts'
import { INSTANT_SETTLE_MS, LOCAL_HOLD_MS, SPEAKER_REASONS, verdictFor } from './asrProtocol.ts'
import type { SpeakerDecision, SpeakerReason } from './asrProtocol.ts'
import { MAX_BUFFERED_BYTES, RECONNECT_MS, RETRAIN_AFTER_DROPS, createLocalRecognizer, dropsFinal, retrainDue } from './local.ts'
import type { AudioSource, SocketEvents, SocketLike } from './local.ts'

/** Stands in for the browser's WebSocket: records what is sent and lets the test play the server. */
class FakeSocket implements SocketLike {
  static made: FakeSocket[] = []
  readyState = 0
  bufferedAmount = 0
  sent: unknown[] = []
  closed = false
  private readonly events: SocketEvents

  constructor(events: SocketEvents) {
    this.events = events
    FakeSocket.made.push(this)
  }
  send(data: ArrayBuffer | string): void {
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
  let lags: number[]
  let unavailable: number
  let failMic: boolean

  const handlers = {
    onUtterance: (text: string) => utterances.push(text),
    onInterim: (text: string) => interims.push(text),
    onError: (message: string) => errors.push(message),
    onLag: (ms: number) => lags.push(ms),
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
    lags = []
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

  it('holds a final only holdMs when given one (the extension, 21.3)', () => {
    const r = createLocalRecognizer(handlers, isInstant, {
      onUnavailable: () => (unavailable += 1),
      connect: (events) => new FakeSocket(events),
      audio: () => new FakeAudio(),
      holdMs: 150,
    })
    r.start()
    socket().says({ type: 'ready' })
    socket().says({ type: 'final', text: 'ma jõuan homme' })
    vi.advanceTimersByTime(149)
    expect(utterances).toEqual([])
    vi.advanceTimersByTime(1)
    expect(utterances).toEqual(['ma jõuan homme'])
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

  it("passes the server's lag on, and 0 once it has caught up", () => {
    const r = make()
    r.start()
    socket().says({ type: 'ready' })
    socket().says({ type: 'lag', ms: 1600 })
    socket().says({ type: 'lag', ms: 0 })
    expect(lags).toEqual([1600, 0])
    expect(utterances).toEqual([])
  })

  it('a quick reply released from a partial counts as the last delivery, so "siis ..." soon after continues it (round 5, M8)', () => {
    const continued: Array<[string, string]> = []
    const r = createLocalRecognizer({ ...handlers, onUtteranceContinued: (text, added) => continued.push([text, added]) }, isInstant, {
      onUnavailable: () => (unavailable += 1),
      connect: (events) => new FakeSocket(events),
      audio: () => new FakeAudio(),
    })
    r.start()
    socket().says({ type: 'ready' })
    socket().says({ type: 'partial', text: 'jah' })
    vi.advanceTimersByTime(INSTANT_SETTLE_MS)
    expect(utterances).toEqual(['jah'])
    // The server's own final for it is swallowed, as before.
    socket().says({ type: 'final', text: 'Jah.' })
    // One second later he goes on; the final of that part comes two seconds after its first word.
    vi.advanceTimersByTime(1000)
    socket().says({ type: 'partial', text: 'siis keri' })
    vi.advanceTimersByTime(2000)
    socket().says({ type: 'final', text: 'siis keri alla' })
    vi.advanceTimersByTime(LOCAL_HOLD_MS)
    expect(continued).toEqual([['jah siis keri alla', 'siis keri alla']])
    expect(utterances).toEqual(['jah'])
  })

  it('drops frames while the socket holds more than 2 s of audio unsent, and reports it as lag', async () => {
    const r = make()
    r.start()
    socket().says({ type: 'ready' })
    await Promise.resolve()
    const frame = new Float32Array(1600)
    // 2.5 s queued in the socket: the frame is dropped, the lag is the queue's length.
    socket().bufferedAmount = MAX_BUFFERED_BYTES + 32_000
    FakeAudio.made[0]?.onFrame?.(frame)
    FakeAudio.made[0]?.onFrame?.(frame)
    expect(socket().sent).toEqual([])
    expect(lags).toEqual([2500, 2500])
    // The network takes it again: the next frame goes, and the lag is over.
    socket().bufferedAmount = 0
    FakeAudio.made[0]?.onFrame?.(frame)
    expect(socket().sent).toEqual([frame.buffer])
    expect(lags).toEqual([2500, 2500, 0])
  })

  describe('flush', () => {
    it('asks the server for the final with a text frame, and the final then goes without the hold', () => {
      const r = make()
      r.start()
      socket().says({ type: 'ready' })
      socket().says({ type: 'final', text: 'kirjuta Marile' })
      socket().says({ type: 'partial', text: 'et ma' })
      r.flush?.()
      expect(socket().sent).toEqual(['{"type":"flush"}'])
      // The held final waits for the one the server owes, so the two join.
      expect(utterances).toEqual([])
      socket().says({ type: 'final', text: 'et ma jõuan' })
      expect(utterances).toEqual(['kirjuta Marile et ma jõuan'])
      // The next final is held as usual.
      socket().says({ type: 'final', text: 'homme' })
      expect(utterances).toEqual(['kirjuta Marile et ma jõuan'])
      vi.advanceTimersByTime(LOCAL_HOLD_MS)
      expect(utterances).toEqual(['kirjuta Marile et ma jõuan', 'homme'])
    })

    it('delivers what is held at once when nothing is in progress', () => {
      const r = make()
      r.start()
      socket().says({ type: 'ready' })
      socket().says({ type: 'final', text: 'ma jõuan homme' })
      r.flush?.()
      expect(utterances).toEqual(['ma jõuan homme'])
      expect(socket().sent).toEqual(['{"type":"flush"}'])
    })

    it('releases a settling quick reply at once and swallows its final', () => {
      const r = make()
      r.start()
      socket().says({ type: 'ready' })
      socket().says({ type: 'partial', text: 'jah' })
      vi.advanceTimersByTime(100)
      r.flush?.()
      expect(utterances).toEqual(['jah'])
      expect(interims.at(-1)).toBe('')
      socket().says({ type: 'final', text: 'Jah.' })
      vi.advanceTimersByTime(5000)
      expect(utterances).toEqual(['jah'])
    })

    it('does not wait for a final that no open socket will send', () => {
      const r = make()
      r.start()
      socket().says({ type: 'ready' })
      socket().says({ type: 'final', text: 'pooleli' })
      socket().says({ type: 'partial', text: 'ja' })
      socket().readyState = 0
      r.flush?.()
      expect(socket().sent).toEqual([])
      expect(utterances).toEqual(['pooleli'])
    })

    it('a partial of the flushed utterance keeps its final going without the hold', () => {
      const r = make()
      r.start()
      socket().says({ type: 'ready' })
      socket().says({ type: 'partial', text: 'ma jõuan' })
      r.flush?.()
      // The frames queued before the flush are still decoded: the text grows, then the final comes.
      socket().says({ type: 'partial', text: 'ma jõuan homme' })
      socket().says({ type: 'final', text: 'ma jõuan homme' })
      expect(utterances).toEqual(['ma jõuan homme'])
    })

    it('a stop before the flushed final arrives delivers the words as last heard, with what is held', () => {
      const r = make()
      r.start()
      socket().says({ type: 'ready' })
      socket().says({ type: 'final', text: 'kirjuta Marile' })
      socket().says({ type: 'partial', text: 'et ma jõuan' })
      r.flush?.()
      expect(utterances).toEqual([])
      r.stop()
      expect(utterances).toEqual(['kirjuta Marile et ma jõuan'])
      // The final that would have come is not delivered twice: the socket is gone.
      socket().says({ type: 'final', text: 'et ma jõuan homme' })
      vi.advanceTimersByTime(LOCAL_HOLD_MS)
      expect(utterances).toEqual(['kirjuta Marile et ma jõuan'])
    })

    it('a stop without a flush drops the utterance in progress and what is held, as before', () => {
      const r = make()
      r.start()
      socket().says({ type: 'ready' })
      socket().says({ type: 'final', text: 'pooleli' })
      socket().says({ type: 'partial', text: 'ja' })
      r.stop()
      expect(utterances).toEqual([])
    })

    it('a stop after the flushed quick reply was released delivers nothing more', () => {
      const r = make()
      r.start()
      socket().says({ type: 'ready' })
      socket().says({ type: 'partial', text: 'jah' })
      vi.advanceTimersByTime(100)
      r.flush?.()
      expect(utterances).toEqual(['jah'])
      r.stop()
      expect(utterances).toEqual(['jah'])
    })

    it('does nothing when not running', () => {
      const r = make()
      r.flush?.()
      expect(FakeSocket.made).toHaveLength(0)
      expect(utterances).toEqual([])
    })
  })

  describe('chains across pauses (round 4)', () => {
    let continued: Array<[string, string]>
    const chaining = () =>
      createLocalRecognizer(
        { ...handlers, onUtteranceContinued: (text: string, added: string) => continued.push([text, added]) },
        isInstant,
        { onUnavailable: () => (unavailable += 1), connect: (events) => new FakeSocket(events), audio: () => new FakeAudio() },
      )

    beforeEach(() => {
      continued = []
    })

    it('holds a final that ends with a connective for CONNECTIVE_HOLD_MS and joins the next one', () => {
      const r = make()
      r.start()
      socket().says({ type: 'ready' })
      socket().says({ type: 'final', text: 'mine whatsappi ja' })
      vi.advanceTimersByTime(CONNECTIVE_HOLD_MS - 1)
      expect(utterances).toEqual([])
      socket().says({ type: 'final', text: 'ava Karin' })
      vi.advanceTimersByTime(LOCAL_HOLD_MS)
      expect(utterances).toEqual(['mine whatsappi ja ava Karin'])
    })

    it('a partial that is a command ending with a connective is not released early', () => {
      const r = make()
      r.start()
      socket().says({ type: 'ready' })
      // isInstant says no for "keri alla ja" (inpageInstant: a connective-ending text is never instant).
      socket().says({ type: 'partial', text: 'keri alla ja' })
      vi.advanceTimersByTime(INSTANT_SETTLE_MS * 2)
      expect(utterances).toEqual([])
    })

    it('a final starting with a connective soon after an utterance continues it through onUtteranceContinued', () => {
      const r = chaining()
      r.start()
      socket().says({ type: 'ready' })
      socket().says({ type: 'final', text: 'mine whatsappi' })
      vi.advanceTimersByTime(LOCAL_HOLD_MS)
      expect(utterances).toEqual(['mine whatsappi'])
      vi.advanceTimersByTime(1000)
      socket().says({ type: 'final', text: 'siis ava Karin' })
      vi.advanceTimersByTime(LOCAL_HOLD_MS)
      expect(utterances).toEqual(['mine whatsappi'])
      expect(continued).toEqual([['mine whatsappi siis ava Karin', 'siis ava Karin']])
    })

    it('without the handler, a connective-led final is an utterance of its own', () => {
      const r = make()
      r.start()
      socket().says({ type: 'ready' })
      socket().says({ type: 'final', text: 'mine whatsappi' })
      vi.advanceTimersByTime(LOCAL_HOLD_MS)
      socket().says({ type: 'final', text: 'siis ava Karin' })
      vi.advanceTimersByTime(LOCAL_HOLD_MS)
      expect(utterances).toEqual(['mine whatsappi', 'siis ava Karin'])
    })
  })

  // The owner's voice (round 4, VOICE lane).

  describe('only the owner (round 4)', () => {
    let foreign: number
    let streaks: number[]
    let enrolled: Array<[boolean, number] | [boolean, number, number]>
    let phrases: number[]
    const voiceHandlers = () => ({
      ...handlers,
      onForeign: (streak: number) => {
        foreign += 1
        streaks.push(streak)
      },
      onEnrolled: (ok: boolean, seconds: number, read?: number) => enrolled.push(read === undefined ? [ok, seconds] : [ok, seconds, read]),
      onEnrolPhrase: (count: number) => phrases.push(count),
    })
    const makeOwner = (onlyOwner: boolean) =>
      createLocalRecognizer(voiceHandlers(), isInstant, {
        onUnavailable: () => (unavailable += 1),
        connect: (events) => new FakeSocket(events),
        audio: () => new FakeAudio(),
        onlyOwner,
        holdMs: 150,
      })
    const texts = (): unknown[] => socket().sent.filter((item) => typeof item === 'string').map((item) => JSON.parse(item as string))
    // Round 10 (31.3): the server announces the session, and each final carries its own decision.
    const SESSION = { sessionId: 'session-1', profileVersion: 'v1-0badcafe' }
    let segment = 0
    const announce = (): void => socket().says({ type: 'speakerSession', ...SESSION })
    const decision = (reason: SpeakerReason, over: Partial<SpeakerDecision> = {}): SpeakerDecision => {
      segment += 1
      return { segmentId: segment, ...SESSION, verdict: verdictFor(reason), reason, score: reason === 'verified_owner' ? 0.7 : 0.2, timings: { judgeMs: 20, speechMs: 1200 }, ...over }
    }
    const ownerFinal = (text: string): SpeakerDecision => {
      const d = decision('verified_owner')
      socket().says({ type: 'final', text, speaker: 'owner', segment: d.segmentId, decision: d })
      return d
    }
    const rejected = (reason: SpeakerReason): void => socket().says({ type: 'rejected', decision: decision(reason) })

    beforeEach(() => {
      foreign = 0
      streaks = []
      enrolled = []
      phrases = []
      segment = 0
    })

    it('tells the server right after ready, and only when the mode is on', () => {
      const r = makeOwner(true)
      r.start()
      socket().says({ type: 'ready' })
      expect(texts()).toEqual([{ type: 'onlyOwner', on: true }])
      r.stop()
      const off = makeOwner(false)
      off.start()
      socket().says({ type: 'ready' })
      expect(texts()).toEqual([])
    })

    it("drops someone else's utterance (rejected, no words), never shows its partial, says who spoke; the owner's verified final goes", () => {
      const r = makeOwner(true)
      r.start()
      socket().says({ type: 'ready' })
      announce()
      socket().says({ type: 'partial', text: 'pane telekas kinni' })
      expect(interims.filter((t) => t !== '')).toEqual([])
      rejected('rejected_other')
      expect(foreign).toBe(1)
      vi.advanceTimersByTime(1000)
      expect(utterances).toEqual([])
      // The owner's own words after it go, verified.
      ownerFinal('ava uus vaheleht')
      vi.advanceTimersByTime(150)
      expect(utterances).toEqual(['ava uus vaheleht'])
      expect(foreign).toBe(1)
    })

    it('strict mode: drops an unknown final and a final without a speaker, and delivers the verified owner', () => {
      const r = makeOwner(true)
      r.start()
      socket().says({ type: 'ready' })
      announce()
      ownerFinal('üks')
      vi.advanceTimersByTime(150)
      socket().says({ type: 'final', text: 'kaks', speaker: 'unknown' })
      vi.advanceTimersByTime(150)
      socket().says({ type: 'final', text: 'kolm' })
      vi.advanceTimersByTime(150)
      expect(utterances).toEqual(['üks'])
      expect(foreign).toBe(2)
    })

    it('strict mode: obeys an unknown final when off', () => {
      const r = makeOwner(false)
      r.start()
      socket().says({ type: 'ready' })
      socket().says({ type: 'final', text: 'kaks', speaker: 'unknown' })
      vi.advanceTimersByTime(150)
      expect(utterances).toEqual(['kaks'])
      expect(foreign).toBe(0)
      expect(dropsFinal(false, 'unknown')).toBe(false)
      expect(dropsFinal(false, 'other')).toBe(false)
      expect(dropsFinal(true, 'unknown')).toBe(true)
      expect(dropsFinal(true, 'other')).toBe(true)
      expect(dropsFinal(true, 'owner')).toBe(false)
    })

    it('strict mode: counts drops in a row, the third drop message once, and an obeyed final starts over', () => {
      const r = makeOwner(true)
      r.start()
      socket().says({ type: 'ready' })
      announce()
      for (const speaker of ['other', 'unknown', 'other', 'other'] as const) socket().says({ type: 'final', text: 'jah', speaker })
      expect(streaks).toEqual([1, 2, 3, 4])
      expect(streaks.filter(retrainDue)).toEqual([RETRAIN_AFTER_DROPS])
      ownerFinal('saada')
      rejected('insufficient_audio')
      expect(streaks).toEqual([1, 2, 3, 4, 1])
      expect(RETRAIN_AFTER_DROPS).toBe(3)
    })

    it('scripted enrolment (round 7): asks for the phrases, waits for the connection, reports each phrase and the end', () => {
      const r = makeOwner(false)
      r.start()
      r.enrolScript?.(12)
      expect(texts()).toEqual([])
      socket().says({ type: 'ready' })
      expect(texts()).toEqual([{ type: 'enrolScript', phrases: 12 }])
      socket().says({ type: 'enrolPhrase', count: 1 })
      socket().says({ type: 'enrolPhrase', count: 2 })
      r.enrolFinish?.()
      expect(texts()).toEqual([{ type: 'enrolScript', phrases: 12 }, { type: 'enrolFinish' }])
      socket().says({ type: 'enrolled', ok: true, seconds: 4.2, phrases: 2 })
      expect(phrases).toEqual([1, 2])
      expect(enrolled).toEqual([[true, 4.2, 2]])
    })

    it('delivers finals of other voices while the mode is off', () => {
      const r = makeOwner(false)
      r.start()
      socket().says({ type: 'ready' })
      socket().says({ type: 'final', text: 'pane telekas kinni', speaker: 'other' })
      vi.advanceTimersByTime(150)
      expect(utterances).toEqual(['pane telekas kinni'])
      expect(foreign).toBe(0)
    })

    it('does not release a settling quick reply that turns out to be another voice', () => {
      const r = makeOwner(true)
      r.start()
      socket().says({ type: 'ready' })
      socket().says({ type: 'partial', text: 'jah' })
      vi.advanceTimersByTime(INSTANT_SETTLE_MS - 1)
      socket().says({ type: 'final', text: 'jah', speaker: 'other' })
      vi.advanceTimersByTime(INSTANT_SETTLE_MS + LOCAL_HOLD_MS)
      expect(utterances).toEqual([])
      expect(foreign).toBe(1)
    })

    it('still delivers the words held before a flush when the flushed utterance was another voice', () => {
      const r = makeOwner(true)
      r.start()
      socket().says({ type: 'ready' })
      announce()
      ownerFinal('ma jõuan')
      socket().says({ type: 'partial', text: 'homme' })
      r.flush?.()
      expect(utterances).toEqual([])
      rejected('rejected_other')
      expect(utterances).toEqual(['ma jõuan'])
      expect(foreign).toBe(1)
    })

    it('asks the server to learn the voice, waits for the connection when it must, and reports the answer', () => {
      const r = makeOwner(false)
      r.start()
      r.enrol?.(8)
      expect(texts()).toEqual([])
      socket().says({ type: 'ready' })
      expect(texts()).toEqual([{ type: 'enrol', seconds: 8 }])
      r.enrol?.(8)
      expect(texts()).toEqual([
        { type: 'enrol', seconds: 8 },
        { type: 'enrol', seconds: 8 },
      ])
      socket().says({ type: 'enrolled', ok: true, seconds: 8 })
      socket().says({ type: 'enrolled', ok: false, seconds: 8 })
      expect(enrolled).toEqual([
        [true, 8],
        [false, 8],
      ])
    })

    // Issue #3 work package A: the baseline that fails on main.
    it('issue #3: a final without a speaker decision is not delivered while only the owner is obeyed', () => {
      const r = makeOwner(true)
      r.start()
      socket().says({ type: 'ready' })
      socket().says({ type: 'final', text: 'saada' })
      vi.advanceTimersByTime(5000)
      socket().says({ type: 'final', text: 'kustuta see', speaker: 'owner' })
      vi.advanceTimersByTime(5000)
      expect(utterances).toEqual([])
      expect(foreign).toBe(2)
      expect(dropsFinal(true, undefined)).toBe(true)
      expect(dropsFinal(false, undefined)).toBe(false)
    })

    it('issue #3: a settled quick reply is never released before its verdict, and no partial is shown', () => {
      const r = makeOwner(true)
      r.start()
      socket().says({ type: 'ready' })
      socket().says({ type: 'partial', text: 'jah' })
      vi.advanceTimersByTime(INSTANT_SETTLE_MS)
      expect(utterances).toEqual([])
      vi.advanceTimersByTime(5000)
      expect(utterances).toEqual([])
      expect(interims.filter((text) => text !== '')).toEqual([])
      // A flush does not release it either.
      r.flush?.()
      expect(utterances).toEqual([])
    })

    describe('the fail-closed barrier (round 10, 31.3): zero side effects per deny case', () => {
      const spies = () => ({
        onUtterance: vi.fn<(text: string, d?: SpeakerDecision) => void>(),
        onUtteranceContinued: vi.fn<(text: string, added: string, d?: SpeakerDecision) => void>(),
        onInterim: vi.fn<(text: string) => void>(),
        onError: vi.fn<(message: string) => void>(),
        onForeign: vi.fn<(streak: number, reason?: SpeakerReason) => void>(),
      })
      const strictWith = (h: ReturnType<typeof spies>) =>
        createLocalRecognizer(h, () => true, { onUnavailable: () => undefined, connect: (events) => new FakeSocket(events), audio: () => new FakeAudio(), onlyOwner: true, holdMs: 150 })
      /** No utterance, no continuation, no words shown. */
      const nothingRan = (h: ReturnType<typeof spies>): void => {
        expect(h.onUtterance).not.toHaveBeenCalled()
        expect(h.onUtteranceContinued).not.toHaveBeenCalled()
        expect(h.onInterim.mock.calls.filter(([t]) => t !== '')).toEqual([])
      }
      type Act = (say: (m: object) => void) => void
      const deny: Array<[string, Act]> = [
        ['no decision at all', (say) => say({ type: 'final', text: 'saada', speaker: 'owner' })],
        ['a decision without its segment', (say) => say({ type: 'final', text: 'saada', speaker: 'owner', decision: decision('verified_owner') })],
        [
          'a segment that is not the one decided',
          (say) => {
            const d = decision('verified_owner')
            say({ type: 'final', text: 'saada', speaker: 'owner', segment: d.segmentId + 1, decision: d })
          },
        ],
        [
          'another session (a socket before a reconnect)',
          (say) => {
            const d = decision('verified_owner', { sessionId: 'session-0' })
            say({ type: 'final', text: 'saada', speaker: 'owner', segment: d.segmentId, decision: d })
          },
        ],
        [
          'another profile version (before re-enrolment)',
          (say) => {
            const d = decision('verified_owner', { profileVersion: 'v1-old' })
            say({ type: 'final', text: 'saada', speaker: 'owner', segment: d.segmentId, decision: d })
          },
        ],
        [
          'an owner verdict with a reason that is not verified_owner',
          (say) => {
            const d = decision('insufficient_audio', { verdict: 'owner' })
            say({ type: 'final', text: 'saada', speaker: 'owner', segment: d.segmentId, decision: d })
          },
        ],
        ['a decision of the wrong shape', (say) => say({ type: 'final', text: 'saada', speaker: 'owner', segment: 1, decision: { segmentId: 1, verdict: 'owner', reason: 'verified_owner' } })],
        ...SPEAKER_REASONS.filter((reason) => reason !== 'verified_owner').flatMap((reason): Array<[string, Act]> => [
          [
            `a final decided ${reason}`,
            (say) => {
              const d = decision(reason)
              say({ type: 'final', text: 'saada', speaker: d.verdict, segment: d.segmentId, decision: d })
            },
          ],
          [`a rejection for ${reason}`, (say) => say({ type: 'rejected', decision: decision(reason) })],
        ]),
      ]
      for (const [name, act] of deny) {
        it(`denies ${name}`, () => {
          const h = spies()
          const r = strictWith(h)
          r.start()
          socket().says({ type: 'ready' })
          announce()
          socket().says({ type: 'partial', text: 'saada' })
          act((m) => socket().says(m))
          vi.advanceTimersByTime(5000)
          r.flush?.()
          vi.advanceTimersByTime(5000)
          nothingRan(h)
          expect(h.onForeign).toHaveBeenCalledTimes(1)
        })
      }

      it('denies a verified decision before any session was announced, and a replayed (stale) segment', () => {
        const h = spies()
        const r = strictWith(h)
        r.start()
        socket().says({ type: 'ready' })
        const early = decision('verified_owner')
        socket().says({ type: 'final', text: 'saada', speaker: 'owner', segment: early.segmentId, decision: early })
        announce()
        const d = decision('verified_owner')
        socket().says({ type: 'final', text: 'kirjuta', speaker: 'owner', segment: d.segmentId, decision: d })
        vi.advanceTimersByTime(150)
        expect(h.onUtterance.mock.calls).toEqual([['kirjuta', d]])
        // The same segment again, and an earlier one: stale.
        socket().says({ type: 'final', text: 'saada', speaker: 'owner', segment: d.segmentId, decision: d })
        socket().says({ type: 'final', text: 'saada', speaker: 'owner', segment: early.segmentId, decision: { ...early } })
        vi.advanceTimersByTime(5000)
        expect(h.onUtterance).toHaveBeenCalledTimes(1)
        expect(h.onForeign).toHaveBeenCalledTimes(3)
      })

      it('after a reconnect, nothing verified on the old socket runs, and the old session is stale', () => {
        const h = spies()
        const r = createLocalRecognizer(h, () => false, { onUnavailable: () => undefined, connect: (events) => new FakeSocket(events), audio: () => new FakeAudio(), onlyOwner: true, holdMs: 150, keepTrying: true })
        r.start()
        socket().says({ type: 'ready' })
        announce()
        // Verified and held by the assembler when the connection drops: it never runs.
        ownerFinal('kirjuta Marile')
        socket().drops()
        vi.advanceTimersByTime(1000)
        expect(FakeSocket.made).toHaveLength(2)
        socket().says({ type: 'ready' })
        // No announcement on the new socket yet: the old session's decision is denied.
        ownerFinal('saada')
        socket().says({ type: 'speakerSession', sessionId: 'session-2', profileVersion: SESSION.profileVersion })
        ownerFinal('saada')
        vi.advanceTimersByTime(5000)
        nothingRan(h)
        expect(h.onForeign).toHaveBeenCalledTimes(2)
      })

      it('review 1: a wordless activity keeps the hold alive and makes a flush wait for the final, showing nothing', () => {
        const h = spies()
        const r = createLocalRecognizer(h, () => false, { onUnavailable: () => undefined, connect: (events) => new FakeSocket(events), audio: () => new FakeAudio(), onlyOwner: true, holdMs: 150 })
        r.start()
        socket().says({ type: 'ready' })
        announce()
        ownerFinal('kirjuta Marile')
        vi.advanceTimersByTime(100)
        socket().says({ type: 'activity' })
        vi.advanceTimersByTime(100)
        expect(h.onUtterance).not.toHaveBeenCalled()
        r.flush?.()
        expect(h.onUtterance).not.toHaveBeenCalled()
        ownerFinal('et ma jõuan')
        expect(h.onUtterance.mock.calls.map(([t]) => t)).toEqual(['kirjuta Marile et ma jõuan'])
        expect(h.onInterim.mock.calls.filter(([t]) => t !== '')).toEqual([])
      })

      it('a stop with a flush pending delivers no unverified words', () => {
        const h = spies()
        const r = strictWith(h)
        r.start()
        socket().says({ type: 'ready' })
        announce()
        socket().says({ type: 'partial', text: 'saada' })
        r.flush?.()
        r.stop()
        vi.advanceTimersByTime(5000)
        nothingRan(h)
      })

      it('a verified final goes with its decision, through a continuation too', () => {
        const h = spies()
        const r = strictWith(h)
        r.start()
        socket().says({ type: 'ready' })
        announce()
        const first = ownerFinal('mine whatsappi')
        vi.advanceTimersByTime(150)
        const second = ownerFinal('siis ava Karin')
        vi.advanceTimersByTime(2000)
        expect(h.onUtterance.mock.calls).toEqual([['mine whatsappi', first]])
        expect(h.onUtteranceContinued.mock.calls).toEqual([['mine whatsappi siis ava Karin', 'siis ava Karin', second]])
      })
    })

    it('does nothing for an enrolment while stopped', () => {
      const r = makeOwner(false)
      r.enrol?.(8)
      expect(FakeSocket.made).toEqual([])
    })
  })
})

// ---------- wake word and places (29.4) ----------
describe('wake mode and the recogniser (29.4.1)', () => {
  it("wake: the recogniser delivers every final as heard, the word included; the gate is the engine's", () => {
    vi.useFakeTimers()
    FakeSocket.made = []
    const got: string[] = []
    const r = createLocalRecognizer({ onUtterance: (text) => got.push(text), onInterim: () => undefined, onError: () => undefined }, () => false, {
      onUnavailable: () => undefined,
      connect: (events) => new FakeSocket(events),
      audio: () => new FakeAudio(),
      holdMs: 150,
    })
    r.start()
    const s = FakeSocket.made.at(-1)
    s?.says({ type: 'ready' })
    for (const text of ['Ütle, keri alla', 'tere Mari', 'ütel saada']) {
      s?.says({ type: 'final', text })
      vi.advanceTimersByTime(150)
    }
    expect(got).toEqual(['Ütle, keri alla', 'tere Mari', 'ütel saada'])
    r.stop()
    vi.useRealTimers()
  })
})
// ---------- end of wake word and places ----------

// ---------- the first run (30.1, ONBOARD lane): keep trying, report the connection once per change ----------
describe('the connection while listening (30.1)', () => {
  let states: string[]
  let unavailable: number
  const make = (keepTrying: boolean) =>
    createLocalRecognizer(
      { onUtterance: () => undefined, onInterim: () => undefined, onError: () => undefined, onConnection: (state) => states.push(state) },
      () => false,
      { onUnavailable: () => (unavailable += 1), connect: (events) => new FakeSocket(events), audio: () => new FakeAudio(), keepTrying },
    )
  const last = (): FakeSocket => {
    const s = FakeSocket.made.at(-1)
    if (!s) throw new Error('no socket was opened')
    return s
  }
  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.made = []
    FakeAudio.made = []
    states = []
    unavailable = 0
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('server down: a refused first connection is down once, tried again 1, 2, 4, then every 5 s, never given up', () => {
    const r = make(true)
    r.start()
    expect(states).toEqual(['connecting'])
    last().drops()
    expect(states).toEqual(['connecting', 'down'])
    expect(unavailable).toBe(0)
    const at: number[] = []
    let t = 0
    for (let i = 0; i < 6; i++) {
      const before = FakeSocket.made.length
      while (FakeSocket.made.length === before) {
        vi.advanceTimersByTime(100)
        t += 100
      }
      at.push(t)
      last().drops()
    }
    expect(at).toEqual([1000, 3000, 7000, 12000, 17000, 22000])
    expect(RECONNECT_MS).toEqual([1000, 2000, 4000, 5000])
    expect(states).toEqual(['connecting', 'down'])
    expect(unavailable).toBe(0)
  })

  it('server back: a lost connection is down once and connected once it is ready again; the microphone opens again', async () => {
    const r = make(true)
    r.start()
    last().says({ type: 'ready' })
    await Promise.resolve()
    expect(states).toEqual(['connecting', 'connected'])
    expect(FakeAudio.made).toHaveLength(1)
    last().drops()
    vi.advanceTimersByTime(1000)
    last().drops()
    vi.advanceTimersByTime(2000)
    expect(states).toEqual(['connecting', 'connected', 'down'])
    last().says({ type: 'ready' })
    await Promise.resolve()
    expect(states).toEqual(['connecting', 'connected', 'down', 'connected'])
    expect(FakeAudio.made).toHaveLength(2)
    // The wait starts again from 1 s after a good connection.
    last().drops()
    const before = FakeSocket.made.length
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.made.length).toBe(before + 1)
  })

  it('server down: a stop ends the trying; the next start reports connecting again', () => {
    const r = make(true)
    r.start()
    last().drops()
    r.stop()
    const before = FakeSocket.made.length
    vi.advanceTimersByTime(30_000)
    expect(FakeSocket.made.length).toBe(before)
    r.start()
    expect(states).toEqual(['connecting', 'down', 'connecting'])
  })

  it('server down: "unavailable" (no model) still gives up, and without keepTrying a refused socket gives up as before', () => {
    const a = make(true)
    a.start()
    last().says({ type: 'unavailable', reason: 'model_missing' })
    expect(unavailable).toBe(1)
    const b = make(false)
    b.start()
    last().drops()
    expect(unavailable).toBe(2)
    expect(states.at(-1)).toBe('down')
  })
})
