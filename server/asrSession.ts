import { randomUUID } from 'node:crypto'
import { ASR_FRAME_SAMPLES, ASR_MAX_FRAME_BYTES, ASR_SAMPLE_RATE, ENDPOINT_TRAILING_MS, verdictFor } from '../src/speech/asrProtocol.ts'
import type { AsrServerMessage, EndCause, EndpointMode, EnrolFailure, FinalWhy, HeldOutResult, PhraseProblem, SpeakerDecision, SpeakerReadiness, SpeakerReason } from '../src/speech/asrProtocol.ts'
import type { Capture } from './capture.ts'
import type { EnrolPhrase, Judgement, SpeakerGate, SpeakerTest, SpeakerVerification } from './speaker.ts'
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
  /** Round 10 (#7, lane LATE): sherpa-onnx also gives each token's time (s) from start_time (s since the stream began). */
  getResult(stream: S): { text: string; timestamps?: number[]; start_time?: number }
  isEndpoint(stream: S): boolean
  reset(stream: S): void
}

const frameMs = (samples: Float32Array): number => (samples.length * 1000) / ASR_SAMPLE_RATE

/** What one frame of audio made of the utterance so far. On an endpoint the stream has already been reset. */
export interface DecodeResult {
  text: string
  endpoint: boolean
  /** Round 10 (#7, 33.3): ms of audio since the speech detector last heard speech in this utterance. */
  quietMs?: number
  /** Round 10 (#7, lane LATE): where the recogniser and the detector stand, in the session's audio (numbers only). */
  why?: DecodeWhy
  /** Round 10 (#7, lane LATE review 2): the speech detector heard speech start in this frame. */
  onset?: boolean
}

/** Round 10 (#7, lane LATE): the decoder's part of a final's why. cause only on an endpoint. */
export interface DecodeWhy {
  cause?: EndCause
  speechEndMs: number | null
  lastTokenMs: number | null
  extraMs: number
  paddedMs?: number
}

/**
 * Round 10 (#7, lane LATE, ARCHITECTURE 33.2): the most hiss handed to the recogniser ahead of time in one utterance.
 * Measured on the 18 clips: its rule needed at most 1.3 s of it; noise the detector took for speech, with no
 * words, costs at most this much decoding once.
 */
export const MAX_PAD_MS = 2000

/** Round 10 (#7, lane LATE): rule 3 of the recogniser (asrModel.ts rule3MinUtteranceLength), for naming the cause. */
export const RULE3_MS = 30_000

/**
 * One connection's stream of the recogniser, decoded on this thread or on a worker. The session
 * feeds it one frame at a time and waits for the result before the next, so results come in frame order.
 */
export interface Decoder {
  accept(samples: Float32Array): DecodeResult | Promise<DecodeResult>
  /** Forgets the utterance in progress. */
  reset(): void
  close(): void
  /** Round 10 (#7, 33.2): the trailing silence that ends an utterance from the next frame on. */
  endpointMode?(mode: EndpointMode): void
  /**
   * Round 4: who spoke the utterance that has just ended (the accept that returned the endpoint)
   * or the one in progress (before a flush's reset). Null when the server has no voice profile.
   */
  judge?(): Judgement | null | Promise<Judgement | null>
  /**
   * Round 10 (31.2): the fail-closed check of the same frames as judge, used with only the owner
   * on. Absent (no gate at all) or failing: the utterance is denied.
   */
  verify?(): SpeakerVerification | Promise<SpeakerVerification>
  /** Round 10 (31.1): the stored profile's version (empty without one), for the speakerSession announcement. */
  profileVersion?(): string | Promise<string>
  /** Round 4: learns the owner's voice from the next `seconds` of speech. Resolves once learnt, or false once given up. */
  enrol?(seconds: number): Promise<boolean>
  /**
   * Round 7: scripted enrolment. Each utterance that ends from now on is one read phrase, embedded
   * at once (onPhrase gets the count so far); after `phrases` of them, or at enrolFinish, the
   * profile is the mean. Resolves with what was learnt.
   */
  enrolScript?(phrases: number, onPhrase: (count: number, problem?: PhraseProblem) => void): Promise<ScriptResult>
  /** Round 7: ends scripted enrolment now with the phrases heard so far. */
  enrolFinish?(): void
  /** Round 7 (UTLE_CAPTURE): writes the utterance just judged (the same frames as judge) with its words. */
  capture?(text: string, judgement: Judgement | null): void | Promise<void>
  /** Round 10 (31.7): whether the gate can protect (extractor, profile of this model, held-out verified). */
  readiness?(): SpeakerReadiness | Promise<SpeakerReadiness>
  /** Round 10 (31.7): the voice test of the utterance that just ended (the same frames as verify). */
  test?(): SpeakerTest | Promise<SpeakerTest>
  /** Round 10 (31.7): deletes the profile. */
  deleteProfile?(): boolean | Promise<boolean>
}

