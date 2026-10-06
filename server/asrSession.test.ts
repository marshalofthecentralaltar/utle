import { describe, expect, it } from 'vitest'
import { ASR_FRAME_SAMPLES } from '../src/speech/asrProtocol.ts'
import type { AsrServerMessage } from '../src/speech/asrProtocol.ts'
import { ENROL_PATIENCE, KEEP_MS, LAG_REPORT_MS, MAX_BACKLOG_MS, MAX_KEPT_MS, createAsrSession, decoderInThread, rms, samplesFromFrame } from './asrSession.ts'
import type { DecodeResult, Decoder, OnlineRecognizerLike, OnlineStreamLike } from './asrSession.ts'
import type { Judgement, SpeakerGate } from './speaker.ts'

/** A recogniser that "hears" one word per frame and ends the utterance on a silent frame. */
class FakeStream implements OnlineStreamLike {
  words: string[] = []
  pending: number[] = []
  endpoint = false
  acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void {
    this.pending.push(input.samples[0] ?? 0)
  }
}

const WORDS = ['ava', 'uus', 'vaheleht']

class FakeRecognizer implements OnlineRecognizerLike {
  resets = 0
  createStream(): FakeStream {
    return new FakeStream()
  }
  isReady(stream: FakeStream): boolean {
    return stream.pending.length > 0
  }
  decode(stream: FakeStream): void {
    const value = stream.pending.shift() ?? 0
    if (value === 0) stream.endpoint = true
    else stream.words.push(WORDS[(value - 1) % WORDS.length] ?? '')
  }
  getResult(stream: FakeStream): { text: string } {
    return { text: stream.words.join(' ') }
  }
  isEndpoint(stream: FakeStream): boolean {
    return stream.endpoint
  }
  reset(stream: FakeStream): void {
    this.resets += 1
    stream.words = []
    stream.endpoint = false
  }
}

/** A frame of 100 ms whose first sample says which word it carries (0 is silence). */
const frame = (value: number): Float32Array => {
  const samples = new Float32Array(ASR_FRAME_SAMPLES)
  samples.fill(value === 0 ? 0 : 0.1)
  samples[0] = value
  return samples
}

/** Runs the decode steps by hand, as the event loop would. */
class Loop {
  steps: Array<() => void> = []
  schedule = (step: () => void): void => {
    this.steps.push(step)
  }
  /** Runs one step: one frame decoded. */
  tick(): void {
    this.steps.shift()?.()
  }
  /** Runs until nothing is scheduled. */
  settle(): void {
    while (this.steps.length > 0) this.tick()
  }
}

const setup = (): { recognizer: FakeRecognizer; sent: AsrServerMessage[]; loop: Loop; clock: { now: number }; session: ReturnType<typeof createAsrSession> } => {
  const recognizer = new FakeRecognizer()
  const sent: AsrServerMessage[] = []
  const loop = new Loop()
  const clock = { now: 1000 }
  const session = createAsrSession(decoderInThread(recognizer), (message) => sent.push(message), { schedule: loop.schedule, now: () => clock.now })
  return { recognizer, sent, loop, clock, session }
}

