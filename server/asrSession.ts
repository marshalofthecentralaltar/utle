import { ASR_MAX_FRAME_BYTES, ASR_SAMPLE_RATE } from '../src/speech/asrProtocol.ts'
import type { AsrServerMessage } from '../src/speech/asrProtocol.ts'
import type { Capture } from './capture.ts'
import type { EnrolPhrase, Judgement, SpeakerGate } from './speaker.ts'
import type { FilteredFrame, SpeechFilter, VadFactory } from './vad.ts'
import { createSpeechFilter } from './vad.ts'

/** The parts of sherpa-onnx-node's OnlineStream this server uses. */
export interface OnlineStreamLike {
  acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void
}

/** The parts of sherpa-onnx-node's OnlineRecognizer this server uses. */
export interface OnlineRecognizerLike<S extends OnlineStreamLike = OnlineStreamLike> {
  createStream(): S
  isReady(stream: S): boolean
  decode(stream: S): void
  getResult(stream: S): { text: string }
  isEndpoint(stream: S): boolean
  reset(stream: S): void
}

const frameMs = (samples: Float32Array): number => (samples.length * 1000) / ASR_SAMPLE_RATE

/** What one frame of audio made of the utterance so far. On an endpoint the stream has already been reset. */
export interface DecodeResult {
  text: string
  endpoint: boolean
}

/**
 * One connection's stream of the recogniser, decoded on this thread or on a worker. The session
 * feeds it one frame at a time and waits for the result before the next, so results come in frame order.
 */
export interface Decoder {
  accept(samples: Float32Array): DecodeResult | Promise<DecodeResult>
  /** Forgets the utterance in progress. */
  reset(): void
  close(): void
  /**
   * Round 4: who spoke the utterance that has just ended (the accept that returned the endpoint)
   * or the one in progress (before a flush's reset). Null when the server has no voice profile.
   */
  judge?(): Judgement | null | Promise<Judgement | null>
  /** Round 4: learns the owner's voice from the next `seconds` of speech. Resolves once learnt, or false once given up. */
  enrol?(seconds: number): Promise<boolean>
  /**
   * Round 7: scripted enrolment. Each utterance that ends from now on is one read phrase, embedded
   * at once (onPhrase gets the count so far); after `phrases` of them, or at enrolFinish, the
   * profile is the mean. Resolves with what was learnt.
   */
  enrolScript?(phrases: number, onPhrase: (count: number) => void): Promise<ScriptResult>
  /** Round 7: ends scripted enrolment now with the phrases heard so far. */
  enrolFinish?(): void
  /** Round 7 (UTLE_CAPTURE): writes the utterance just judged (the same frames as judge) with its words. */
  capture?(text: string, judgement: Judgement | null): void | Promise<void>
}

/** Round 7: what scripted enrolment learnt. */
export interface ScriptResult {
  ok: boolean
  phrases: number
  seconds: number
}

/** Round 7: what a decoder may have besides the recogniser and the gate. */
export interface DecoderExtras {
  /** The speech detector (one per stream); null: every frame is decoded, as before round 7. */
  vad?: VadFactory | null
  /** UTLE_CAPTURE; null: nothing is written. */
  capture?: Capture | null
}

/**
 * The frames of an utterance kept for the speaker gate: at most this much (the newest). Review:
 * 8 s, not 20: an embedding of the newest eight seconds tells the voice as well, and the judgement
 * holds the decoder (the worker, or the server thread) for its length.
 */
export const MAX_KEPT_MS = 8_000
/** Enrolment gives up when this many times the asked seconds of audio have passed with too little speech in them. */
export const ENROL_PATIENCE = 4

interface Enrolment {
  frames: Float32Array[]
  speechMs: number
  totalMs: number
  seconds: number
  resolve(ok: boolean): void
}