/** Round 10 (31.7): the readiness without a gate: never protected. */
export const NO_GATE_READINESS: SpeakerReadiness = { state: 'model_unavailable', protected: false, extractor: false, profileMatchesModel: false, verifiable: false }

/** Round 7: what scripted enrolment learnt. */
export interface ScriptResult {
  ok: boolean
  phrases: number
  seconds: number
  /** Round 10 (31.7): why nothing was replaced. */
  reason?: EnrolFailure
  /** Round 10 (31.7): the candidate's held-out scores. */
  heldOut?: HeldOutResult
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
    if (e.speechMs >= e.seconds * 1000) finishEnrolment(g.enrolSpeech(e.frames).ok)
    else if (e.totalMs >= e.seconds * 1000 * ENROL_PATIENCE) finishEnrolment(false)
  }

  const finishScript = (): void => {
    const sc = scripting
    scripting = null
    if (!sc) return
    if (gate === null || sc.phrases.length === 0) {
      sc.resolve({ ok: false, phrases: 0, seconds: 0, reason: 'too_few_phrases' })
      return
    }
    // Round 10 (31.7): the gate builds the candidate, verifies it on the held-out phrases and writes it only when it passes.
    const outcome = gate.enrolScripted(sc.phrases)
    if (outcome.ok) sc.resolve({ ok: true, phrases: outcome.phrases, seconds: outcome.seconds, heldOut: outcome.heldOut })
    else sc.resolve({ ok: false, phrases: 0, seconds: 0, reason: outcome.reason, ...(outcome.heldOut === undefined ? {} : { heldOut: outcome.heldOut }) })
  }

  /** An utterance ended while reading phrases: its speech is one phrase, when long enough. */
  const takePhrase = (frames: Float32Array[]): void => {
    const sc = scripting
    if (!sc || !gate) return
    // Round 10 (31.7): a phrase without enough clean speech is asked again with its reason (the count stays).
    const assessed = gate.assessPhrase(filter ? frames : frames.filter((frame) => rms(frame) >= SILENCE_RMS))
    if (assessed.phrase === null) {
      sc.onPhrase(sc.phrases.length, assessed.problem ?? 'too_short')
      return
    }
    sc.phrases.push(assessed.phrase)
    sc.onPhrase(sc.phrases.length)
    if (sc.phrases.length >= sc.wanted) finishScript()
  }

  // ---------- round 10 (#7, ARCHITECTURE 33.2 and 33.3): endpointing per mode, the quiet after words ----------
  /**
   * The mode the client last asked for. The recogniser's own rule 2 is the command one (asrModel).
   * A client that never says (the dev page, `npm run smoke`, an older client) keeps dictation, the
   * 1.0 s it had before round 10; the extension always says.
   */
  let mode: EndpointMode = 'dictation'
  /** Audio decoded since the recogniser's rule first said the utterance ended; null while it has not. */
  let pastRuleMs: number | null = null
  /** The words after the frame before. */
  let wordsBefore = ''
  /** Audio since the speech detector last heard speech in this utterance. */
  let quietMs = 0
  /** Round 10 (#7, lane LATE): audio sent by the client (accept), audio given to the recogniser (pre-roll replays included), and since its last reset. */
  let inputMs = 0
  let fedMs = 0
  let utteranceMs = 0
  let cause: EndCause = 'rule2'
  /** Round 10 (#7, lane LATE): hiss handed ahead of time in this utterance, and where in the session's audio it began. */
  let paddedMs = 0
  let utteranceStartMs = 0
  /**
   * Round 10 (#7, lane LATE review 2): hiss the recogniser already decoded ahead of time (endOnSilence) and so skips
   * as the same amount of not-speech arrives; and whether the last part was speech (the detector's onset).
   */
  let aheadMs = 0
  let lastSpeech = false
  const forgetUtterance = (): void => {
    pastRuleMs = null
    wordsBefore = ''
    quietMs = 0
    utteranceMs = 0
    paddedMs = 0
    utteranceStartMs = inputMs
  }
  /**
   * Round 10 (#7, lane LATE, ARCHITECTURE 33.2). The speech detector has heard the mode's silence (command 0.6 s,
   * dictation 1.0 s) since speech in this utterance ended. The recogniser learns it only later: it decodes 640 ms
   * chunks, needs about 200 ms of audio past each, puts the last token up to half a second after the speech, and
   * counts its rule from that token (measured 2026-11-02: the final came 1.6 to 1.9 s after a command's speech end).
   * What it would hear meanwhile is known: the detector hands it hiss for all that is not speech. So it gets that hiss
   * now, as fast as it decodes, until its own rule ends the utterance (the words are its own, from the same input),
   * at most MAX_PAD_MS. Never before the mode's silence, and not at all without a detector.
   */
  const endOnSilence = (f: SpeechFilter): boolean => {
    const end = f.speechEndMs()
    if (end === null || end <= utteranceStartMs || paddedMs >= MAX_PAD_MS || f.silenceMs() < ENDPOINT_TRAILING_MS[mode]) return false
    while (paddedMs < MAX_PAD_MS) {
      const samples = f.hiss(ASR_FRAME_SAMPLES)
      paddedMs += frameMs(samples)
      if (decodeOne({ samples, speech: false }, true)) {
        if (cause !== 'rule1') cause = 'detector'
        return true
      }
    }
    return false
  }
  /**
   * Whether the utterance ends with this frame. Rule 1 (nothing heard) ends as the recogniser says.
   * Rule 2 ends a command at once; dictation waits the difference to its longer silence. The words
   * must not have changed in the frame the rule fired on: an endpoint never cuts inside a word the
   * recogniser is still deciding (a beam search changing its mind); that frame waits for the next.
   */
  const ends = (ms: number): boolean => {
    const words = recognizer.getResult(stream).text.trim()
    const changed = words !== wordsBefore
    wordsBefore = words
    if (!recognizer.isEndpoint(stream)) {
      pastRuleMs = null
      return false
    }
    cause = words === '' ? 'rule1' : utteranceMs >= RULE3_MS ? 'rule3' : 'rule2'
    if (words === '') return true
    if (changed) {
      pastRuleMs = null
      return false
    }
    pastRuleMs = pastRuleMs === null ? 0 : pastRuleMs + ms
    return pastRuleMs >= ENDPOINT_TRAILING_MS[mode] - ENDPOINT_TRAILING_MS.command
  }
  // ---------- end of endpointing per mode ----------

  /** One frame into the recogniser; true when it ended the utterance. Hiss handed ahead of time (ahead) is no one's audio. */
  const decodeOne = (part: FilteredFrame, ahead = false): boolean => {
    stream.acceptWaveform({ samples: part.samples, sampleRate: ASR_SAMPLE_RATE })
    fedMs += frameMs(part.samples)
    utteranceMs += frameMs(part.samples)
    while (recognizer.isReady(stream)) recognizer.decode(stream)
    if (ahead) return ends(frameMs(part.samples))
    if (gate) {
      // Without a detector every frame is kept, as before; with one, only speech.
      if (!filter || part.speech) keep(part.samples)
      feedEnrolment(part.samples, part.speech, gate)
    }
    quietMs = part.speech ? 0 : quietMs + frameMs(part.samples)
    return ends(frameMs(part.samples))
  }

  return {
    accept(samples) {
      inputMs += frameMs(samples)
      const parts: FilteredFrame[] = [...carry, ...(filter ? filter.push(samples) : [{ samples, speech: rms(samples) >= SILENCE_RMS }])]
      carry = []
      let endpoint = false
      let onset = false
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i]
        if (!part) continue
        if (filter && part.speech && !lastSpeech) onset = true
        lastSpeech = part.speech
        // Round 10 (#7, lane LATE review 2): the recogniser decoded this much hiss ahead of time to end the last
        // utterance (endOnSilence); the same amount of not-speech is skipped as it arrives, so nothing is decoded
        // twice. Speech is never skipped: it ends the skip (an onset decodes as always, its pre-roll included).
        if (part.speech) aheadMs = 0
        else if (aheadMs > 0) {
          aheadMs -= frameMs(part.samples)
          quietMs += frameMs(part.samples)
          continue
        }
        endpoint = decodeOne(part)
        if (endpoint) {
          carry = parts.slice(i + 1)
          break
        }
      }
      if (!endpoint && filter) endpoint = endOnSilence(filter)
      const result = recognizer.getResult(stream)
      const text = result.text.trim()
      const quiet = quietMs
      // Round 10 (#7, lane LATE): the recogniser's clock runs ahead of the session's by the replayed pre-roll.
      const stamps = result.timestamps ?? []
      const lastStamp = stamps.length > 0 ? ((result.start_time ?? 0) + (stamps[stamps.length - 1] ?? 0)) * 1000 : null
      const extraMs = fedMs - inputMs - paddedMs
      const why: DecodeWhy = { speechEndMs: filter?.speechEndMs() ?? null, lastTokenMs: lastStamp === null ? null : lastStamp - extraMs, extraMs, ...(endpoint ? { cause } : {}), ...(paddedMs > 0 ? { paddedMs } : {}) }
      if (endpoint) {
        if (cause === 'detector') aheadMs = paddedMs
        recognizer.reset(stream)
        forgetUtterance()
      }
      if (gate) {
        if (endpoint) {
          ended = kept
          kept = []
          keptMs = 0
          if (text !== '') takePhrase(ended)
        } else if (parts.length > 0) ended = null
      }
      return { text, endpoint, quietMs: quiet, why, ...(onset ? { onset: true } : {}) }
    },
    endpointMode(next) {
      mode = next
    },
    reset() {
      forgetUtterance()
      // Round 10 (31.7): only frames the recogniser made words of are a phrase attempt; the residue
      // after an endpoint (a breath, a tail) would otherwise answer a spurious too_short.
      const words = /[\p{L}\p{N}]/u.test(recognizer.getResult(stream).text)
      recognizer.reset(stream)
      // A flush ends the utterance: while reading phrases, what was said up to it is one.
      if (scripting && words && kept.length > 0) takePhrase(kept)
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
    verify() {
      if (!gate) return { judgement: null, reason: 'profile_missing', profileVersion: '' }
      return gate.verify(ended ?? kept)
    },
    profileVersion() {
      return gate?.profileVersion() ?? ''
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
    readiness() {
      return gate?.readiness() ?? NO_GATE_READINESS
    },
    test() {
      return gate?.test(ended ?? kept) ?? { result: 'unavailable' }
    },
    deleteProfile() {
      return gate?.deleteProfile() ?? false
    },
  }
}