describe('local recogniser session', () => {
  it('sends a partial each time the text changes and a final at an endpoint, then starts over', () => {
    const { recognizer, sent, loop, session } = setup()

    session.audio(frame(1))
    session.audio(frame(2))
    session.audio(frame(3))
    session.audio(frame(0))
    session.audio(frame(1))
    loop.settle()

    expect(sent).toEqual([
      { type: 'partial', text: 'ava' },
      { type: 'partial', text: 'ava uus' },
      { type: 'partial', text: 'ava uus vaheleht' },
      { type: 'final', text: 'ava uus vaheleht' },
      { type: 'partial', text: 'ava' },
    ])
    expect(recognizer.resets).toBe(1)
    expect(session.stats()).toEqual({ receivedMs: 500, decodedMs: 500, droppedMs: 0, foreignFinals: 0 })
  })

  it('decodes one frame per turn of the event loop, never on the receiving call', () => {
    const { sent, loop, session } = setup()
    session.audio(frame(1))
    session.audio(frame(2))
    expect(sent).toEqual([])
    expect(session.backlogMs()).toBe(200)
    loop.tick()
    expect(sent).toEqual([{ type: 'partial', text: 'ava' }])
    expect(session.backlogMs()).toBe(100)
    loop.tick()
    expect(sent).toHaveLength(2)
    expect(session.backlogMs()).toBe(0)
  })

  it('sends no final for silence and no partial when nothing changed', () => {
    const { recognizer, sent, loop, session } = setup()

    session.audio(frame(0))
    session.audio(frame(0))
    loop.settle()

    expect(sent).toEqual([])
    expect(recognizer.resets).toBe(2)
  })

  it('ignores audio after it is closed, and a result that lands after it', () => {
    const { sent, loop, session } = setup()
    session.audio(frame(1))
    session.close()
    session.audio(frame(1))
    loop.settle()
    expect(sent).toEqual([])
  })

  it('closes the connection when the decoder throws', () => {
    const errors: unknown[] = []
    const loop = new Loop()
    const broken: Decoder = {
      accept() {
        throw new Error('decode failed')
      },
      reset() {},
      close() {},
    }
    const session = createAsrSession(broken, () => {}, { schedule: loop.schedule, onError: (error) => errors.push(error) })
    session.audio(frame(1))
    loop.settle()
    expect(errors).toHaveLength(1)
  })

  it('waits for an asynchronous decoder (the worker) and keeps the frame order', async () => {
    const sent: AsrServerMessage[] = []
    const accepted: number[] = []
    const decoder: Decoder = {
      accept(samples) {
        accepted.push(samples[0] ?? -1)
        return Promise.resolve<DecodeResult>({ text: `heard ${accepted.length}`, endpoint: false })
      },
      reset() {},
      close() {},
    }
    const session = createAsrSession(decoder, (message) => sent.push(message))
    session.audio(frame(1))
    session.audio(frame(2))
    session.audio(frame(3))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(accepted).toEqual([1, 2, 3])
    expect(sent.map((message) => (message.type === 'partial' ? message.text : message.type))).toEqual(['heard 1', 'heard 2', 'heard 3'])
  })
})

describe('a slow decoder', () => {
  it('keeps the backlog bounded: the oldest audio is dropped and a lag message says how far behind it was', () => {
    const { sent, loop, session } = setup()
    // Audio arrives for 2 s while nothing is decoded.
    for (let i = 0; i < 20; i += 1) session.audio(frame(1))
    expect(session.backlogMs()).toBeLessThanOrEqual(MAX_BACKLOG_MS)
    expect(sent[0]).toEqual({ type: 'lag', ms: MAX_BACKLOG_MS + 100 })
    // After the drop the queue holds KEEP_MS, so the delay once decoding resumes is at most that.
    expect(session.stats().droppedMs).toBe(MAX_BACKLOG_MS + 100 - KEEP_MS)
    loop.settle()
    expect(session.backlogMs()).toBe(0)
    expect(session.stats().decodedMs + session.stats().droppedMs).toBe(session.stats().receivedMs)
  })

  it('reports lag at most every LAG_REPORT_MS, and 0 once caught up', () => {
    const { sent, loop, clock, session } = setup()
    const lags = (): number[] => sent.filter((message) => message.type === 'lag').map((message) => (message.type === 'lag' ? message.ms : -1))
    for (let i = 0; i < 16; i += 1) session.audio(frame(1))
    expect(lags()).toEqual([1600])
    // More drops within the report interval say nothing new.
    clock.now += LAG_REPORT_MS - 1
    for (let i = 0; i < 13; i += 1) session.audio(frame(1))
    expect(lags()).toEqual([1600])
    // Past it, the next drop is reported.
    clock.now += 1
    for (let i = 0; i < 13; i += 1) session.audio(frame(1))
    expect(lags()).toEqual([1600, 1600])
    // Caught up: lag 0, but not before LAG_REPORT_MS has passed since the last report.
    loop.settle()
    expect(session.backlogMs()).toBe(0)
    expect(lags()).toEqual([1600, 1600])
    clock.now += LAG_REPORT_MS
    session.audio(frame(1))
    loop.settle()
    expect(lags()).toEqual([1600, 1600, 0])
    // Silence from then on: no more lag messages.
    session.audio(frame(1))
    loop.settle()
    expect(lags()).toEqual([1600, 1600, 0])
  })

  it('ends a drop at a quiet frame near the cut rather than in the middle of a word', () => {
    const { loop, session } = setup()
    // 13 loud frames, then 2 quiet, then loud until the backlog overflows at 16 frames.
    for (let i = 0; i < 13; i += 1) session.audio(frame(1))
    session.audio(frame(0))
    session.audio(frame(0))
    session.audio(frame(2))
    // A plain cut would keep 300 ms: frames 14 (quiet), 15 (quiet), 16 (loud), splicing frame 13 to nothing.
    // Frame 13 (loud) next to frame 14 (quiet) is already a clean cut, so nothing more goes.
    expect(session.backlogMs()).toBe(KEEP_MS)
    loop.settle()

    const second = setup()
    for (let i = 0; i < 14; i += 1) second.session.audio(frame(1))
    second.session.audio(frame(0))
    second.session.audio(frame(2))
    // The plain cut lands between two loud frames (13 and 14); the quiet frame 15 is 100 ms on, so the drop ends there.
    expect(second.session.backlogMs()).toBe(100)
    expect(second.session.stats().droppedMs).toBe(1500)
  })

  it('does not drop beyond CUT_SEARCH_MS looking for a quiet frame', () => {
    const { session } = setup()
    for (let i = 0; i < 16; i += 1) session.audio(frame(1))
    expect(session.backlogMs()).toBe(KEEP_MS)
  })
})

