/** The wire between the browser and the local recogniser on the dev server (ARCHITECTURE 20.1). */

export const ASR_PATH = '/api/asr'
/** Audio frames are mono 32-bit float little-endian samples at this rate. */
export const ASR_SAMPLE_RATE = 16000
/** Samples per frame the browser sends: 100 ms. */
export const ASR_FRAME_SAMPLES = 1600
/** Frames above one second of audio are ignored. */
export const ASR_MAX_FRAME_BYTES = ASR_SAMPLE_RATE * 4

/**
 * How long a final is held for joining. Shorter than Chrome's: this engine already waits 1 s of
 * silence before it sends a final, so most of a thinking pause has passed by then.
 */
export const LOCAL_HOLD_MS = 700
/**
 * Round 10 (#7, lane LATE review 2): how long a held final waits after the speech detector heard speech start (the
 * activity with onset), once per final. The first words of that speech reach the client up to about a second after
 * it starts (the recogniser's 640 ms chunk and its token delay, ARCHITECTURE 33.2), so a pause inside a command joins.
 */
export const ONSET_HOLD_MS = 1200
/**
 * How long a partial that is a quick reply must stay unchanged before it is released. Longer than
 * the gap between the model's partials (about 620 ms), so "ei, mitte kolm" is never cut at "ei".
 */
export const INSTANT_SETTLE_MS = 650

/**
 * Round 10 (#7, ARCHITECTURE 33.2): how long the recogniser waits after the last word before it ends
 * the utterance. A command ends at 0.6 s; dictation (a box armed, or the entry flow) keeps 1.0 s, so a
 * thinking pause in a sentence does not cut it. The client says which; a client that never says gets
 * dictation (the 1.0 s of before round 10: the dev page, `npm run smoke`, an older client). The
 * extension always says.
 */
export type EndpointMode = 'command' | 'dictation'
export const ENDPOINT_TRAILING_MS: Readonly<Record<EndpointMode, number>> = { command: 600, dictation: 1000 }

/**
 * Round 10 (#7, lane LATE): what ended an utterance. rule1, rule2, rule3: the recogniser's own endpoint rules
 * (rule 1: nothing heard for 2.4 s; rule 2: trailing silence after the last word; rule 3: 30 s long); detector: the
 * speech detector heard the mode's silence and the recogniser's rule 2 then held on the hiss it was handed at once
 * (ARCHITECTURE 33.2); flush: the client asked.
 */
export type EndCause = 'rule1' | 'rule2' | 'rule3' | 'detector' | 'flush'
/**
 * Round 10 (#7, lane LATE): when and why a final was made, in numbers only (never words or audio). Audio times are
 * ms of the session's audio as the client sent it (dropped audio not counted); wall times are ms since the session's
 * first frame arrived. null: not known (a flush knows no recogniser times).
 */
export interface FinalWhy {
  cause: EndCause
  /** The session's audio at the frame that ended the utterance (a flush: all audio before it). */
  audioMs: number
  /** Wall time when the final was sent. */
  wallMs: number
  /** Where the speech detector last heard speech end, in the session's audio; null without one or before an end. */
  speechEndMs: number | null
  /** Where the recogniser put its last token (its own timestamp), in the session's audio. */
  lastTokenMs: number | null
  /** The session's audio when the final's last word first showed in a partial. */
  lastWordMs: number | null
  /** The session's audio when the words last changed. */
  lastChangeMs: number | null
  /** Audio the recogniser was given that the client did not send (the detector's pre-roll replayed), up to the end. */
  extraMs: number
  /** Audio dropped by the backlog while this utterance was in progress. */
  droppedMs: number
  /** The hiss handed to the recogniser ahead of time to end this utterance (cause detector). */
  paddedMs?: number
}

/** The lines the page shows when the local recogniser cannot run (src/speech/pick.ts). */
export const FELL_BACK = "The speech model on this computer is not running, so Chrome's recognition is listening instead."
export const NOTHING_LEFT = 'The speech model on this computer is not running and this browser has no speech recognition. Type instead.'

export type AsrUnavailableReason = 'model_missing' | 'addon_missing' | 'load_failed'