interface Script {
  wanted: number
  phrases: EnrolPhrase[]
  onPhrase(count: number, problem?: PhraseProblem): void
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
/** Round 10 (#7, 33.3): silence after words, by the speech detector, that sends a pause before the final. */
export const PAUSE_MS = 300

export interface AsrSession {
  /** Queues one frame. Never blocks: frames are decoded from the queue, one per turn of the event loop. */
  audio(samples: Float32Array): void
  /** Round 10 (#7, 33.2): the trailing silence that ends an utterance from now on (command 0.6 s, dictation 1.0 s). */
  endpointMode(mode: EndpointMode): void
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
  /** Round 10 (31.7): sends speakerStatus with the gate's readiness. */
  speakerStatus(): void
  /** Round 10 (31.7): the next utterance is a voice test: speakerTested, never a final. */
  speakerTest(): void
  /** Round 10 (31.7): deletes the profile, then profileDeleted, the new version (mode on) and speakerStatus. */
  profileDelete(): void
  /** Round 10 (#7, lane LATE): each final from now on carries its why (timings and a cause, never words). */
  trace(on: boolean): void
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
  /** Round 10 (#7, lane LATE): what ended each utterance that had words, for the server log: numbers and a cause only. */
  onEnded?: (why: FinalWhy) => void
  /** Round 10 (31.1): this session's id in every decision. Default a random UUID. */
  sessionId?: string
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
  /** Round 10 (31.1): the session id every decision carries, and the count of finals decided (the segment ids). */
  const sessionId = options.sessionId ?? randomUUID()
  let segments = 0
  /** Round 10 (review 2): the profile version last announced, for a rejection made without a verification. */
  let announced = ''
  /** Round 10 (review 2): words of the utterance in progress were signalled (a partial or an activity) and not yet closed. */
  let signalled = false
  /** Round 10 (31.7): the next utterance with words is a voice test. */
  let testing = false
  /** Round 10 (#7, 33.3): the words of the utterance in progress a pause was sent for. */
  let paused = ''
  // ---------- round 10 (#7, lane LATE): what ended each utterance ----------
  let tracing = false
  /** Wall time of the first frame; the session's wall clock starts there. */
  let startedAt: number | null = null
  /** Session audio when the words of the utterance in progress first had n words (index n), and when they last changed. */
  let firstAtWords: number[] = []
  let lastChangeMs: number | null = null
  let droppedBefore = 0
  let progress: DecodeWhy = { speechEndMs: null, lastTokenMs: null, extraMs: 0 }
  const noteWords = (text: string): void => {
    const count = text === '' ? 0 : text.split(/\s+/).length
    for (let n = firstAtWords.length; n <= count; n += 1) firstAtWords[n] = decodedMs
    lastChangeMs = decodedMs
  }
  const forgetWords = (): void => {
    firstAtWords = []
    lastChangeMs = null
    droppedBefore = droppedMs
  }
  /** The why of the utterance that ends now, from the count of the words it ended with. */
  const whyNow = (text: string, decoderWhy: DecodeWhy, cause: EndCause): FinalWhy => {
    const why: FinalWhy = {
      cause,
      audioMs: decodedMs,
      wallMs: 0,
      speechEndMs: decoderWhy.speechEndMs,
      lastTokenMs: decoderWhy.lastTokenMs,
      lastWordMs: firstAtWords[text.split(/\s+/).length] ?? null,
      lastChangeMs,
      extraMs: decoderWhy.extraMs,
      droppedMs: droppedMs - droppedBefore,
      ...(decoderWhy.paddedMs === undefined ? {} : { paddedMs: decoderWhy.paddedMs }),
    }
    forgetWords()
    return why
  }
  /** Logs the why and, when traced, puts it on the final. wallMs is taken as the message goes. */
  const withWhy = <M extends AsrServerMessage>(message: M, why: FinalWhy | null): M => {
    if (why === null) return message
    const stamped = { ...why, wallMs: startedAt === null ? 0 : now() - startedAt }
    options.onEnded?.(stamped)
    return tracing && message.type === 'final' ? { ...message, why: stamped } : message
  }
  // ---------- end of what ended each utterance ----------