describe('flush', () => {
  it('decodes what is queued, sends the utterance so far as a final, and the next frame starts fresh', () => {
    const { recognizer, sent, loop, session } = setup()
    session.audio(frame(1))
    session.audio(frame(2))
    session.flush()
    session.audio(frame(3))
    loop.settle()
    expect(sent).toEqual([
      { type: 'partial', text: 'ava' },
      { type: 'partial', text: 'ava uus' },
      { type: 'final', text: 'ava uus' },
      { type: 'partial', text: 'vaheleht' },
    ])
    expect(recognizer.resets).toBe(1)
  })

  it('sends no final when nothing was heard', () => {
    const { sent, loop, session } = setup()
    session.audio(frame(0))
    session.flush()
    loop.settle()
    expect(sent).toEqual([])
  })

  it('still answers when the frames queued before it were dropped', () => {
    const { sent, loop, session } = setup()
    session.audio(frame(1))
    session.flush()
    for (let i = 0; i < 16; i += 1) session.audio(frame(2))
    loop.settle()
    // The first frame went with the drop, so the flush had nothing to finalise, but the stream went on:
    // the 300 ms kept after the drop plus the frame that came after it.
    expect(sent[0]).toEqual({ type: 'lag', ms: 1600 })
    expect(sent.filter((message) => message.type === 'final')).toEqual([])
    expect(sent.at(-1)).toEqual({ type: 'partial', text: Array(4).fill('uus').join(' ') })
  })
})

describe('audio frames', () => {
  it('reads little-endian float samples', () => {
    const samples = new Float32Array([0.5, -0.25])
    const read = samplesFromFrame(Buffer.from(samples.buffer))
    expect(read && Array.from(read)).toEqual([0.5, -0.25])
  })

  it('refuses frames that are not whole samples, empty, or longer than a second', () => {
    expect(samplesFromFrame(Buffer.alloc(6))).toBeNull()
    expect(samplesFromFrame(Buffer.alloc(0))).toBeNull()
    expect(samplesFromFrame(Buffer.alloc(16000 * 4 + 4))).toBeNull()
  })

  it('measures loudness as RMS', () => {
    expect(rms(new Float32Array([0, 0, 0]))).toBe(0)
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5)
    expect(rms(new Float32Array(0))).toBe(0)
  })
})

/** A speaker gate that answers what the test sets and records the frames it was given. */
class FakeGate implements SpeakerGate {
  answer: Judgement | null = { speaker: 'owner', score: 0.9 }
  judged: Float32Array[][] = []
  enrolled: Float32Array[][] = []
  enrolOk = true
  hasProfile(): boolean {
    return this.answer !== null
  }
  hasModel(): boolean {
    return true
  }
  enrol(frames: Float32Array[]): boolean {
    this.enrolled.push(frames)
    return this.enrolOk
  }
  judge(frames: Float32Array[]): Judgement | null {
    this.judged.push(frames)
    return this.answer
  }
}

