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
 * How long a partial that is a quick reply must stay unchanged before it is released. Longer than
 * the gap between the model's partials (about 620 ms), so "ei, mitte kolm" is never cut at "ei".
 */
export const INSTANT_SETTLE_MS = 650

/** The lines the page shows when the local recogniser cannot run (src/speech/pick.ts). */
export const FELL_BACK = "The speech model on this computer is not running, so Chrome's recognition is listening instead."
export const NOTHING_LEFT = 'The speech model on this computer is not running and this browser has no speech recognition. Type instead.'

export type AsrUnavailableReason = 'model_missing' | 'addon_missing' | 'load_failed'

export type AsrServerMessage =
  | { type: 'ready' }
  | { type: 'unavailable'; reason: AsrUnavailableReason }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string; speaker?: Speaker; segment?: number; decision?: SpeakerDecision }
  /** Round 10 (31.2): only the owner is obeyed and this utterance was not verified as his: no words, only why. */
  | { type: 'rejected'; decision: SpeakerDecision }
  /** Round 10 (31.2): only the owner is obeyed: speech is being decoded, words withheld until verified (replaces partial). */
  | { type: 'activity' }
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
  threshold?: { value: number; source: 'factory' | 'per_profile' }
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
    case 'final': {
      if (typeof record.text !== 'string') return null
      const speaker = record.speaker === 'owner' || record.speaker === 'other' || record.speaker === 'unknown' ? record.speaker : undefined
      const final: AsrServerMessage = speaker === undefined ? { type: 'final', text: record.text } : { type: 'final', text: record.text, speaker }
      // Round 10 (31.1): the segment and its decision, when the server sent them whole.
      const decision = record.decision === undefined ? null : parseDecision(record.decision)
      if (decision !== null && typeof record.segment === 'number') return { ...final, segment: record.segment, decision }
      return final
    }
    case 'rejected': {
      const decision = parseDecision(record.decision)
      return decision === null ? null : { type: 'rejected', decision }
    }
    case 'activity':
      return { type: 'activity' }
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