  /** Round 10 (31.7): sends speakerStatus; a decoder without readiness (no gate) is never protected. */
  const tellStatus = (): void => {
    let readiness: SpeakerReadiness | Promise<SpeakerReadiness>
    try {
      readiness = decoder.readiness?.() ?? NO_GATE_READINESS
    } catch {
      readiness = NO_GATE_READINESS
    }
    const tell = (value: SpeakerReadiness): void => {
      if (!closed) send({ type: 'speakerStatus', readiness: value })
    }
    if (readiness instanceof Promise) readiness.then(tell, () => tell(NO_GATE_READINESS))
    else tell(readiness)
  }

  /** Round 10 (31.7): the voice test of the utterance that ended: speakerTested only, the words go nowhere. */
  const runTest = (then: () => void): void => {
    testing = false
    let tested: SpeakerTest | Promise<SpeakerTest>
    try {
      tested = decoder.test?.() ?? { result: 'unavailable' }
    } catch {
      tested = { result: 'unavailable' }
    }
    const tell = (value: SpeakerTest): void => {
      if (closed) return
      send({ type: 'speakerTested', ...value })
      then()
    }
    if (tested instanceof Promise) tested.then(tell, () => tell({ result: 'unavailable' }))
    else tell(tested)
  }

  /**
   * Round 10 (review 2): with only the owner on, an utterance the client was told about (activity)
   * whose words came to nothing (the recogniser's text went empty at the endpoint or before a
   * flush) is closed with a rejection, insufficient_audio, never left open. Measured 2026-10-27: a
   * one-word "jah" after another voice in the same session showed a partial and then neither a
   * final nor anything else, on main with the mode off too.
   */
  const closeEmpty = (): void => {
    const had = signalled
    signalled = false
    if (!had || !onlyOwner) return
    segments += 1
    send({ type: 'rejected', decision: { segmentId: segments, sessionId, profileVersion: announced, verdict: 'unknown', reason: 'insufficient_audio', timings: { judgeMs: 0 } } })
    foreignFinals += 1
  }

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

