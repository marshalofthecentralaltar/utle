/**
 * The owner's voice (round 4, VOICE lane; round 7, SPEECH lane; ARCHITECTURE 24.2). The server learns
 * one voice, from read phrases (scripted enrolment, the mean of one embedding per phrase) or from
 * eight seconds of free speech, and at every final says whether the utterance was the owner's or
 * someone else's (or `unknown` when it is too short or the model fails). The client with "Kuula
 * ainult mind" on drops everything that is not `owner` (strict mode, round 7).
 *
 * Model (round 7): NVIDIA NeMo TitaNet small, in sherpa-onnx's speaker-recognition release:
 *   https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_small.onnx
 *   40.3 MB (40 257 283 bytes), 16 kHz, 192-dimensional embeddings; under the NeMo Toolkit's licence
 *   (Apache-2.0), as its NGC card says (THIRD-PARTY.md).
 * Why this one and not round 4's WeSpeaker CAM++: measured on scripts/fixtures/speaker-set (a
 * stand-in owner, TartuNLP's synthetic voice "mari"; six other synthetic Estonian voices; the
 * stand-in pitch-shifted) CAM++ did not separate voices at
 * all: other voices scored up to 0.79 and the owner down to 0.40, so the best single threshold
 * dropped every owner clip. Its embedding also moves with the clip's length (the first 2 s of one
 * sentence against its first 3 s: 0.29), which makes a short utterance a coin toss. TitaNet small,
 * ERes2Net and ResNet34 were steady (0.89 to 0.97 on the same test); of those TitaNet separated the
 * set best and was the fastest (about 20 ms per clip on this laptop, one thread). Measured again
 * after the round 7 fix that makes judge embed the same frames as enrolment (speechOnly, below):
 * CAM++ still let other voices up to 0.85 and dropped 7 of 9 stand-in owner clips at its best
 * threshold; TitaNet: owner 0.62 to 0.76 for utterances of 0.6 s of speech or more, others at most 0.50. A speaker embedding describes the
 * voice, not the words: none of these was trained on Estonian, none is for one language.
 *
 * The profile is `models/speaker/owner.json`: a unit-length embedding, the owner's speech loudness
 * (RMS) and how many phrases made it. Never audio. A profile made with another model (round 4's
 * CAM++) is judged by loudness only until he teaches his voice again. `npm run model` downloads the
 * model (optional second step); without it the gate works on loudness alone (energy gate, below).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { EnrolFailure, HeldOutResult, PhraseProblem, ReadinessState, Speaker, SpeakerReadiness, SpeakerReason, SpeakerTestResult } from '../src/speech/asrProtocol.ts'

export type { EnrolFailure, PhraseProblem, ReadinessState, SpeakerTestResult }
/** Round 10 (31.7): the candidate scored on phrases it was not made from. */
export type HeldOut = HeldOutResult
/** Round 10 (31.7): whether only-owner can protect right now. */
export type Readiness = SpeakerReadiness
import { ASR_SAMPLE_RATE } from '../src/speech/asrProtocol.ts'
import { SILENCE_RMS, rms } from './asrSession.ts'