/** Feeds frames one by one, each decoded before the next arrives (no backlog, no drop). */
const feed = (session: ReturnType<typeof setup>['session'], loop: Loop, values: number[]): void => {
  for (const value of values) {
    session.audio(frame(value))
    loop.settle()
  }
}
/** The enrolled message follows the decoder's promise, a microtask after the frame that completed it. */
const microtasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const setupWithGate = (): ReturnType<typeof setup> & { gate: FakeGate } => {
  const recognizer = new FakeRecognizer()
  const gate = new FakeGate()
  const sent: AsrServerMessage[] = []
  const loop = new Loop()
  const clock = { now: 1000 }
  const session = createAsrSession(decoderInThread(recognizer, gate), (message) => sent.push(message), { schedule: loop.schedule, now: () => clock.now })
  return { recognizer, gate, sent, loop, clock, session }
}

describe('the speaker on a final (round 4)', () => {
  it('judges the frames of the utterance that ended, and the final carries the speaker', () => {
    const { gate, sent, loop, session } = setupWithGate()
    for (const value of [1, 2, 3, 0, 1, 0]) session.audio(frame(value))
    loop.settle()
    expect(sent.filter((message) => message.type === 'final')).toEqual([
      { type: 'final', text: 'ava uus vaheleht', speaker: 'owner' },
      { type: 'final', text: 'ava', speaker: 'owner' },
    ])
    // Each utterance's own frames, the silent endpoint frame included, nothing of the one before.
    expect(gate.judged.map((frames) => frames.length)).toEqual([4, 2])
    expect(session.stats().foreignFinals).toBe(0)
  })

  it('sends a final without a speaker when there is no profile', () => {
    const { gate, sent, loop, session } = setupWithGate()
    gate.answer = null
    for (const value of [1, 0]) session.audio(frame(value))
    loop.settle()
    expect(sent.at(-1)).toEqual({ type: 'final', text: 'ava' })
  })

  it("judges a flush on the frames since the last reset, and sends the other voice's final too", () => {
    const { gate, sent, loop, session } = setupWithGate()
    gate.answer = { speaker: 'other', score: 0.1 }
    session.onlyOwner(true)
    session.audio(frame(1))
    session.audio(frame(2))
    session.flush()
    session.audio(frame(3))
    loop.settle()
    expect(sent.filter((message) => message.type === 'final')).toEqual([{ type: 'final', text: 'ava uus', speaker: 'other' }])
    expect(gate.judged.map((frames) => frames.length)).toEqual([2])
    expect(sent.at(-1)).toEqual({ type: 'partial', text: 'vaheleht' })
    expect(session.stats().foreignFinals).toBe(1)
  })

  it('counts finals of other voices only while onlyOwner is on', () => {
    const { gate, loop, session } = setupWithGate()
    gate.answer = { speaker: 'other', score: 0.1 }
    for (const value of [1, 0]) session.audio(frame(value))
    loop.settle()
    expect(session.stats().foreignFinals).toBe(0)
  })

  it('keeps at most MAX_KEPT_MS of an utterance for the judgement', () => {
    const { gate, loop, session } = setupWithGate()
    const frames = MAX_KEPT_MS / 100 + 50
    feed(session, loop, Array.from({ length: frames }, () => 1))
    feed(session, loop, [0])
    expect(gate.judged).toHaveLength(1)
    expect(gate.judged[0]).toHaveLength(MAX_KEPT_MS / 100)
  })

  it('holds the final until an asynchronous judge (the worker) answers, and keeps the order', async () => {
    const sent: AsrServerMessage[] = []
    let judges = 0
    const decoder: Decoder = {
      accept(samples) {
        const value = samples[0] ?? 0
        return Promise.resolve<DecodeResult>(value === 0 ? { text: 'ava', endpoint: true } : { text: 'ava', endpoint: false })
      },
      reset() {},
      close() {},
      judge() {
        judges += 1
        return new Promise((resolve) => setTimeout(() => resolve({ speaker: 'unknown', score: 0 }), 10))
      },
    }
    const session = createAsrSession(decoder, (message) => sent.push(message))
    session.audio(frame(1))
    session.audio(frame(0))
    session.audio(frame(1))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(judges).toBe(1)
    expect(sent).toEqual([
      { type: 'partial', text: 'ava' },
      { type: 'final', text: 'ava', speaker: 'unknown' },
      { type: 'partial', text: 'ava' },
    ])
  })

  it('sends the final without a speaker when the judge fails, and goes on (review: the words outrank the verdict)', async () => {
    const sent: AsrServerMessage[] = []
    const errors: unknown[] = []
    const loop = new Loop()
    let calls = 0
    const decoder: Decoder = {
      accept: () => ({ text: 'ava', endpoint: true }),
      reset() {},
      close() {},
      judge() {
        calls += 1
        if (calls === 1) throw new Error('no embedding')
        return Promise.reject(new Error('worker gone'))
      },
    }
    const session = createAsrSession(decoder, (message) => sent.push(message), { schedule: loop.schedule, onError: (error) => errors.push(error) })
    session.audio(frame(1))
    loop.settle()
    session.audio(frame(1))
    loop.settle()
    await Promise.resolve()
    await Promise.resolve()
    loop.settle()
    expect(errors).toEqual([])
    expect(sent.filter((message) => message.type === 'final')).toEqual([
      { type: 'final', text: 'ava' },
      { type: 'final', text: 'ava' },
    ])
  })
})

