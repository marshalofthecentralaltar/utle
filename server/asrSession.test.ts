import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ASR_FRAME_SAMPLES } from '../src/speech/asrProtocol.ts'
import { SPEAKER_REASONS } from '../src/speech/asrProtocol.ts'
import type { AsrServerMessage, SpeakerReason } from '../src/speech/asrProtocol.ts'
import { ENROL_PATIENCE, KEEP_MS, LAG_REPORT_MS, MAX_BACKLOG_MS, MAX_KEPT_MS, SILENCE_RMS, createAsrSession, decoderInThread, rms, samplesFromFrame } from './asrSession.ts'
import type { DecodeResult, Decoder, OnlineRecognizerLike, OnlineStreamLike } from './asrSession.ts'
import type { EnrolPhrase, Judgement, SpeakerGate, SpeakerVerification } from './speaker.ts'
import { CAPTURE_LOG, captureFromEnv, createCapture } from './capture.ts'
import type { Capture } from './capture.ts'
import type { VadLike } from './vad.ts'
import { QUIET_AMPLITUDE, createSpeechFilter } from './vad.ts'

/** A recogniser that "hears" one word per frame and ends the utterance on a silent frame (first sample under 0.5: zero, or the detector's faint hiss). */
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
    if (Math.abs(value) < 0.5) stream.endpoint = true
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

  it('sends no partial and no final that is only punctuation (the recogniser can end a breath with ".")', () => {
    const sent: AsrServerMessage[] = []
    const loop = new Loop()
    const results: DecodeResult[] = [{ text: '.', endpoint: false }, { text: '.', endpoint: true }, { text: 'Jah', endpoint: false }, { text: 'Jah.', endpoint: true }]
    const decoder: Decoder = { accept: () => results.shift() ?? { text: '', endpoint: false }, reset() {}, close() {} }
    const session = createAsrSession(decoder, (message) => sent.push(message), { schedule: loop.schedule })
    for (let i = 0; i < 4; i += 1) session.audio(frame(1))
    loop.settle()
    expect(sent).toEqual([
      { type: 'partial', text: 'Jah' },
      { type: 'partial', text: 'Jah.' },
      { type: 'final', text: 'Jah.' },
    ])
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
  /** Round 10: what verify answers; by default derived from answer (null: no profile; unknown: too little audio). */
  verification: SpeakerVerification | null = null
  version = 'v1-fake0001'
  verify(frames: Float32Array[]): SpeakerVerification {
    this.judged.push(frames)
    if (this.verification !== null) return this.verification
    const a = this.answer
    if (a === null) return { judgement: null, reason: 'profile_missing', profileVersion: '' }
    const reason: SpeakerReason = a.speaker === 'owner' ? 'verified_owner' : a.speaker === 'other' ? 'rejected_other' : 'insufficient_audio'
    return { judgement: a, reason, profileVersion: this.version }
  }
  profileVersion(): string {
    return this.answer === null ? '' : this.version
  }
  phrased: Float32Array[][] = []
  learnt: EnrolPhrase[][] = []
  phrase(frames: Float32Array[]): EnrolPhrase | null {
    this.phrased.push(frames)
    return frames.length === 0 ? null : { embedding: [1, 0], rms: 0.1, seconds: frames.length / 10 }
  }
  enrolPhrases(phrases: EnrolPhrase[]): boolean {
    this.learnt.push(phrases)
    return this.enrolOk
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

  it("judges a flush on the frames since the last reset, and with only the owner on sends the other voice's rejection without its words (round 10)", () => {
    const { gate, sent, loop, session } = setupWithGate()
    gate.answer = { speaker: 'other', score: 0.1 }
    session.onlyOwner(true)
    session.audio(frame(1))
    session.audio(frame(2))
    session.flush()
    session.audio(frame(3))
    loop.settle()
    expect(sent.filter((message) => message.type === 'final')).toEqual([])
    expect(sent.filter((message) => message.type === 'rejected').map((m) => (m.type === 'rejected' ? m.decision.reason : ''))).toEqual(['rejected_other'])
    expect(gate.judged.map((frames) => frames.length)).toEqual([2])
    expect(sent.at(-1)).toEqual({ type: 'activity' })
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

/**
 * A speech detector for the tests: a frame is speech when its first sample is a word (1 to 8);
 * NOISE frames are loud but not speech. It says "speech" once the last `lag` frames were all speech
 * (Silero's onset delay).
 */
const NOISE = 9
class FakeVad implements VadLike {
  heard: boolean[] = []
  lag: number
  constructor(lag = 1) {
    this.lag = lag
  }
  acceptWaveform(samples: Float32Array): void {
    const value = samples[0] ?? 0
    this.heard.push(value > 0 && value < NOISE)
  }
  isDetected(): boolean {
    const last = this.heard.slice(-this.lag)
    return last.length === this.lag && last.every((x) => x)
  }
  isEmpty(): boolean {
    return true
  }
  pop(): void {}
}

/** A loud frame that is not speech (a fan, a street): its first sample would be a word to the fake recogniser. */
const noise = (): Float32Array => {
  const samples = new Float32Array(ASR_FRAME_SAMPLES).fill(0.1)
  samples[0] = NOISE
  return samples
}

const setupWithVad = (lag = 1, gate: FakeGate | null = null, capture: Capture | null = null): ReturnType<typeof setup> => {
  const recognizer = new FakeRecognizer()
  const sent: AsrServerMessage[] = []
  const loop = new Loop()
  const clock = { now: 1000 }
  const session = createAsrSession(decoderInThread(recognizer, gate, { vad: () => new FakeVad(lag), capture }), (message) => sent.push(message), { schedule: loop.schedule, now: () => clock.now })
  return { recognizer, sent, loop, clock, session }
}

describe('the speech detector in front of the decoder (round 7)', () => {
  it('turns 20 s of room noise into silence for the decoder: no partial, no final', () => {
    const { sent, loop, session } = setupWithVad()
    for (let i = 0; i < 200; i += 1) {
      session.audio(noise())
      loop.settle()
    }
    expect(sent.filter((m) => m.type === 'partial' || m.type === 'final')).toEqual([])
  })

  it('without a detector the same noise is decoded into words (the fault it fixes)', () => {
    const { sent, loop, session } = setup()
    for (let i = 0; i < 3; i += 1) session.audio(noise())
    session.audio(frame(0))
    loop.settle()
    expect(sent.some((m) => m.type === 'final')).toBe(true)
  })

  it('passes speech as heard, the frames remembered before the detector spoke first (the start of the first word)', () => {
    const { sent, loop, session } = setupWithVad(2)
    // Frame 1 is not yet detected (lag 2): it reaches the decoder as silence, then again as audio with frame 2.
    for (const value of [1, 2, 3]) session.audio(frame(value))
    session.audio(noise())
    session.audio(noise())
    loop.settle()
    expect(sent.filter((m) => m.type === 'final')).toEqual([{ type: 'final', text: 'ava uus vaheleht' }])
  })

  it('decodes the frames after an endpoint inside one burst at the next frame, none lost', () => {
    const { sent, loop, session } = setupWithVad(2)
    // A silent frame is remembered; when speech starts it is replayed first and ends an empty utterance.
    for (const value of [0, 1, 2, 3]) {
      session.audio(frame(value))
      loop.settle()
    }
    session.audio(noise())
    session.audio(noise())
    loop.settle()
    expect(sent.filter((m) => m.type === 'final')).toEqual([{ type: 'final', text: 'ava uus vaheleht' }])
  })

  it('hands the decoder a faint fixed hiss for what is not speech, never digital zeros (zeros let the recogniser drop a short last word)', () => {
    const filter = createSpeechFilter(new FakeVad(1))
    const out = [noise(), noise(), noise()].flatMap((samples) => filter.push(samples))
    expect(out).toHaveLength(3)
    for (const part of out) {
      expect(part.speech).toBe(false)
      expect(part.samples).toHaveLength(ASR_FRAME_SAMPLES)
      expect(part.samples.some((x) => x !== 0)).toBe(true)
      expect(part.samples.every((x) => Math.abs(x) <= QUIET_AMPLITUDE)).toBe(true)
      // Still silence to everything that measures loudness (the backlog cut, the speaker gate's frames).
      expect(rms(part.samples)).toBeLessThan(SILENCE_RMS / 10)
    }
    // The same hiss every time the server runs: a test of recorded speech gives the same words.
    const again = createSpeechFilter(new FakeVad(1)).push(noise())[0]
    expect(Array.from(again?.samples ?? [])).toEqual(Array.from(out[0]?.samples ?? []))
  })

  it('keeps only speech for the speaker gate', () => {
    const gate = new FakeGate()
    const { loop, session } = setupWithVad(1, gate)
    for (const value of [1, 2]) session.audio(frame(value))
    session.audio(noise())
    loop.settle()
    expect(gate.judged).toHaveLength(1)
    expect(gate.judged[0]?.map((f) => f[0])).toEqual([1, 2])
  })
})

describe('strict mode (round 7) on the server', () => {
  it('strict mode: counts unknown finals as dropped while onlyOwner is on, not owner ones', () => {
    const { gate, loop, session } = setupWithGate()
    session.onlyOwner(true)
    gate.answer = { speaker: 'unknown', score: 0 }
    feed(session, loop, [1, 0])
    gate.answer = { speaker: 'other', score: 0.3 }
    feed(session, loop, [1, 0])
    gate.answer = { speaker: 'owner', score: 0.8 }
    feed(session, loop, [1, 0])
    expect(session.stats().foreignFinals).toBe(2)
  })
})

describe('no continuity (round 10, issue #3 B3): each final is verified on its own frames', () => {
  const setupJudged = (): ReturnType<typeof setupWithGate> & { judged: Judgement[] } => {
    const recognizer = new FakeRecognizer()
    const gate = new FakeGate()
    const sent: AsrServerMessage[] = []
    const judged: Judgement[] = []
    const loop = new Loop()
    const clock = { now: 1000 }
    const session = createAsrSession(decoderInThread(recognizer, gate), (message) => sent.push(message), { schedule: loop.schedule, now: () => clock.now, onJudged: (judgement) => judged.push(judgement), sessionId: 's-1' })
    session.onlyOwner(true)
    return { recognizer, gate, sent, loop, clock, session, judged }
  }
  const outcomes = (sent: AsrServerMessage[]): string[] => sent.flatMap((m) => (m.type === 'final' ? [`final ${m.decision?.reason ?? 'none'}`] : m.type === 'rejected' ? [`rejected ${m.decision.reason}`] : []))
  const OWNER: Judgement = { speaker: 'owner', score: 0.7, seconds: 1.6 }
  const SHORT: Judgement = { speaker: 'unknown', score: 0, seconds: 0.4 }

  it("a short word scored other right after the owner's final is rejected, and the log has the reason", () => {
    const { gate, sent, loop, clock, session, judged } = setupJudged()
    gate.answer = OWNER
    feed(session, loop, [1, 2, 0])
    clock.now += 4000
    gate.answer = { speaker: 'other', score: 0.168, seconds: 0.45 }
    feed(session, loop, [1, 0])
    expect(outcomes(sent)).toEqual(['final verified_owner', 'rejected rejected_other'])
    expect(judged.at(-1)).toEqual({ speaker: 'other', score: 0.168, seconds: 0.45, reason: 'rejected_other' })
    expect(session.stats().foreignFinals).toBe(1)
  })

  it('a short word with too little audio is insufficient_audio however recently the owner spoke', () => {
    for (const gap of [500, 4000, 9999, 10_001]) {
      const { gate, sent, loop, clock, session } = setupJudged()
      gate.answer = OWNER
      feed(session, loop, [1, 0])
      clock.now += gap
      gate.answer = SHORT
      feed(session, loop, [1, 0])
      expect(outcomes(sent)).toEqual(['final verified_owner', 'rejected insufficient_audio'])
    }
  })

  it('a short final the score itself verified passes on its own, and opens no window for the next', () => {
    const { gate, sent, loop, clock, session } = setupJudged()
    gate.answer = { speaker: 'owner', score: 0.7, seconds: 0.9 }
    feed(session, loop, [1, 0])
    clock.now += 500
    gate.answer = SHORT
    feed(session, loop, [1, 0])
    expect(outcomes(sent)).toEqual(['final verified_owner', 'rejected insufficient_audio'])
  })
})

describe('the fail-closed decision on the server (round 10, 31.2)', () => {
  const strict = (): ReturnType<typeof setupWithGate> => {
    const recognizer = new FakeRecognizer()
    const gate = new FakeGate()
    const sent: AsrServerMessage[] = []
    const loop = new Loop()
    const clock = { now: 1000 }
    const session = createAsrSession(decoderInThread(recognizer, gate), (message) => sent.push(message), { schedule: loop.schedule, now: () => clock.now, sessionId: 'session-A' })
    session.onlyOwner(true)
    return { recognizer, gate, sent, loop, clock, session }
  }

  it('announces the session and the profile version when only the owner is turned on, and again after an enrolment', async () => {
    const { gate, sent, loop, session } = strict()
    expect(sent).toEqual([{ type: 'speakerSession', sessionId: 'session-A', profileVersion: 'v1-fake0001' }])
    gate.version = 'v1-fake0002'
    session.enrol(0.2)
    feed(session, loop, [1, 1, 1])
    await microtasks()
    expect(sent.filter((m) => m.type === 'speakerSession').at(-1)).toEqual({ type: 'speakerSession', sessionId: 'session-A', profileVersion: 'v1-fake0002' })
    // Off: no announcement.
    const off = setupWithGate()
    off.session.onlyOwner(false)
    expect(off.sent).toEqual([])
  })

  it('a verified owner final carries its segment and the whole decision', () => {
    const { gate, sent, loop, clock, session } = strict()
    gate.answer = { speaker: 'owner', score: 0.71, seconds: 1.2 }
    session.audio(frame(1))
    loop.settle()
    clock.now += 7
    session.audio(frame(0))
    loop.settle()
    expect(sent.at(-1)).toEqual({
      type: 'final',
      text: 'ava',
      speaker: 'owner',
      segment: 1,
      decision: { segmentId: 1, sessionId: 'session-A', profileVersion: 'v1-fake0001', verdict: 'owner', reason: 'verified_owner', score: 0.71, timings: { judgeMs: 0, speechMs: 1200 } },
    })
  })

  for (const reason of SPEAKER_REASONS.filter((r) => r !== 'verified_owner')) {
    it(`${reason}: a rejection without the words, counted as dropped`, () => {
      const { gate, sent, loop, session } = strict()
      gate.verification = { judgement: null, reason, profileVersion: 'v1-fake0001' }
      feed(session, loop, [1, 2, 0])
      const finals = sent.filter((m) => m.type === 'final')
      const rejections = sent.flatMap((m) => (m.type === 'rejected' ? [m.decision] : []))
      expect(finals).toEqual([])
      expect(rejections).toHaveLength(1)
      expect(rejections[0]).toMatchObject({ segmentId: 1, sessionId: 'session-A', reason, verdict: reason === 'mixed_speakers' || reason === 'rejected_other' ? 'other' : 'unknown' })
      // Partials included (round 10, review 1): no words at all leave the server.
      expect(sent.filter((m) => 'text' in m)).toEqual([])
      expect(session.stats().foreignFinals).toBe(1)
    })
  }

  it('review 1: no words but a verified final leave the server while only the owner is on, partials included; a wordless activity instead', () => {
    const { gate, sent, loop, session } = strict()
    gate.answer = { speaker: 'other', score: 0.2, seconds: 1.5 }
    feed(session, loop, [1, 2, 3, 0])
    gate.answer = { speaker: 'unknown', score: 0, seconds: 0.4 }
    session.audio(frame(1))
    session.audio(frame(2))
    session.flush()
    loop.settle()
    gate.answer = { speaker: 'owner', score: 0.8, seconds: 1.5 }
    feed(session, loop, [3, 1, 0])
    const worded = sent.filter((m) => 'text' in m && m.text !== '')
    expect(worded).toEqual([expect.objectContaining({ type: 'final', text: 'vaheleht ava', decision: expect.objectContaining({ reason: 'verified_owner' }) })])
    expect(sent.filter((m) => m.type === 'partial')).toEqual([])
    expect(sent.filter((m) => m.type === 'activity').length).toBeGreaterThan(0)
    // Off again: partials with words, as before.
    session.onlyOwner(false)
    feed(session, loop, [1, 0])
    expect(sent.filter((m) => m.type === 'partial').at(-1)).toEqual({ type: 'partial', text: 'ava' })
  })

  it('segments count up through the session, rejected or not', () => {
    const { gate, sent, loop, session } = strict()
    gate.answer = { speaker: 'owner', score: 0.7, seconds: 1 }
    feed(session, loop, [1, 0])
    gate.answer = { speaker: 'other', score: 0.2, seconds: 1 }
    feed(session, loop, [1, 0])
    gate.answer = { speaker: 'owner', score: 0.7, seconds: 1 }
    feed(session, loop, [1, 0])
    expect(sent.flatMap((m) => (m.type === 'final' || m.type === 'rejected' ? [m.decision?.segmentId] : []))).toEqual([1, 2, 3])
  })

  it('a decoder without verify (no gate) is denied as a verification error', () => {
    const sent: AsrServerMessage[] = []
    const loop = new Loop()
    const decoder: Decoder = { accept: () => ({ text: 'saada', endpoint: true }), reset() {}, close() {}, judge: () => ({ speaker: 'owner', score: 0.9 }) }
    const session = createAsrSession(decoder, (message) => sent.push(message), { schedule: loop.schedule, sessionId: 'x' })
    session.onlyOwner(true)
    session.audio(frame(1))
    loop.settle()
    expect(sent.filter((m) => m.type === 'final')).toEqual([])
    expect(sent.flatMap((m) => (m.type === 'rejected' ? [m.decision.reason] : []))).toEqual(['verification_error'])
  })

  it('with the mode off the wire is as before: no announcement, no segment, no decision', () => {
    const { gate, sent, loop, session } = setupWithGate()
    gate.answer = { speaker: 'owner', score: 0.9 }
    feed(session, loop, [1, 0])
    expect(sent.filter((m) => m.type !== 'partial')).toEqual([{ type: 'final', text: 'ava', speaker: 'owner' }])
  })
})

describe('scripted enrolment (round 7)', () => {
  it('takes each utterance with words as one phrase, says the count after each, and learns at the asked number', async () => {
    const { gate, sent, loop, session } = setupWithGate()
    session.enrolScript(2)
    feed(session, loop, [1, 2, 0])
    await microtasks()
    expect(sent.filter((m) => m.type === 'enrolPhrase')).toEqual([{ type: 'enrolPhrase', count: 1 }])
    // Silence alone is no phrase.
    feed(session, loop, [0, 0])
    feed(session, loop, [3, 0])
    await microtasks()
    expect(sent.filter((m) => m.type === 'enrolPhrase')).toEqual([
      { type: 'enrolPhrase', count: 1 },
      { type: 'enrolPhrase', count: 2 },
    ])
    expect(sent.filter((m) => m.type === 'enrolled')).toEqual([{ type: 'enrolled', ok: true, seconds: 0.3, phrases: 2 }])
    expect(gate.learnt).toHaveLength(1)
    expect(gate.learnt[0]).toHaveLength(2)
  })

  it('ends early with what was read, and counts an utterance a flush ended', async () => {
    const { gate, sent, loop, session } = setupWithGate()
    session.enrolScript(12)
    session.audio(frame(1))
    session.audio(frame(2))
    session.flush()
    loop.settle()
    session.enrolFinish()
    await microtasks()
    expect(sent.filter((m) => m.type === 'enrolPhrase')).toEqual([{ type: 'enrolPhrase', count: 1 }])
    expect(sent.filter((m) => m.type === 'enrolled')).toEqual([{ type: 'enrolled', ok: true, seconds: 0.2, phrases: 1 }])
    expect(gate.learnt[0]).toHaveLength(1)
  })

  it('answers ok: false when nothing was read, and without a gate', async () => {
    const { gate, sent, session } = setupWithGate()
    session.enrolScript(12)
    session.enrolFinish()
    await microtasks()
    expect(sent.filter((m) => m.type === 'enrolled')).toEqual([{ type: 'enrolled', ok: false, seconds: 0, phrases: 0 }])
    expect(gate.learnt).toEqual([])

    const plain = setup()
    plain.session.enrolScript(12)
    await microtasks()
    expect(plain.sent).toEqual([{ type: 'enrolled', ok: false, seconds: 0, phrases: 0 }])
  })
})

describe('capture (round 7, UTLE_CAPTURE)', () => {
  let dir = ''
  afterEach(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  it('is off without the variable', () => {
    expect(captureFromEnv({})).toBeNull()
    expect(captureFromEnv({ UTLE_CAPTURE: '  ' })).toBeNull()
  })

  it('hands each final, its judged frames and its verdict to the capture only when one is given', () => {
    const written: Array<{ frames: number; speaker: string; text: string }> = []
    const capture: Capture = { write: (frames, judgement, text) => written.push({ frames: frames.length, speaker: judgement?.speaker ?? 'none', text }) }
    const gate = new FakeGate()
    gate.answer = { speaker: 'other', score: 0.31 }
    const { loop, session } = setupWithVad(1, gate, capture)
    for (const value of [1, 2]) session.audio(frame(value))
    session.audio(noise())
    loop.settle()
    expect(written).toEqual([{ frames: 2, speaker: 'other', text: 'ava uus' }])

    const without = setupWithVad(1, new FakeGate(), null)
    for (const value of [1, 2]) without.session.audio(frame(value))
    without.session.audio(noise())
    without.loop.settle()
    expect(written).toHaveLength(1)
  })

  it('writes <timestamp>-<speaker>-<score>.wav and a line of log.tsv into the folder', () => {
    dir = mkdtempSync(join(tmpdir(), 'utle-capture-'))
    expect(captureFromEnv({ UTLE_CAPTURE: dir })).not.toBeNull()
    const fixed = createCapture(dir, () => new Date('2026-10-21T08:00:00.123Z'))
    fixed.write([frame(1), frame(2)], { speaker: 'owner', score: 0.7 }, 'ava\tuus')
    fixed.write([frame(1)], null, 'saada')
    expect(readdirSync(dir).sort()).toEqual(['20261021T080000123-none-0.000.wav', '20261021T080000123-owner-0.700.wav', CAPTURE_LOG].sort())
    expect(readFileSync(join(dir, '20261021T080000123-owner-0.700.wav')).length).toBe(44 + 2 * 2 * ASR_FRAME_SAMPLES)
    expect(readFileSync(join(dir, CAPTURE_LOG), 'utf8')).toBe('20261021T080000123-owner-0.700.wav\t0.700\towner\tava uus\n20261021T080000123-none-0.000.wav\t0.000\tnone\tsaada\n')
  })
})

// Issue #3 work package A: the baseline that fails on main. With onlyOwner on, the server never
// sends words the speaker gate did not verify as the owner's, for that utterance itself.
describe('issue #3: only the owner, fail closed on the server', () => {
  const owned = (sent: AsrServerMessage[]): string[] => sent.flatMap((m) => (m.type === 'final' && m.speaker === 'owner' ? [m.text] : []))
  const texts = (sent: AsrServerMessage[]): string[] => sent.flatMap((m) => (m.type === 'final' ? [m.text] : []))

  it("a stranger's short word right after the owner spoke is never promoted to the owner", () => {
    const { gate, sent, loop, clock, session } = setupWithGate()
    session.onlyOwner(true)
    gate.answer = { speaker: 'owner', score: 0.7, seconds: 1.6 }
    feed(session, loop, [1, 2, 0])
    clock.now += 4000
    gate.answer = { speaker: 'other', score: 0.168, seconds: 0.45 }
    feed(session, loop, [1, 0])
    clock.now += 1000
    gate.answer = { speaker: 'unknown', score: 0, seconds: 0.4 }
    feed(session, loop, [3, 0])
    expect(owned(sent)).toEqual(['ava uus'])
    expect(texts(sent)).toEqual(['ava uus'])
  })

  it('a final with no verdict (no profile) is not sent with its words', () => {
    const { gate, sent, loop, session } = setupWithGate()
    session.onlyOwner(true)
    gate.answer = null
    feed(session, loop, [1, 0])
    expect(texts(sent)).toEqual([])
  })

  it('a judge that fails sends no words', async () => {
    const sent: AsrServerMessage[] = []
    const loop = new Loop()
    let calls = 0
    const decoder: Decoder = {
      accept: () => ({ text: 'saada', endpoint: true }),
      reset() {},
      close() {},
      judge() {
        calls += 1
        if (calls === 1) throw new Error('no embedding')
        return Promise.reject(new Error('worker gone'))
      },
    }
    const session = createAsrSession(decoder, (message) => sent.push(message), { schedule: loop.schedule })
    session.onlyOwner(true)
    session.audio(frame(1))
    loop.settle()
    session.audio(frame(1))
    loop.settle()
    await Promise.resolve()
    await Promise.resolve()
    loop.settle()
    expect(texts(sent)).toEqual([])
  })
})