  /** Round 10 (31.2): tells the client the session and profile version its decisions must carry. */
  const announce = (): void => {
    let version: string | Promise<string>
    try {
      version = decoder.profileVersion?.() ?? ''
    } catch {
      version = ''
    }
    const tell = (profileVersion: string): void => {
      announced = profileVersion
      if (!closed && onlyOwner) send({ type: 'speakerSession', sessionId, profileVersion })
    }
    if (version instanceof Promise) version.then(tell, () => tell(''))
    else tell(version)
  }

  /** Round 10 (31.2): writes the clip with UTLE_CAPTURE; never in the way of the words. */
  const captured = (text: string, judgement: Judgement | null): void => {
    try {
      void Promise.resolve(decoder.capture?.(text, judgement)).catch(() => undefined)
    } catch {
      // Calibration only.
    }
  }

  /**
   * Round 10 (31.2): with only the owner on, the final's own frames are verified; only
   * verified_owner sends the words, with the decision. Anything else, a missing verify and a verify
   * that fails included, sends a rejection without the words.
   */
  const sendVerified = (text: string, why: FinalWhy | null, then: () => void): void => {
    const started = now()
    segments += 1
    const segment = segments
    const decide = (verification: SpeakerVerification | null): void => {
      if (closed) return
      const reason: SpeakerReason = verification?.reason ?? 'verification_error'
      const judgement = verification?.judgement ?? null
      const decision: SpeakerDecision = {
        segmentId: segment,
        sessionId,
        profileVersion: verification?.profileVersion ?? '',
        verdict: verdictFor(reason),
        reason,
        timings: judgement?.seconds === undefined ? { judgeMs: Math.max(0, now() - started) } : { judgeMs: Math.max(0, now() - started), speechMs: Math.round(judgement.seconds * 1000) },
      }
      if (judgement !== null && judgement.score !== 0) decision.score = judgement.score
      if (reason === 'verified_owner') send(withWhy({ type: 'final', text, speaker: 'owner', segment, decision }, why))
      else {
        send(withWhy({ type: 'rejected', decision }, why))
        foreignFinals += 1
      }
      options.onJudged?.({ speaker: decision.verdict, score: judgement?.score ?? 0, ...(judgement?.seconds === undefined ? {} : { seconds: judgement.seconds }), reason }, true)
      captured(text, judgement)
      then()
    }
    let verified: SpeakerVerification | Promise<SpeakerVerification> | undefined
    try {
      verified = decoder.verify?.()
    } catch {
      decide(null)
      return
    }
    if (verified instanceof Promise) verified.then(decide, () => decide(null))
    else decide(verified ?? null)
  }