export type AsrServerMessage =
  | { type: 'ready' }
  | { type: 'unavailable'; reason: AsrUnavailableReason }
  | { type: 'partial'; text: string }
  /**
   * Round 10 (#7, 33.3): the speech detector has heard PAUSE_MS of silence after these words, before
   * the final. Never sent while only the owner is obeyed. The client may act on a partial that a
   * local rule knows; the final for the same words is then not run again.
   */
  | { type: 'pause'; text: string }
  /**
   * Round 10 (#7, lane LATE): why, only to a client that asked with trace. Round 10 (#2, 35): segment
   * is set with only the owner obeyed (with the decision), and on a final the keyword spotter heard
   * the wake word in (the segment of its `wake`).
   */
  | { type: 'final'; text: string; speaker?: Speaker; segment?: number; decision?: SpeakerDecision; why?: FinalWhy }
  /**
   * Round 10 (#2, ARCHITECTURE 35): the keyword spotter heard the wake word in the audio. No words:
   * segment is the id the final (or rejection) of this utterance will carry; endMs is the session's
   * audio (ms the client sent on this socket) when the spotter confirmed the word, about 1 s after it.
   * Never a speaker decision: with only the owner obeyed it counts only once its segment's final is
   * verified.
   */
  | { type: 'wake'; segment: number; endMs: number }
  /** Round 10 (#2, 35): whether the keyword spotter runs for this socket (the answer to the client's `spotter`). */
  | { type: 'spotter'; on: boolean }
  /** Round 10 (31.2): only the owner is obeyed and this utterance was not verified as his: no words, only why. */
  | { type: 'rejected'; decision: SpeakerDecision }
  /**
   * Round 10 (31.2): only the owner is obeyed: speech is being decoded, words withheld until verified (replaces partial).
   * Round 10 (#7, lane LATE review 2): onset: the speech detector heard speech start (in both modes, never words); a held
   * final waits for what follows.
   */
  | { type: 'activity'; onset?: true }
  /** Round 10 (31.2): the session and profile version every decision on this socket must carry (sent while onlyOwner is on). */
  | { type: 'speakerSession'; sessionId: string; profileVersion: string }
  /**
   * Round 4: the voice profile was learnt (or not). Round 7: phrases is how many read phrases made it (scripted enrolment).
   * Round 10 (31.7): reason when nothing was replaced; heldOut, the candidate's scores on the phrases it was not made from.
   */
  | { type: 'enrolled'; ok: boolean; seconds: number; phrases?: number; reason?: EnrolFailure; heldOut?: HeldOutResult }
  /** Round 7: scripted enrolment heard one more phrase; count is how many so far. Round 10 (31.7): problem: the phrase was not counted, read it again. */
  | { type: 'enrolPhrase'; count: number; problem?: PhraseProblem }
  /** Round 10 (31.7): whether only-owner can protect right now (asked with speakerStatus at every connection). */
  | { type: 'speakerStatus'; readiness: SpeakerReadiness }
  /** Round 10 (31.7): "Proovi minu häält": the answer for the utterance after speakerTest. Nothing of it was run. */
  | { type: 'speakerTested'; result: SpeakerTestResult; score?: number; seconds?: number }
  /** Round 10 (31.7): the profile was deleted (or could not be). */
  | { type: 'profileDeleted'; ok: boolean }
  /** The server is this many ms behind the audio it has received (it drops audio to catch up). 0 when caught up. */
  | { type: 'lag'; ms: number }

// ---------- onboarding and readiness (round 10, lane VOICE, ARCHITECTURE 31.7) ----------

/** Why a read phrase is asked again. */
export type PhraseProblem = 'too_short' | 'too_quiet' | 'clipped' | 'model_error'
export const PHRASE_PROBLEMS: readonly PhraseProblem[] = ['too_short', 'too_quiet', 'clipped', 'model_error']
/** Why an enrolment replaced nothing (the old profile stays). */
export type EnrolFailure = 'too_few_phrases' | 'too_little_speech' | 'held_out_failed' | 'write_failed' | 'model_unavailable'
export const ENROL_FAILURES: readonly EnrolFailure[] = ['too_few_phrases', 'too_little_speech', 'held_out_failed', 'write_failed', 'model_unavailable']
export interface HeldOutResult {
  count: number
  scores: number[]
  passed: boolean
  threshold: number
}
/** Whether only-owner can protect: only `ready` may be shown as protected. */
export type ReadinessState = 'ready' | 'no_profile' | 'needs_retraining' | 'model_unavailable' | 'model_mismatch'
export const READINESS_STATES: readonly ReadinessState[] = ['ready', 'no_profile', 'needs_retraining', 'model_unavailable', 'model_mismatch']
export interface SpeakerReadiness {
  state: ReadinessState
  protected: boolean
  extractor: boolean
  profileMatchesModel: boolean
  verifiable: boolean
  phrases?: number
  heldOut?: { count: number; passed: boolean }
  /** The line in force; `stored` is the line the profile was made with, when today's factory line differs (31.7). */
  threshold?: { value: number; source: 'factory' | 'per_profile'; stored?: number }
}
export type SpeakerTestResult = 'recognised' | 'not_recognised' | 'too_short' | 'noisy' | 'unavailable'
export const SPEAKER_TEST_RESULTS: readonly SpeakerTestResult[] = ['recognised', 'not_recognised', 'too_short', 'noisy', 'unavailable']

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | undefined => list.find((x) => x === value)