describe('enrolment (round 4)', () => {
  it('learns from the next seconds of speech, skipping silence, and answers enrolled', async () => {
    const { gate, sent, loop, session } = setupWithGate()
    session.enrol(2)
    feed(session, loop, Array.from({ length: 10 }, () => 0))
    feed(session, loop, Array.from({ length: 19 }, () => 1))
    await microtasks()
    expect(sent.filter((message) => message.type === 'enrolled')).toEqual([])
    feed(session, loop, [1])
    await microtasks()
    expect(sent.filter((message) => message.type === 'enrolled')).toEqual([{ type: 'enrolled', ok: true, seconds: 2 }])
    expect(gate.enrolled).toHaveLength(1)
    expect(gate.enrolled[0]).toHaveLength(20)
    expect(gate.enrolled[0]?.every((f) => rms(f) > 0)).toBe(true)
  })

  it('gives up after ENROL_PATIENCE times the asked seconds with too little speech', async () => {
    const { gate, sent, loop, session } = setupWithGate()
    session.enrol(1)
    feed(session, loop, Array.from({ length: ENROL_PATIENCE * 10 - 1 }, (_, i) => (i % 10 === 0 ? 1 : 0)))
    await microtasks()
    expect(sent.filter((message) => message.type === 'enrolled')).toEqual([])
    feed(session, loop, [0])
    await microtasks()
    expect(sent.filter((message) => message.type === 'enrolled')).toEqual([{ type: 'enrolled', ok: false, seconds: 1 }])
    expect(gate.enrolled).toEqual([])
  })

  it('answers ok: false when the gate cannot learn, and without waiting when there is no gate', async () => {
    const { gate, sent, loop, session } = setupWithGate()
    gate.enrolOk = false
    session.enrol(1)
    feed(session, loop, Array.from({ length: 10 }, () => 1))
    await microtasks()
    expect(sent.filter((message) => message.type === 'enrolled')).toEqual([{ type: 'enrolled', ok: false, seconds: 1 }])

    const plain = setup()
    plain.session.enrol(8)
    await microtasks()
    expect(plain.sent).toEqual([{ type: 'enrolled', ok: false, seconds: 8 }])
  })

  it('replaces an enrolment in progress with a new one, and ends one with the stream', async () => {
    const recognizer = new FakeRecognizer()
    const decoder = decoderInThread(recognizer, new FakeGate())
    const first = decoder.enrol?.(8)
    const second = decoder.enrol?.(8)
    expect(await first).toBe(false)
    decoder.close()
    expect(await second).toBe(false)
  })
})