/**
 * The recogniser's stream, decoded on the calling thread. With a speaker gate (round 4) it also
 * keeps the frames of the utterance in progress (the newest MAX_KEPT_MS) for judge, and feeds an
 * enrolment the speech frames until it has its seconds.
 *
 * Round 7: with a speech detector, each frame goes through it first (server/vad.ts). Speech reaches
 * the recogniser as heard; everything else reaches it as silence of the same length, so room noise
 * is never decoded into words and the endpoint rules still count trailing silence. Only speech is
 * kept for the speaker gate, for enrolment and for capture. Without a detector, speech is the frames
 * whose RMS is at or above SILENCE_RMS, and every frame is kept, as before.
 */
export function decoderInThread<S extends OnlineStreamLike>(recognizer: OnlineRecognizerLike<S>, gate: SpeakerGate | null = null, extras: DecoderExtras = {}): Decoder {
  const stream = recognizer.createStream()
  const filter: SpeechFilter | null = extras.vad ? createSpeechFilter(extras.vad()) : null
  const capture = extras.capture ?? null
  let kept: Float32Array[] = []
  let keptMs = 0
  /** The frames of the utterance the last accept ended, until the next frame arrives. */
  let ended: Float32Array[] | null = null
  let enrolling: Enrolment | null = null
  let scripting: Script | null = null
  /** Frames the detector passed on that come after an endpoint in the same accept: decoded at the next one. */
  let carry: FilteredFrame[] = []

  const keep = (samples: Float32Array): void => {
    kept.push(samples)
    keptMs += frameMs(samples)
    while (keptMs > MAX_KEPT_MS && kept.length > 1) {
      const oldest = kept.shift()
      if (oldest) keptMs -= frameMs(oldest)
    }
  }

  const finishEnrolment = (ok: boolean): void => {
    const e = enrolling
    enrolling = null
    e?.resolve(ok)
  }

  const feedEnrolment = (samples: Float32Array, speech: boolean, g: SpeakerGate): void => {
    const e = enrolling
    if (!e) return
    const ms = frameMs(samples)
    e.totalMs += ms
    if (speech) {
      e.frames.push(samples)
      e.speechMs += ms
    }
    if (e.speechMs >= e.seconds * 1000) finishEnrolment(g.enrol(e.frames))
    else if (e.totalMs >= e.seconds * 1000 * ENROL_PATIENCE) finishEnrolment(false)
  }

  const finishScript = (): void => {
    const sc = scripting
    scripting = null
    if (!sc) return
    const ok = gate !== null && sc.phrases.length > 0 && gate.enrolPhrases(sc.phrases)
    sc.resolve({ ok, phrases: ok ? sc.phrases.length : 0, seconds: Math.round(sc.phrases.reduce((n, p) => n + p.seconds, 0) * 10) / 10 })
  }

  /** An utterance ended while reading phrases: its speech is one phrase, when long enough. */
  const takePhrase = (frames: Float32Array[]): void => {
    const sc = scripting
    if (!sc || !gate) return
    const phrase = gate.phrase(filter ? frames : frames.filter((frame) => rms(frame) >= SILENCE_RMS))
    if (!phrase) return
    sc.phrases.push(phrase)
    sc.onPhrase(sc.phrases.length)
    if (sc.phrases.length >= sc.wanted) finishScript()
  }

  /** One frame into the recogniser; true when it ended the utterance. */
  const decodeOne = (part: FilteredFrame): boolean => {
    stream.acceptWaveform({ samples: part.samples, sampleRate: ASR_SAMPLE_RATE })
    while (recognizer.isReady(stream)) recognizer.decode(stream)
    if (gate) {
      // Without a detector every frame is kept, as before; with one, only speech.
      if (!filter || part.speech) keep(part.samples)
      feedEnrolment(part.samples, part.speech, gate)
    }
    return recognizer.isEndpoint(stream)
  }

  return {
    accept(samples) {
      const parts: FilteredFrame[] = [...carry, ...(filter ? filter.push(samples) : [{ samples, speech: rms(samples) >= SILENCE_RMS }])]
      carry = []
      let endpoint = false
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i]
        if (!part) continue
        endpoint = decodeOne(part)
        if (endpoint) {
          carry = parts.slice(i + 1)
          break
        }
      }
      const text = recognizer.getResult(stream).text.trim()
      if (endpoint) recognizer.reset(stream)
      if (gate) {
        if (endpoint) {
          ended = kept
          kept = []
          keptMs = 0
          if (text !== '') takePhrase(ended)
        } else if (parts.length > 0) ended = null
      }
      return { text, endpoint }
    },
    reset() {
      recognizer.reset(stream)
      // A flush ends the utterance: while reading phrases, what was said up to it is one.
      if (scripting && kept.length > 0) takePhrase(kept)
      kept = []
      keptMs = 0
      ended = null
    },
    close() {
      // sherpa frees the stream with its object.
      finishEnrolment(false)
      const sc = scripting
      scripting = null
      sc?.resolve({ ok: false, phrases: 0, seconds: 0 })
    },
    judge() {
      if (!gate) return null
      return gate.judge(ended ?? kept)
    },
    enrol(seconds) {
      if (!gate) return Promise.resolve(false)
      finishEnrolment(false)
      return new Promise<boolean>((resolve) => {
        enrolling = { frames: [], speechMs: 0, totalMs: 0, seconds, resolve }
      })
    },
    enrolScript(phrases, onPhrase) {
      if (!gate) return Promise.resolve({ ok: false, phrases: 0, seconds: 0 })
      const earlier = scripting
      scripting = null
      earlier?.resolve({ ok: false, phrases: 0, seconds: 0 })
      return new Promise<ScriptResult>((resolve) => {
        scripting = { wanted: phrases, phrases: [], onPhrase, resolve }
      })
    },
    enrolFinish() {
      finishScript()
    },
    capture(text, judgement) {
      capture?.write(ended ?? kept, judgement, text)
    },
  }
}