/** A readiness from the wire; `protected` is true only when the state is `ready` and the server said so. */
export function parseReadiness(value: unknown): SpeakerReadiness | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  const state = oneOf(READINESS_STATES, r.state)
  if (state === undefined) return null
  return { state, protected: state === 'ready' && r.protected === true, extractor: r.extractor === true, profileMatchesModel: r.profileMatchesModel === true, verifiable: r.verifiable === true }
}

function parseHeldOut(value: unknown): HeldOutResult | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const r = value as Record<string, unknown>
  if (typeof r.count !== 'number' || !Array.isArray(r.scores) || typeof r.passed !== 'boolean' || typeof r.threshold !== 'number') return undefined
  return { count: r.count, scores: r.scores.filter((x): x is number => typeof x === 'number'), passed: r.passed, threshold: r.threshold }
}
// ---------- end of onboarding ----------

/** Who spoke an utterance, when the server has a voice profile: the owner, someone else, or it cannot tell. */
export type Speaker = 'owner' | 'other' | 'unknown'

// ---------- speaker authorization (round 10, issue #3 B, ARCHITECTURE 31) ----------

/** Why a segment was or was not verified as the owner's. Only verified_owner authorizes. */
export type SpeakerReason =
  | 'verified_owner'
  | 'rejected_other'
  | 'insufficient_audio'
  | 'profile_missing'
  | 'model_unavailable'
  | 'model_mismatch'
  | 'verification_error'
  | 'mixed_speakers'

export const SPEAKER_REASONS: readonly SpeakerReason[] = [
  'verified_owner',
  'rejected_other',
  'insufficient_audio',
  'profile_missing',
  'model_unavailable',
  'model_mismatch',
  'verification_error',
  'mixed_speakers',
]

/** The server's decision on one audio segment (one final) of one session, made with one profile version. */
export interface SpeakerDecision {
  /** Counts the session's finals from 1: monotonic and unique per session. */
  segmentId: number
  /** Random per server session; a reconnect is a new session. */
  sessionId: string
  /** The profile the segment was compared with; empty without one. */
  profileVersion: string
  verdict: Speaker
  reason: SpeakerReason
  /** Cosine similarity to the owner's embedding, when one was computed. */
  score?: number
  /** judgeMs: how long the verification took; speechMs: the speech it was made from. */
  timings: { judgeMs: number; speechMs?: number }
}

/** The session and profile version announced for one socket (speakerSession). */
export interface SpeakerSessionInfo {
  sessionId: string
  profileVersion: string
}

/** The verdict a reason stands for: owner for verified_owner only. */
export function verdictFor(reason: SpeakerReason): Speaker {
  if (reason === 'verified_owner') return 'owner'
  return reason === 'rejected_other' || reason === 'mixed_speakers' ? 'other' : 'unknown'
}

const isReason = (value: unknown): value is SpeakerReason => typeof value === 'string' && (SPEAKER_REASONS as readonly string[]).includes(value)
const isSpeaker = (value: unknown): value is Speaker => value === 'owner' || value === 'other' || value === 'unknown'

/** Reads a decision off the wire; null unless every field has its type. */
export function parseDecision(value: unknown): SpeakerDecision | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  if (typeof r.segmentId !== 'number' || !Number.isInteger(r.segmentId) || r.segmentId < 1) return null
  if (typeof r.sessionId !== 'string' || typeof r.profileVersion !== 'string') return null
  if (!isSpeaker(r.verdict) || !isReason(r.reason)) return null
  const t = r.timings
  if (typeof t !== 'object' || t === null) return null
  const timings = t as Record<string, unknown>
  if (typeof timings.judgeMs !== 'number') return null
  const decision: SpeakerDecision = {
    segmentId: r.segmentId,
    sessionId: r.sessionId,
    profileVersion: r.profileVersion,
    verdict: r.verdict,
    reason: r.reason,
    timings: typeof timings.speechMs === 'number' ? { judgeMs: timings.judgeMs, speechMs: timings.speechMs } : { judgeMs: timings.judgeMs },
  }
  if (typeof r.score === 'number' && Number.isFinite(r.score)) decision.score = r.score
  return decision
}