  /**
   * Sends text as a final, with the speaker when the decoder can judge one, then goes on. A judge
   * that fails (review) loses the verdict, not the words: the final goes without a speaker.
   * Round 10: with only the owner on, sendVerified instead (fail closed).
   */
  const sendFinal = (text: string, why: FinalWhy | null, then: () => void): void => {
    if (testing) {
      runTest(then)
      return
    }
    if (onlyOwner) {
      sendVerified(text, why, then)
      return
    }
    const deliver = (judgement: Judgement | null | undefined): void => {
      if (closed) return
      if (judgement) {
        send(withWhy({ type: 'final', text, speaker: judgement.speaker }, why))
        options.onJudged?.(judgement, onlyOwner)
        if (onlyOwner && judgement.speaker !== 'owner') foreignFinals += 1
      } else send(withWhy({ type: 'final', text }, why))
      // Round 7: UTLE_CAPTURE writes the clip and its words; without it the decoder does nothing here.
      captured(text, judgement ?? null)
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
    // Round 7: text with no letter or digit (a lone "." the recogniser can make of a breath) is no words.
    const heard = result.text.trim()
    const text = /[\p{L}\p{N}]/u.test(heard) ? heard : ''
    // Round 10 (#7, lane LATE review 2): speech started: a wordless activity in both modes (never a voice test), so a
    // final the client holds waits for what follows; it signals no utterance (nothing is closed for it).
    if (result.onset === true && !testing) send({ type: 'activity', onset: true })
    // Round 10 (31.2): with only the owner on, unverified words never leave the server: the client
    // gets a wordless activity signal instead of the partial (it keeps the assembler's hold alive).
    // Round 10 (31.7): a voice test sends no partial words either: nothing of it may reach a page.
    if (text !== last && text !== '' && !testing) {
      send(onlyOwner ? { type: 'activity' } : { type: 'partial', text })
      signalled = true
    }
    if (result.why) progress = result.why
    if (text !== last) noteWords(text)
    last = text
    if (!result.endpoint) {
      // Round 10 (#7, 33.3): the words, once the detector has heard PAUSE_MS of silence after them.
      // Never with only the owner on: unverified words do not leave the server.
      if (text !== '' && !onlyOwner && !testing && (result.quietMs ?? 0) >= PAUSE_MS && paused !== text) {
        paused = text
        send({ type: 'pause', text })
      }
      then()
      return
    }
    last = ''
    paused = ''
    if (text === '') {
      forgetWords()
      closeEmpty()
      then()
    } else {
      signalled = false
      sendFinal(text, whyNow(text, progress, progress.cause ?? 'rule2'), then)
    }
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
      paused = ''
      const next = (): void => {
        decoder.reset()
        schedule(step)
      }
      // Judged before the reset: the frames of the utterance in progress are still the decoder's.
      if (text !== '') {
        signalled = false
        sendFinal(text, whyNow(text, progress, 'flush'), next)
      } else {
        forgetWords()
        closeEmpty()
        next()
      }
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
      if (startedAt === null) startedAt = now()
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
    endpointMode(mode) {
      if (!closed) decoder.endpointMode?.(mode)
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
          if (closed) return
          send({ type: 'enrolled', ok, seconds })
          // Round 10 (31.2): a new profile is a new version.
          if (ok) announce()
        },
        () => {
          if (!closed) send({ type: 'enrolled', ok: false, seconds })
        },
      )
    },
    onlyOwner(on) {
      onlyOwner = on
      if (on) announce()
    },
    enrolScript(phrases) {
      if (closed) return
      const learning = decoder.enrolScript?.(phrases, (count, problem) => {
        if (!closed) send(problem === undefined ? { type: 'enrolPhrase', count } : { type: 'enrolPhrase', count, problem })
      })
      if (!learning) {
        send({ type: 'enrolled', ok: false, seconds: 0, phrases: 0 })
        return
      }
      learning.then(
        (result) => {
          if (closed) return
          send({ type: 'enrolled', ok: result.ok, seconds: result.seconds, phrases: result.phrases, ...(result.reason === undefined ? {} : { reason: result.reason }), ...(result.heldOut === undefined ? {} : { heldOut: result.heldOut }) })
          if (result.ok) {
            announce()
            tellStatus()
          }
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
    speakerStatus() {
      if (closed) return
      tellStatus()
    },
    speakerTest() {
      if (closed) return
      testing = true
    },
    trace(on) {
      tracing = on
    },
    profileDelete() {
      if (closed) return
      let deleted: boolean | Promise<boolean>
      try {
        deleted = decoder.deleteProfile?.() ?? false
      } catch {
        deleted = false
      }
      const tell = (ok: boolean): void => {
        if (closed) return
        send({ type: 'profileDeleted', ok })
        // The profile version is now empty: every decision made against the old one is stale.
        if (ok) announce()
        tellStatus()
      }
      if (deleted instanceof Promise) deleted.then(tell, () => tell(false))
      else tell(deleted)
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