interface Script {
  wanted: number
  phrases: EnrolPhrase[]
  onPhrase(count: number): void
  resolve(result: ScriptResult): void
}

/** Audio queued ahead of the decoder beyond this is a backlog: the oldest of it is dropped. */
export const MAX_BACKLOG_MS = 1500
/** What is left queued after a drop. */
export const KEEP_MS = 300
/** A lag message is sent at most this often. */
export const LAG_REPORT_MS = 500
/** A frame whose RMS is below this is quiet: a drop ends at one when one is near, not in the middle of a word. */
export const SILENCE_RMS = 0.01
/** How much further than KEEP_MS a drop may go to end at a quiet frame. */
export const CUT_SEARCH_MS = 300

export interface AsrSession {
  /** Queues one frame. Never blocks: frames are decoded from the queue, one per turn of the event loop. */
  audio(samples: Float32Array): void
  /** Decodes what is queued, sends the utterance so far as a final, and starts the next utterance. */
  flush(): void
  close(): void
  /** Audio queued and not yet decoded. */
  backlogMs(): number
  stats(): { receivedMs: number; decodedMs: number; droppedMs: number; foreignFinals: number }
  /** Round 4: learns the owner's voice from the next `seconds` of speech, then sends `enrolled`. */
  enrol(seconds: number): void
  /**
   * Round 4: the client wants only the owner's words. Finals of others are still sent, with their
   * speaker; this only counts them (round 7: `other` and `unknown`, as strict mode drops both).
   */
  onlyOwner(on: boolean): void
  /** Round 7: scripted enrolment of `phrases` read phrases; `enrolPhrase` after each, `enrolled` at the end. */
  enrolScript(phrases: number): void
  /** Round 7: ends scripted enrolment with the phrases heard so far. */
  enrolFinish(): void
}

export interface AsrSessionOptions {
  /** Runs the next decode step on a later turn. Default setImmediate; tests run the steps by hand. */
  schedule?: (step: () => void) => void
  /** The clock behind the lag report rate. Default Date.now. */
  now?: () => number
  /** The decoder failed; the caller closes the connection. */
  onError?: (error: unknown) => void
  /** Each final's verdict, for the server log: numbers only, never the text. */
  onJudged?: (judgement: Judgement, onlyOwner: boolean) => void
}

interface QueuedFrame {
  samples: Float32Array
  ms: number
  quiet: boolean
}