/**
 * The barrier's one rule (31.1): true only for a decision that verified the owner, for the session
 * and profile version announced on this socket, on a segment after the last one authorized.
 * Missing, unknown, error, stale or another session's decision: false.
 */
export function authorizes(decision: SpeakerDecision | undefined, expected: SpeakerSessionInfo | null, lastSegment: number): boolean {
  if (decision === undefined || expected === null) return false
  if (decision.verdict !== 'owner' || decision.reason !== 'verified_owner') return false
  if (expected.sessionId === '' || expected.profileVersion === '') return false
  if (decision.sessionId !== expected.sessionId || decision.profileVersion !== expected.profileVersion) return false
  return decision.segmentId > lastSegment
}

/** The engine's own check (31.4): a decision that says the owner was verified. */
export function verifiedOwner(decision: SpeakerDecision | undefined): boolean {
  return decision !== undefined && decision.verdict === 'owner' && decision.reason === 'verified_owner'
}
// ---------- end of speaker authorization ----------

/** Text frames the browser sends. flush: end the utterance now and send its final (push-to-talk released). */
export type AsrClientMessage =
  | { type: 'flush' }
  /** Round 10 (#7, 33.2): the trailing silence that ends an utterance from now on (ENDPOINT_TRAILING_MS). */
  | { type: 'endpoint'; mode: EndpointMode }
  /** Round 4: learn the owner's voice from the next `seconds` of speech (the server stores an embedding, never audio). */
  | { type: 'enrol'; seconds: number }
  /** Round 4: only the owner's utterances are delivered; others are dropped (finals still carry speaker). */
  | { type: 'onlyOwner'; on: boolean }
  /** Round 7: scripted enrolment: each utterance from now on is one read phrase, `phrases` of them. */
  | { type: 'enrolScript'; phrases: number }
  /** Round 7: end scripted enrolment now with the phrases heard so far. */
  | { type: 'enrolFinish' }
  /** Round 10 (31.7): the readiness of the voice check, answered with speakerStatus. */
  | { type: 'speakerStatus' }
  /** Round 10 (31.7): the next utterance is a voice test: verified, answered with speakerTested, never delivered. */
  | { type: 'speakerTest' }
  /** Round 10 (31.7): delete the voice profile. */
  | { type: 'profileDelete' }
  /** Round 10 (#7, lane LATE): attach each final's why (timings and a cause, no words) from now on; for measuring. */
  | { type: 'trace'; on: boolean }
  /** Round 10 (#2, 35): run the keyword spotter for the wake word on this socket's audio (wake mode), or stop it. */
  | { type: 'spotter'; on: boolean }