export const SPEAKER_DIR = join('models', 'speaker')
export const SPEAKER_MODEL_FILE = 'nemo_en_titanet_small.onnx'
export const SPEAKER_MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/${SPEAKER_MODEL_FILE}`
export const SPEAKER_MODEL_BYTES = 40_257_283
export const PROFILE_FILE = 'owner.json'

/**
 * Cosine similarity at or above this is the owner; below it, someone else. One number (round 7): the
 * band between two thresholds where `unknown` was obeyed is what let a friend scoring 0.4 through
 * (the owner's report, 2026-10-20).
 *
 * 0.54 is scripts/speaker-calibrate.ts's pick on scripts/fixtures/speaker-set (fewest errors, ties
 * toward dropping others; scores.json there): the closest other voice (vesta, a woman's voice like
 * the stand-in owner's) scored 0.499 at most, the stand-in owner's utterances of 0.6 s of speech or
 * more 0.622 to 0.760, so 0.54 drops every other clip and keeps those. What it does not keep: the
 * one-word utterances ("jah", "saada", "üks", 0.4 to 0.5 s of speech) scored 0.14 to 0.27; half a
 * second of voice is too little for this model, and those are `unknown` or `other` on their score
 * (round 10: denied with only the owner on; continuity is gone, ARCHITECTURE 31). The stand-in owner is a synthetic voice (TartuNLP's "mari"; there is no recording of
 * the owner on disk), and a real voice through a real microphone scores itself lower than a
 * synthetic one does. Re-pick it on his own recordings (UTLE_CAPTURE, HANDOFF 1g) and change this.
 */
export const OWNER_THRESHOLD = 0.54
/**
 * An utterance with less speech than this (frames at or above SILENCE_RMS) is `unknown`: too little
 * voice for an embedding to mean anything. A "jah" or a "saada" is 0.4 to 0.5 s of speech.
 */
export const MIN_JUDGE_SECONDS = 0.5
/** The energy gate: an utterance whose speech RMS is below this share of the owner's enrolled RMS is `other`. */
export const ENERGY_OTHER_RATIO = 0.4
/** Free-speech enrolment needs at least this much speech: two seconds to learn from and HELD_OUT_PHRASES seconds held out (round 10). */
export const MIN_ENROL_SECONDS = 4
/** Round 10 (31.7): the candidate is verified on this many phrases (or seconds of free speech) it was not made from. */
export const HELD_OUT_PHRASES = 2
/** Round 10 (31.7): a candidate is made from at least this many phrases. */
export const MIN_TRAIN_PHRASES = 4
/** Round 10 (31.7): a phrase whose speech RMS is below this is too quiet (the microphone is far or turned down). */
export const MIN_PHRASE_RMS = 0.02
/** Round 10 (31.7): a sample at or above this magnitude is clipped. */
export const CLIP_LEVEL = 0.98
/** Round 10 (31.7): a phrase with more than this share of clipped samples is asked again. */
export const MAX_CLIPPED_SHARE = 0.005
/**
 * Round 10 (31.7): the factory threshold every profile gets unless negatives support its own. It is
 * OWNER_THRESHOLD, picked on synthetic voices; it is conservative only in the sense that it is the
 * line measured to drop every other synthetic voice.
 */
export const FACTORY_THRESHOLD = OWNER_THRESHOLD
export const FACTORY_PROVENANCE = 'factory: OWNER_THRESHOLD, picked on scripts/fixtures/speaker-set (synthetic TartuNLP voices, 2026-10); no other-speaker samples at enrolment'
/** Round 10 (31.7): a per-profile threshold needs at least this many consenting other-speaker scores. */
export const MIN_NEGATIVES = 30
/** Round 10 (31.7): the per-profile line sits this far above the highest negative... */
export const NEGATIVE_MARGIN = 0.05
/** ...and never below this. */
export const PER_PROFILE_FLOOR = 0.4
/** Scripted enrolment (round 7): a phrase with less speech than this is not counted (a cough, a click). */
export const MIN_PHRASE_SECONDS = 0.8
/** Scripted enrolment: a profile from fewer phrases than this is kept, and the bar says it is thin. */
export const ENOUGH_PHRASES = 6

/** What the server needs of sherpa's SpeakerEmbeddingExtractor. embed: one utterance's samples at 16 kHz to an embedding. */
export interface EmbeddingExtractor {
  embed(samples: Float32Array): Float32Array
}

/**
 * Round 10 (31.7): the stored profile, format 2. Never audio. The embedding is the mean of the
 * candidate's phrases (the held-out ones are not in it, so the held-out scores say how the stored
 * profile does on speech it has not seen). A file of round 7 (version 1, no format) is read as
 * "needs retraining" and protects nothing.
 */
export interface SpeakerProfile {
  format: 2
  /** The embedding model: its file name and the SHA-256 of the file; both empty for a loudness-only profile. */
  model: { id: string; hash: string }
  /** Unit length. Empty when enrolled without the model. */
  embedding: number[]
  /** Mean RMS of the owner's speech frames at enrolment. */
  rms: number
  /** Seconds of speech the embedding was made from. */
  seconds: number
  /** How many read phrases the embedding is the mean of; 0 for the free-speech enrolment. */
  phrases: number
  quality: ProfileQuality
  threshold: ThresholdPolicy
  heldOut: HeldOut
  /** ISO times: the first enrolment of this file, and the last one that replaced it. */
  createdAt: string
  updatedAt: string
}

/** Round 10 (31.7): what the phrases of a profile were like (numbers only). */
export interface ProfileQuality {
  phrases: number
  minSeconds: number
  meanSeconds: number
  meanRms: number
  /** The largest share of clipped samples in any phrase. */
  maxClipped: number
}

/** Round 10 (31.7): the line a profile is judged by, and where it came from. */
export interface ThresholdPolicy {
  value: number
  source: 'factory' | 'per_profile'
  provenance: string
  /** How many consenting other-speaker scores supported it (0 for the factory line). */
  negatives: number
}

/** Round 10 (31.7): one phrase measured; phrase is set only when it is accepted. */
export interface PhraseResult {
  problem: PhraseProblem | null
  phrase: EnrolPhrase | null
  quality: { seconds: number; rms: number; clipped: number }
}


export type EnrolOutcome = { ok: true; phrases: number; seconds: number; heldOut: HeldOut } | { ok: false; reason: EnrolFailure; heldOut?: HeldOut }

/** Round 10 (31.7): "Proovi minu häält". */
export interface SpeakerTest {
  result: SpeakerTestResult
  score?: number
  seconds?: number
}

/** Round 7: one read phrase of scripted enrolment, embedded at once (the audio is not kept). */
export interface EnrolPhrase {
  /** Unit length; empty without the model. */
  embedding: number[]
  rms: number
  seconds: number
  /** Round 10 (31.7): the share of clipped samples. */
  clipped?: number
}

export interface Judgement {
  speaker: Speaker
  /** Cosine similarity to the owner's embedding, or 0 without one. */
  score: number
  /** Round 7: seconds of speech the verdict was made from (speechOnly); absent when not measured. */
  seconds?: number
  /**
   * Round 10 (31.2): the authorization reason, set with only the owner on (for the log line).
   * Round 7's 'continuity' is gone: a previous owner verdict never authorizes later audio.
   */
  reason?: SpeakerReason
}

/**
 * Round 10 (31.2): what verify says of one utterance with only the owner on. judgement: the
 * score's verdict when one was computed, else null. profileVersion: the profile it was compared with.
 */
export interface SpeakerVerification {
  judgement: Judgement | null
  reason: SpeakerReason
  profileVersion: string
}

/** Round 10 (31.1): the version of a stored profile: FNV-1a over its JSON. Empty without one. */
export function profileVersionOf(profile: SpeakerProfile | null): string {
  if (profile === null) return ''
  const json = JSON.stringify(profile)
  let hash = 0x811c9dc5
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `v1-${hash.toString(16).padStart(8, '0')}`
}

export interface SpeakerGate {
  /** A profile is stored: finals carry a speaker. */
  hasProfile(): boolean
  /** The embedding model is loaded: `owner` is possible. */
  hasModel(): boolean
  /** Learns the owner from these frames (speech only; the caller skips silence). Replaces any earlier profile. False when there is too little speech. */
  enrol(frames: Float32Array[]): boolean
  /**
   * Who spoke these frames (one whole utterance), or null when nothing can be said about the voice:
   * no profile, or (round 7) no model to compare with and loud enough to be him. Null finals are
   * obeyed even in strict mode, so a missing model never locks him out.
   */
  judge(frames: Float32Array[]): Judgement | null
  /** Round 7: one read phrase (speech frames), embedded now; null when too short or the model fails. */
  phrase(frames: Float32Array[]): EnrolPhrase | null
  /** Round 7: the profile from read phrases: the mean of their embeddings at unit length, and their count. False with too little speech. */
  enrolPhrases(phrases: EnrolPhrase[]): boolean
  /**
   * Round 10 (31.2): the fail-closed check with only the owner on. Only verified_owner authorizes;
   * no profile, no model, another model's profile, too little speech and a failing extractor each
   * have their own reason, and loudness never stands in for a voice.
   */
  verify(frames: Float32Array[]): SpeakerVerification
  /** Round 10 (31.1): the stored profile's version; empty without one. */
  profileVersion(): string
  /** Round 10 (31.7): one read phrase measured (Silero speech seconds, level, clipping) and, when clean, embedded. */
  assessPhrase(frames: Float32Array[]): PhraseResult
  /** Round 10 (31.7): candidate from all but the last HELD_OUT_PHRASES, verified on those, written atomically only when it passes. */
  enrolScripted(phrases: EnrolPhrase[]): EnrolOutcome
  /** Round 10 (31.7): the same from free speech: the last HELD_OUT_PHRASES seconds are held out. */
  enrolSpeech(frames: Float32Array[]): EnrolOutcome
  /** Round 10 (31.7): extractor loaded, profile of this model, verified on held-out speech. */
  readiness(): Readiness
  /** Round 10 (31.7): the voice test of one utterance; runs nothing. */
  test(frames: Float32Array[]): SpeakerTest
  /** Round 10 (31.7): removes the profile file; every verification is profile_missing after it. */
  deleteProfile(): boolean
}

export interface SpeakerGateOptions {
  /** Where the profile is read at start and written at enrolment. */
  profilePath: string
  /** For the profile's record of which model made it. */
  modelName?: string
  /** Round 10 (31.7): the SHA-256 of the model file; a profile with another hash is model_mismatch. */
  modelHash?: string
  /** Round 10 (31.7): consenting other-speaker embeddings for a per-profile threshold (none in the product today). */
  negatives?: number[][]
  /** Round 10 (31.7): writes the temporary file (tests force a failure half way). */
  writeFile?: (path: string, data: string) => void
  /** Round 10 (31.7): the clock for the profile's timestamps. */
  now?: () => string
  /**
   * Round 10 (31.7): the factory line in force (FACTORY_THRESHOLD; tests move it). A factory-sourced
   * profile is judged at this line, not at the value stored with it, so a recalibrated factory line
   * reaches every existing profile; a per-profile line keeps its stored value.
   */
  factoryThreshold?: number
}

const concat = (frames: Float32Array[]): Float32Array => {
  let n = 0
  for (const frame of frames) n += frame.length
  const all = new Float32Array(n)
  let at = 0
  for (const frame of frames) {
    all.set(frame, at)
    at += frame.length
  }
  return all
}

const seconds = (frames: Float32Array[]): number => frames.reduce((n, frame) => n + frame.length, 0) / ASR_SAMPLE_RATE

/**
 * The frames the embedding is made of: those at or above SILENCE_RMS. Round 7: enrolment, phrases
 * and judge all use this, so the owner's own recording judged against his profile scores 1. Before,
 * enrolment embedded speech only and judge the whole utterance with its silences; the same
 * recording then scored 0.34 against itself on round 4's CAM++ (0.388 in the HOST lane's run)
 * and 0.89 on TitaNet.
 */
export function speechOnly(frames: Float32Array[]): Float32Array[] {
  return frames.filter((frame) => rms(frame) >= SILENCE_RMS)
}

/** The samples the gate embeds for these frames (speechOnly, in order): the calibration embeds the same. */
export function embeddedSamples(frames: Float32Array[]): Float32Array {
  return concat(speechOnly(frames))
}

/** Mean RMS over the frames that are not silence, or 0 when all are. */
export function speechRms(frames: Float32Array[]): number {
  let sum = 0
  let count = 0
  for (const frame of frames) {
    const level = rms(frame)
    if (level < SILENCE_RMS) continue
    sum += level
    count += 1
  }
  return count === 0 ? 0 : sum / count
}

/** Unit length, as a plain array for JSON. */
export function normalised(vector: ArrayLike<number>): number[] {
  let sum = 0
  for (let i = 0; i < vector.length; i += 1) sum += (vector[i] ?? 0) ** 2
  const length = Math.sqrt(sum)
  if (length === 0) return Array.from(vector, () => 0)
  return Array.from(vector, (value) => value / length)
}

/** Cosine similarity of two vectors already of unit length; NaN when they cannot be compared (review: never a score that reads as a stranger). */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return Number.NaN
  let dot = 0
  for (let i = 0; i < a.length; i += 1) dot += (a[i] ?? 0) * (b[i] ?? 0)
  return dot
}

/** The verdict for a score: owner at or above OWNER_THRESHOLD, other below it. */
export function verdict(score: number): Speaker {
  return score >= OWNER_THRESHOLD ? 'owner' : 'other'
}

/** The mean of unit embeddings, at unit length (scripted enrolment's profile; the calibration's owner). */
export function meanEmbedding(embeddings: ArrayLike<number>[]): number[] {
  const first = embeddings[0]
  if (first === undefined) return []
  const sum = new Array<number>(first.length).fill(0)
  for (const embedding of embeddings) for (let i = 0; i < sum.length; i += 1) sum[i] = (sum[i] ?? 0) + (embedding[i] ?? 0)
  return normalised(sum)
}

/**
 * The threshold with the fewest errors over measured scores (an owner clip below it is dropped, an
 * other clip at or above it passes); between equal counts, the one that lets fewer others through;
 * between those, the middle of the range they share, so the margin on each side is the same.
 */
export function pickThreshold(owner: number[], other: number[]): { threshold: number; ownerDropped: number; otherPassed: number } {
  const all = [...new Set([...owner, ...other])].sort((a, b) => a - b)
  const candidates = [(all[0] ?? 0) - 0.01, ...all.slice(1).map((x, i) => ((all[i] ?? x) + x) / 2), (all[all.length - 1] ?? 0) + 0.01]
  const cost = (t: number): { ownerDropped: number; otherPassed: number } => ({ ownerDropped: owner.filter((s) => s < t).length, otherPassed: other.filter((s) => s >= t).length })
  let best: { threshold: number; ownerDropped: number; otherPassed: number } | null = null
  for (const t of candidates) {
    const c = cost(t)
    if (best === null || c.ownerDropped + c.otherPassed < best.ownerDropped + best.otherPassed || (c.ownerDropped + c.otherPassed === best.ownerDropped + best.otherPassed && c.otherPassed < best.otherPassed)) {
      best = { threshold: t, ...c }
    }
  }
  return best ?? { threshold: OWNER_THRESHOLD, ownerDropped: 0, otherPassed: 0 }
}

/** Round 10 (31.7): what a profile file holds: nothing, a format-2 profile, or a file of an earlier round. */
type StoredProfile = { kind: 'none' } | { kind: 'legacy' } | { kind: 'v2'; profile: SpeakerProfile }

const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const rec = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {})

function readStored(path: string): StoredProfile {
  if (!existsSync(path)) return { kind: 'none' }
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { kind: 'none' }
  }
  const record = rec(value)
  if (record.format !== 2) return record.version === 1 ? { kind: 'legacy' } : { kind: 'none' }
  if (!Array.isArray(record.embedding)) return { kind: 'none' }
  const model = rec(record.model)
  const quality = rec(record.quality)
  const threshold = rec(record.threshold)
  const heldOut = rec(record.heldOut)
  const value2 = num(threshold.value, FACTORY_THRESHOLD)
  return {
    kind: 'v2',
    profile: {
      format: 2,
      model: { id: str(model.id), hash: str(model.hash) },
      embedding: record.embedding.filter((x): x is number => typeof x === 'number'),
      rms: num(record.rms),
      seconds: num(record.seconds),
      phrases: num(record.phrases),
      quality: { phrases: num(quality.phrases), minSeconds: num(quality.minSeconds), meanSeconds: num(quality.meanSeconds), meanRms: num(quality.meanRms), maxClipped: num(quality.maxClipped) },
      threshold: { value: value2, source: threshold.source === 'per_profile' ? 'per_profile' : 'factory', provenance: str(threshold.provenance), negatives: num(threshold.negatives) },
      heldOut: { count: num(heldOut.count), scores: Array.isArray(heldOut.scores) ? heldOut.scores.filter((x): x is number => typeof x === 'number') : [], passed: heldOut.passed === true, threshold: num(heldOut.threshold, value2) },
      createdAt: str(record.createdAt),
      updatedAt: str(record.updatedAt),
    },
  }
}

/**
 * Round 10 (31.7): the profile goes to `<path>.part` first and is renamed over the old file, so a
 * failure at any point leaves the old file whole; a failed write removes its partial file. Throws.
 */
function writeProfile(path: string, profile: SpeakerProfile, write: (path: string, data: string) => void): void {
  mkdirSync(dirname(path), { recursive: true })
  const partial = `${path}.part`
  try {
    write(partial, JSON.stringify(profile))
    renameSync(partial, path)
  } catch (error) {
    try {
      if (existsSync(partial)) unlinkSync(partial)
    } catch {
      // The old file is whole either way.
    }
    throw error
  }
}

/** Round 10 (31.7): the share of samples at full scale (CLIP_LEVEL or more). */
export function clippedShare(frames: Float32Array[]): number {
  let clipped = 0
  let total = 0
  for (const frame of frames) {
    total += frame.length
    for (let i = 0; i < frame.length; i += 1) if (Math.abs(frame[i] ?? 0) >= CLIP_LEVEL) clipped += 1
  }
  return total === 0 ? 0 : clipped / total
}

/**
 * Round 10 (31.7): the line for a new profile. Owner phrases alone say nothing about how often a
 * stranger passes, so without at least MIN_NEGATIVES consenting other-speaker scores it is the
 * factory line. With them: the highest negative plus NEGATIVE_MARGIN, never below PER_PROFILE_FLOOR.
 */
export function thresholdPolicy(negativeScores: number[], factory = FACTORY_THRESHOLD): ThresholdPolicy {
  const scores = negativeScores.filter((x) => Number.isFinite(x))
  if (scores.length < MIN_NEGATIVES) return { value: factory, source: 'factory', provenance: FACTORY_PROVENANCE, negatives: 0 }
  const value = Math.round(Math.max(PER_PROFILE_FLOOR, Math.max(...scores) + NEGATIVE_MARGIN) * 1000) / 1000
  return { value, source: 'per_profile', provenance: `per_profile: highest of ${scores.length} consenting other-speaker scores + ${NEGATIVE_MARGIN}, floor ${PER_PROFILE_FLOOR}`, negatives: scores.length }
}

/** Round 10 (31.7): the voice test's answer for a verification reason (noisy wins over a stranger: the room, not the voice). */
export function speakerTestResult(reason: SpeakerReason, problem: PhraseProblem | null): SpeakerTestResult {
  if (reason === 'verified_owner') return 'recognised'
  if (reason === 'insufficient_audio') return 'too_short'
  if (reason === 'rejected_other' || reason === 'mixed_speakers') return problem === 'too_quiet' || problem === 'clipped' ? 'noisy' : 'not_recognised'
  return 'unavailable'
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000

/**
 * The gate over an extractor (null without the model). The profile at profilePath is loaded once
 * here. With the model, the verdict is the cosine similarity of the utterance's embedding to the
 * owner's, at the profile's own threshold (round 10). Without it, only the energy gate speaks for
 * judge (the mode off): an utterance whose speech RMS is below ENERGY_OTHER_RATIO of the owner's
 * enrolled RMS is `other`, everything else null. verify never uses loudness.
 */
export function createSpeakerGate(extractor: EmbeddingExtractor | null, options: SpeakerGateOptions): SpeakerGate {
  const stored = readStored(options.profilePath)
  let profile: SpeakerProfile | null = stored.kind === 'v2' ? stored.profile : null
  /** Round 10 (31.7): a file of an earlier round is on disk: needs retraining until replaced or deleted. */
  let legacy = stored.kind === 'legacy'
  const modelName = options.modelName ?? SPEAKER_MODEL_FILE
  const modelHash = options.modelHash ?? ''
  const write = options.writeFile ?? ((path: string, data: string) => writeFileSync(path, data))
  const clock = options.now ?? (() => new Date().toISOString())
  // A profile made with another model (or another file of the same name) cannot be compared.
  const comparable = (p: SpeakerProfile): boolean => extractor !== null && p.embedding.length > 0 && p.model.id === modelName && p.model.hash === modelHash
  const factory = options.factoryThreshold ?? FACTORY_THRESHOLD
  // Round 10 (31.7): the stored value of a factory line is the one it was made with; today's line judges.
  const thresholdOf = (p: SpeakerProfile): number => (p.threshold.source === 'factory' ? factory : p.threshold.value)
  const embed = (frames: Float32Array[]): number[] | null => {
    if (extractor === null) return null
    try {
      const vector = normalised(extractor.embed(concat(frames)))
      return vector.every((x) => Number.isFinite(x)) ? vector : null
    } catch {
      return null
    }
  }

  /** Verifies a candidate on held-out embeddings and, when it passes, writes it over the old profile. */
  const commit = (candidate: Omit<SpeakerProfile, 'threshold' | 'heldOut' | 'createdAt' | 'updatedAt'>, heldOutEmbeddings: number[][]): EnrolOutcome => {
    const negatives = (options.negatives ?? []).map((n) => cosine(normalised(n), candidate.embedding))
    const threshold = thresholdPolicy(negatives, factory)
    const scores = heldOutEmbeddings.map((e) => round3(cosine(e, candidate.embedding)))
    const heldOut: HeldOut = { count: scores.length, scores, passed: scores.length === HELD_OUT_PHRASES && scores.every((x) => Number.isFinite(x) && x >= threshold.value), threshold: threshold.value }
    if (!heldOut.passed) return { ok: false, reason: 'held_out_failed', heldOut }
    const at = clock()
    const next: SpeakerProfile = { ...candidate, threshold, heldOut, createdAt: profile?.createdAt || at, updatedAt: at }
    try {
      writeProfile(options.profilePath, next, write)
    } catch {
      return { ok: false, reason: 'write_failed', heldOut }
    }
    profile = next
    legacy = false
    return { ok: true, phrases: next.phrases, seconds: next.seconds, heldOut }
  }

  const assess = (frames: Float32Array[]): PhraseResult => {
    const speech = speechOnly(frames)
    const length = seconds(speech)
    const quality = { seconds: Math.round(length * 100) / 100, rms: round3(speechRms(speech)), clipped: round3(clippedShare(speech)) }
    const no = (problem: PhraseProblem): PhraseResult => ({ problem, phrase: null, quality })
    if (length < MIN_PHRASE_SECONDS) return no('too_short')
    if (clippedShare(speech) > MAX_CLIPPED_SHARE) return no('clipped')
    if (speechRms(speech) < MIN_PHRASE_RMS) return no('too_quiet')
    if (extractor === null) return { problem: null, phrase: { embedding: [], rms: speechRms(speech), seconds: length, clipped: quality.clipped }, quality }
    const embedding = embed(speech)
    if (embedding === null) return no('model_error')
    return { problem: null, phrase: { embedding, rms: speechRms(speech), seconds: length, clipped: quality.clipped }, quality }
  }

  const enrolScripted = (phrases: EnrolPhrase[]): EnrolOutcome => {
    if (extractor === null) return { ok: false, reason: 'model_unavailable' }
    if (phrases.length < MIN_TRAIN_PHRASES + HELD_OUT_PHRASES) return { ok: false, reason: 'too_few_phrases' }
    if (phrases.some((p) => p.embedding.length === 0)) return { ok: false, reason: 'model_unavailable' }
    const train = phrases.slice(0, phrases.length - HELD_OUT_PHRASES)
    const held = phrases.slice(phrases.length - HELD_OUT_PHRASES)
    const length = train.reduce((n, p) => n + p.seconds, 0)
    if (length < MIN_ENROL_SECONDS - HELD_OUT_PHRASES) return { ok: false, reason: 'too_little_speech' }
    const quality: ProfileQuality = {
      phrases: train.length,
      minSeconds: Math.round(Math.min(...train.map((p) => p.seconds)) * 100) / 100,
      meanSeconds: Math.round((length / train.length) * 100) / 100,
      meanRms: round3(train.reduce((n, p) => n + p.rms, 0) / train.length),
      maxClipped: round3(Math.max(...train.map((p) => p.clipped ?? 0))),
    }
    return commit(
      { format: 2, model: { id: modelName, hash: modelHash }, embedding: meanEmbedding(train.map((p) => p.embedding)), rms: quality.meanRms, seconds: Math.round(length * 10) / 10, phrases: train.length, quality },
      held.map((p) => p.embedding),
    )
  }

  const enrolSpeech = (frames: Float32Array[]): EnrolOutcome => {
    if (extractor === null) return { ok: false, reason: 'model_unavailable' }
    const speech = speechOnly(frames)
    const total = seconds(speech)
    if (total < MIN_ENROL_SECONDS) return { ok: false, reason: 'too_little_speech' }
    // The last HELD_OUT_PHRASES seconds, one second each, are held out; the rest is the candidate.
    const perSecond = Math.max(1, Math.round(ASR_SAMPLE_RATE / Math.max(1, speech[0]?.length ?? ASR_SAMPLE_RATE)))
    const cut = speech.length - HELD_OUT_PHRASES * perSecond
    const train = speech.slice(0, cut)
    const held = Array.from({ length: HELD_OUT_PHRASES }, (_, i) => speech.slice(cut + i * perSecond, cut + (i + 1) * perSecond))
    const embedding = embed(train)
    const heldEmbeddings = held.map((h) => embed(h))
    if (embedding === null || heldEmbeddings.some((e) => e === null)) return { ok: false, reason: 'model_unavailable' }
    const length = seconds(train)
    const quality: ProfileQuality = { phrases: 0, minSeconds: Math.round(length * 100) / 100, meanSeconds: Math.round(length * 100) / 100, meanRms: round3(speechRms(train)), maxClipped: round3(clippedShare(train)) }
    return commit(
      { format: 2, model: { id: modelName, hash: modelHash }, embedding, rms: quality.meanRms, seconds: Math.round(length * 10) / 10, phrases: 0, quality },
      heldEmbeddings.filter((e): e is number[] => e !== null),
    )
  }

  const verify = (frames: Float32Array[]): SpeakerVerification => {
    const version = profileVersionOf(profile)
    const deny = (reason: SpeakerReason, judgement: Judgement | null = null): SpeakerVerification => ({ judgement, reason, profileVersion: version })
    if (legacy && profile === null) return deny('model_mismatch')
    if (profile === null) return deny('profile_missing')
    if (extractor === null) return deny('model_unavailable')
    if (!comparable(profile) || !profile.heldOut.passed) return deny('model_mismatch')
    const speech = speechOnly(frames)
    const length = Math.round(seconds(speech) * 100) / 100
    if (length < MIN_JUDGE_SECONDS) return deny('insufficient_audio', { speaker: 'unknown', score: 0, seconds: length })
    let score: number
    try {
      score = cosine(normalised(extractor.embed(concat(speech))), profile.embedding)
    } catch {
      return deny('verification_error', { speaker: 'unknown', score: 0, seconds: length })
    }
    if (!Number.isFinite(score)) return deny('verification_error', { speaker: 'unknown', score: 0, seconds: length })
    const judgement: Judgement = { speaker: score >= thresholdOf(profile) ? 'owner' : 'other', score: round3(score), seconds: length }
    return { judgement, reason: judgement.speaker === 'owner' ? 'verified_owner' : 'rejected_other', profileVersion: version }
  }

  return {
    hasProfile: () => profile !== null,
    hasModel: () => extractor !== null,
    profileVersion: () => profileVersionOf(profile),
    verify,
    assessPhrase: assess,
    enrolScripted,
    enrolSpeech,
    enrol: (frames) => enrolSpeech(frames).ok,
    phrase: (frames) => assess(frames).phrase,
    enrolPhrases: (phrases) => enrolScripted(phrases).ok,
    readiness() {
      const base = { extractor: extractor !== null }
      if (profile === null) return { state: legacy ? 'needs_retraining' : 'no_profile', protected: false, ...base, profileMatchesModel: false, verifiable: false }
      const matches = comparable(profile)
      const verifiable = matches && profile.heldOut.passed
      const state: ReadinessState = extractor === null ? 'model_unavailable' : !verifiable ? 'model_mismatch' : 'ready'
      return {
        state,
        protected: state === 'ready',
        ...base,
        profileMatchesModel: matches,
        verifiable,
        phrases: profile.phrases,
        heldOut: { count: profile.heldOut.count, passed: profile.heldOut.passed },
        threshold: { value: thresholdOf(profile), source: profile.threshold.source, ...(thresholdOf(profile) === profile.threshold.value ? {} : { stored: profile.threshold.value }) },
      }
    },
    test(frames) {
      const verification = verify(frames)
      const quality = assess(frames)
      const result = speakerTestResult(verification.reason, quality.problem === 'too_short' ? null : quality.problem)
      const judgement = verification.judgement
      return { result, ...(judgement !== null && judgement.score !== 0 ? { score: judgement.score } : {}), ...(judgement?.seconds === undefined ? {} : { seconds: judgement.seconds }) }
    },
    deleteProfile() {
      try {
        if (existsSync(options.profilePath)) unlinkSync(options.profilePath)
      } catch {
        return false
      }
      profile = null
      legacy = false
      return true
    },
    judge(frames) {
      if (profile === null) return null
      const speech = speechOnly(frames)
      // Round 7: the seconds of speech go with every verdict.
      const length = Math.round(seconds(speech) * 100) / 100
      if (extractor === null || !comparable(profile)) {
        // Round 7: loud enough is null, not unknown (the mode off obeys either way; verify is what strict mode uses).
        const level = speechRms(frames)
        return profile.rms > 0 && level < profile.rms * ENERGY_OTHER_RATIO ? { speaker: 'other', score: 0, seconds: length } : null
      }
      if (length < MIN_JUDGE_SECONDS) return { speaker: 'unknown', score: 0, seconds: length }
      let score: number
      try {
        score = cosine(normalised(extractor.embed(concat(speech))), profile.embedding)
      } catch {
        return { speaker: 'unknown', score: 0, seconds: length }
      }
      if (!Number.isFinite(score)) return { speaker: 'unknown', score: 0, seconds: length }
      return { speaker: score >= thresholdOf(profile) ? 'owner' : 'other', score: round3(score), seconds: length }
    },
  }
}

// ---------- profiles per token (round 7, HOST lane, ARCHITECTURE 27.6) ----------
// Where a caller's profile lives, and one gate per profile over one shared extractor. Kept apart
// from the gate above: nothing here judges or enrols, it only picks the file.

export const PROFILES_DIR = 'profiles'

/**
 * The profile file of the caller with this id (auth.ts profileId; '' for the local user). The base
 * is UTLE_DATA_DIR (where Railway's volume mounts) or models/speaker. The local user keeps
 * owner.json, so nothing changes on the dev server; each token's user has profiles/<id>.json.
 */
export function profilePath(root: string, env: NodeJS.ProcessEnv, id: string): string {
  const dataDir = env.UTLE_DATA_DIR?.trim()
  const base = dataDir ? dataDir : join(root, SPEAKER_DIR)
  return id === '' ? join(base, PROFILE_FILE) : join(base, PROFILES_DIR, `${id}.json`)
}

/** The gate for a profile file, made on first use and kept, all over the one extractor (null without the model). */
export function speakerGates(extractor: EmbeddingExtractor | null, modelName?: string, modelHash?: string): (profilePath: string) => SpeakerGate {
  const gates = new Map<string, SpeakerGate>()
  return (path) => {
    let gate = gates.get(path)
    if (!gate) {
      gate = createSpeakerGate(extractor, { profilePath: path, ...(modelName === undefined ? {} : { modelName }), ...(modelHash === undefined ? {} : { modelHash }) })
      gates.set(path, gate)
    }
    return gate
  }
}

/**
 * What /api/status says of a profile: whether a verified voice is learnt, from how many seconds and
 * phrases, and its format. Never the embedding. Round 10 (31.7): a file of round 7 is
 * `needs_retraining` and not enrolled; a format-2 profile is enrolled only when it passed held-out.
 */
export function profileSummary(path: string): { enrolled: boolean; seconds?: number; format?: 'v2' | 'needs_retraining'; phrases?: number } {
  const stored = readStored(path)
  if (stored.kind === 'none') return { enrolled: false }
  if (stored.kind === 'legacy') return { enrolled: false, format: 'needs_retraining' }
  const p = stored.profile
  return { enrolled: p.embedding.length > 0 && p.heldOut.passed, seconds: p.seconds, format: 'v2', phrases: p.phrases }
}