type Queued = QueuedFrame | 'flush'

/** Root mean square of a frame: how loud it is, cheaply. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i] ?? 0
    sum += sample * sample
  }
  return Math.sqrt(sum / samples.length)
}

/**
 * One connection's utterance stream. Frames go into a bounded queue and are decoded from a drain
 * loop that gives the event loop a turn between frames, so a slow decode never holds up the rest of
 * the server. When decoding falls more than MAX_BACKLOG_MS behind, the oldest audio is dropped down
 * to KEEP_MS (the cut moved on to a quiet frame when one is within CUT_SEARCH_MS) and a lag message
 * says how far behind it was; a lag of 0 follows once the queue has emptied, at most every
 * LAG_REPORT_MS. A flush decodes the queue, sends the utterance so far as a final and resets the
 * stream. Reports the text as it changes, and a final at each endpoint. Round 4: before a final
 * goes, the decoder judges whose voice it was (when the server has a profile) and the final carries
 * `speaker`; nothing is sent until the judgement is in, so the final and its speaker are one frame.
 * Never logs: the text is the user's.
 */
export function createAsrSession(decoder: Decoder, send: (message: AsrServerMessage) => void, options: AsrSessionOptions = {}): AsrSession {
  const schedule = options.schedule ?? ((step: () => void) => setImmediate(step))
  const now = options.now ?? (() => Date.now())
  const queue: Queued[] = []
  let queuedMs = 0
  let receivedMs = 0
  let decodedMs = 0
  let droppedMs = 0
  let last = ''
  let closed = false
  let draining = false
  let lagging = false
  let lastReport = -Infinity
  let onlyOwner = false
  let foreignFinals = 0

  const report = (ms: number): void => {
    send({ type: 'lag', ms })
    lastReport = now()
    lagging = ms > 0
  }

  const loud = (index: number): boolean => {
    const item = queue[index]
    return item !== undefined && item !== 'flush' && !item.quiet
  }

  /** Drops the oldest audio until KEEP_MS is left; a cut between two loud frames moves on to the next quiet one when near. */
  const dropOldest = (): void => {
    const backlog = queuedMs
    let cut = 0
    let left = queuedMs
    while (cut < queue.length && left > KEEP_MS) {
      const item = queue[cut]
      if (item !== undefined && item !== 'flush') left -= item.ms
      cut += 1
    }
    if (loud(cut - 1) && loud(cut)) {
      let searched = 0
      for (let at = cut; at < queue.length && searched < CUT_SEARCH_MS; at += 1) {
        const item = queue[at]
        if (item === undefined || item === 'flush') break
        searched += item.ms
        if (item.quiet) {
          cut = at + 1
          break
        }
      }
    }
    // A flush marker among the dropped frames is kept: the final it asks for is still owed.
    const kept: Queued[] = []
    for (const item of queue.slice(0, cut)) {
      if (item === 'flush') kept.push(item)
      else {
        queuedMs -= item.ms
        droppedMs += item.ms
      }
    }
    queue.splice(0, cut, ...kept)
    if (!lagging || now() - lastReport >= LAG_REPORT_MS) report(backlog)
  }

  const failed = (error: unknown): void => {
    draining = false
    options.onError?.(error)
  }

  /**
   * Sends text as a final, with the speaker when the decoder can judge one, then goes on. A judge
   * that fails (review) loses the verdict, not the words: the final goes without a speaker.
   */
  const sendFinal = (text: string, then: () => void): void => {
    const deliver = (judgement: Judgement | null | undefined): void => {
      if (closed) return
      if (judgement) {
        send({ type: 'final', text, speaker: judgement.speaker })
        options.onJudged?.(judgement, onlyOwner)
        if (onlyOwner && judgement.speaker !== 'owner') foreignFinals += 1
      } else send({ type: 'final', text })
      // Round 7: UTLE_CAPTURE writes the clip and its words; without it the decoder does nothing here.
      try {
        void Promise.resolve(decoder.capture?.(text, judgement ?? null)).catch(() => undefined)
      } catch {
        // Calibration only: never in the way of the words.
      }
      then()
    }
    let judged: Judgement | null | Promise<Judgement | null> | undefined
    try {
      judged = decoder.judge?.()
    } catch {
      deliver(null)
      return
    }
    if (judged instanceof Promise) judged.then(deliver, () => deliver(null))
    else deliver(judged)
  }

  /** The partial for a frame's result, then the final when it ended the utterance; `then` once the final is away. */
  const finish = (result: DecodeResult, then: () => void): void => {
    const text = result.text.trim()
    if (text !== last && text !== '') send({ type: 'partial', text })
    last = text
    if (!result.endpoint) {
      then()
      return
    }
    last = ''
    if (text === '') then()
    else sendFinal(text, then)
  }

  const step = (): void => {
    if (closed) {
      draining = false
      return
    }
    const item = queue.shift()
    if (item === undefined) {
      draining = false
      if (lagging && now() - lastReport >= LAG_REPORT_MS) report(0)
      return
    }
    if (item === 'flush') {
      const text = last
      last = ''
      const next = (): void => {
        decoder.reset()
        schedule(step)
      }
      // Judged before the reset: the frames of the utterance in progress are still the decoder's.
      if (text !== '') sendFinal(text, next)
      else next()
      return
    }
    queuedMs -= item.ms
    const done = (result: DecodeResult): void => {
      if (closed) return
      decodedMs += item.ms
      finish(result, () => schedule(step))
    }
    try {
      const result = decoder.accept(item.samples)
      if (result instanceof Promise) result.then(done, failed)
      else done(result)
    } catch (error) {
      failed(error)
    }
  }

  const drain = (): void => {
    if (draining || closed) return
    draining = true
    schedule(step)
  }

  return {
    audio(samples) {
      if (closed) return
      const ms = frameMs(samples)
      receivedMs += ms
      queuedMs += ms
      queue.push({ samples, ms, quiet: rms(samples) < SILENCE_RMS })
      if (queuedMs > MAX_BACKLOG_MS) dropOldest()
      drain()
    },
    flush() {
      if (closed) return
      queue.push('flush')
      drain()
    },
    close() {
      closed = true
      queue.length = 0
      queuedMs = 0
      decoder.close()
    },
    backlogMs() {
      return queuedMs
    },
    stats() {
      return { receivedMs, decodedMs, droppedMs, foreignFinals }
    },
    enrol(seconds) {
      if (closed) return
      const learning = decoder.enrol?.(seconds)
      if (!learning) {
        send({ type: 'enrolled', ok: false, seconds })
        return
      }
      learning.then(
        (ok) => {
          if (!closed) send({ type: 'enrolled', ok, seconds })
        },
        () => {
          if (!closed) send({ type: 'enrolled', ok: false, seconds })
        },
      )
    },
    onlyOwner(on) {
      onlyOwner = on
    },
    enrolScript(phrases) {
      if (closed) return
      const learning = decoder.enrolScript?.(phrases, (count) => {
        if (!closed) send({ type: 'enrolPhrase', count })
      })
      if (!learning) {
        send({ type: 'enrolled', ok: false, seconds: 0, phrases: 0 })
        return
      }
      learning.then(
        (result) => {
          if (!closed) send({ type: 'enrolled', ok: result.ok, seconds: result.seconds, phrases: result.phrases })
        },
        () => {
          if (!closed) send({ type: 'enrolled', ok: false, seconds: 0, phrases: 0 })
        },
      )
    },
    enrolFinish() {
      if (closed) return
      decoder.enrolFinish?.()
    },
  }
}

/** Samples from one binary frame, or null when the frame is not whole float32 samples of at most a second. */
export function samplesFromFrame(frame: Buffer): Float32Array | null {
  if (frame.byteLength === 0 || frame.byteLength % 4 !== 0 || frame.byteLength > ASR_MAX_FRAME_BYTES) return null
  // Copy: the socket's buffer may not be aligned for a Float32Array view.
  const copy = new Uint8Array(frame.byteLength)
  copy.set(frame)
  return new Float32Array(copy.buffer)
}