const END_CAUSES: readonly EndCause[] = ['rule1', 'rule2', 'rule3', 'detector', 'flush']
const msOrNull = (value: unknown): number | null | undefined => (value === null ? null : typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/** Round 10 (#7, lane LATE): a final's why, or null when anything in it is not a number or a known cause. */
export function parseWhy(value: unknown): FinalWhy | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  const cause = END_CAUSES.find((c) => c === r.cause)
  const numbers = [r.audioMs, r.wallMs, r.extraMs, r.droppedMs]
  if (cause === undefined || !numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const speechEndMs = msOrNull(r.speechEndMs)
  const lastTokenMs = msOrNull(r.lastTokenMs)
  const lastWordMs = msOrNull(r.lastWordMs)
  const lastChangeMs = msOrNull(r.lastChangeMs)
  if (speechEndMs === undefined || lastTokenMs === undefined || lastWordMs === undefined || lastChangeMs === undefined) return null
  if (r.paddedMs !== undefined && !(typeof r.paddedMs === 'number' && Number.isFinite(r.paddedMs))) return null
  const why: FinalWhy = { cause, audioMs: r.audioMs as number, wallMs: r.wallMs as number, speechEndMs, lastTokenMs, lastWordMs, lastChangeMs, extraMs: r.extraMs as number, droppedMs: r.droppedMs as number }
  return typeof r.paddedMs === 'number' ? { ...why, paddedMs: r.paddedMs } : why
}

/** Reads one text frame from the server; null for anything that is not a known message. */
export function parseAsrMessage(raw: string): AsrServerMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  switch (record.type) {
    case 'ready':
      return { type: 'ready' }
    case 'lag':
      return typeof record.ms === 'number' && record.ms >= 0 ? { type: 'lag', ms: record.ms } : null
    case 'unavailable': {
      const reason = record.reason
      if (reason === 'model_missing' || reason === 'addon_missing' || reason === 'load_failed') return { type: 'unavailable', reason }
      return { type: 'unavailable', reason: 'load_failed' }
    }
    case 'partial':
      return typeof record.text === 'string' ? { type: 'partial', text: record.text } : null
    case 'pause':
      return typeof record.text === 'string' ? { type: 'pause', text: record.text } : null
    case 'final': {
      if (typeof record.text !== 'string') return null
      const speaker = record.speaker === 'owner' || record.speaker === 'other' || record.speaker === 'unknown' ? record.speaker : undefined
      const final: AsrServerMessage = speaker === undefined ? { type: 'final', text: record.text } : { type: 'final', text: record.text, speaker }
      // Round 10 (31.1): the segment and its decision, when the server sent them whole.
      const decision = record.decision === undefined ? null : parseDecision(record.decision)
      const why = record.why === undefined ? null : parseWhy(record.why)
      const withWhy: AsrServerMessage = why === null ? final : { ...final, why }
      if (decision !== null && typeof record.segment === 'number') return { ...withWhy, segment: record.segment, decision }
      // Round 10 (#2, 35): a final the spotter heard the wake word in carries its segment without a decision.
      if (record.decision === undefined && typeof record.segment === 'number' && Number.isInteger(record.segment) && record.segment > 0) return { ...withWhy, segment: record.segment }
      return withWhy
    }
    case 'rejected': {
      const decision = parseDecision(record.decision)
      return decision === null ? null : { type: 'rejected', decision }
    }
    case 'activity':
      return record.onset === true ? { type: 'activity', onset: true } : { type: 'activity' }
    case 'wake': {
      const { segment, endMs } = record
      if (typeof segment !== 'number' || !Number.isInteger(segment) || segment < 1) return null
      if (typeof endMs !== 'number' || !(endMs >= 0)) return null
      return { type: 'wake', segment, endMs }
    }
    case 'spotter':
      return typeof record.on === 'boolean' ? { type: 'spotter', on: record.on } : null
    case 'speakerSession':
      return typeof record.sessionId === 'string' && typeof record.profileVersion === 'string' ? { type: 'speakerSession', sessionId: record.sessionId, profileVersion: record.profileVersion } : null
    case 'enrolled': {
      if (typeof record.ok !== 'boolean') return null
      const seconds = typeof record.seconds === 'number' ? record.seconds : 0
      const enrolled: AsrServerMessage = typeof record.phrases === 'number' ? { type: 'enrolled', ok: record.ok, seconds, phrases: record.phrases } : { type: 'enrolled', ok: record.ok, seconds }
      const reason = oneOf(ENROL_FAILURES, record.reason)
      const heldOut = parseHeldOut(record.heldOut)
      return { ...enrolled, ...(reason === undefined ? {} : { reason }), ...(heldOut === undefined ? {} : { heldOut }) }
    }
    case 'enrolPhrase': {
      if (typeof record.count !== 'number' || record.count < 0) return null
      const problem = oneOf(PHRASE_PROBLEMS, record.problem)
      return problem === undefined ? { type: 'enrolPhrase', count: record.count } : { type: 'enrolPhrase', count: record.count, problem }
    }
    case 'speakerStatus': {
      const readiness = parseReadiness(record.readiness)
      return readiness === null ? null : { type: 'speakerStatus', readiness }
    }
    case 'speakerTested': {
      const result = oneOf(SPEAKER_TEST_RESULTS, record.result)
      if (result === undefined) return null
      return { type: 'speakerTested', result, ...(typeof record.score === 'number' ? { score: record.score } : {}), ...(typeof record.seconds === 'number' ? { seconds: record.seconds } : {}) }
    }
    case 'profileDeleted':
      return typeof record.ok === 'boolean' ? { type: 'profileDeleted', ok: record.ok } : null
    default:
      return null
  }
}
