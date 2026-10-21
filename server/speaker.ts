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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Speaker } from '../src/speech/asrProtocol.ts'
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
 * second of voice is too little for this model, and those are `unknown` or `other` on their score; continuity
 * (below) lets them through right after an owner final. The stand-in owner is a synthetic voice (TartuNLP's "mari"; there is no recording of
 * the owner on disk), and a real voice through a real microphone scores itself lower than a
 * synthetic one does. Re-pick it on his own recordings (UTLE_CAPTURE, HANDOFF 1g) and change this.
 */
export const OWNER_THRESHOLD = 0.54
/**
 * An utterance with less speech than this (frames at or above SILENCE_RMS) is `unknown`: too little
 * voice for an embedding to mean anything. A "jah" or a "saada" is 0.4 to 0.5 s of speech.
 */
export const MIN_JUDGE_SECONDS = 0.5
/**
 * Continuity (round 7): an utterance with less speech than this is too short for the embedding to
 * tell voices apart. Measured on scripts/fixtures/speaker-set: the stand-in owner's one-word clips
 * ("jah", "saada", "üks", 0.4 to 0.5 s of speech) scored 0.14 to 0.27 against his own profile, below
 * every other voice's best (0.499), so no threshold keeps them and still drops a friend; his
 * utterances of 0.6 s of speech or more scored 0.62 to 0.76. Such a word is judged by who spoke last
 * (continued, below), not by its score.
 */
export const SHORT_UTTERANCE_SECONDS = 1.0
/**
 * Continuity: a short utterance within this long of an owner final (judged on its score) is the
 * owner's. Ten seconds covers "keri alla" then "veel" or a sentence then "saada"; a friend's short
 * word in that window passes too, which is the cost, and it ends at his next long utterance judged
 * other or ten seconds after he last spoke.
 */
export const CONTINUITY_MS = 10_000
/** The energy gate: an utterance whose speech RMS is below this share of the owner's enrolled RMS is `other`. */
export const ENERGY_OTHER_RATIO = 0.4
/** Enrolment needs at least this much speech. */
export const MIN_ENROL_SECONDS = 2
/** Scripted enrolment (round 7): a phrase with less speech than this is not counted (a cough, a click). */
export const MIN_PHRASE_SECONDS = 0.8
/** Scripted enrolment: a profile from fewer phrases than this is kept, and the bar says it is thin. */
export const ENOUGH_PHRASES = 6

/** What the server needs of sherpa's SpeakerEmbeddingExtractor. embed: one utterance's samples at 16 kHz to an embedding. */
export interface EmbeddingExtractor {
  embed(samples: Float32Array): Float32Array
}

export interface SpeakerProfile {
  version: 1
  /** The model file the embedding came from, or '' for a loudness-only profile. */
  model: string
  /** Unit length. Empty when enrolled without the model. */
  embedding: number[]
  /** Mean RMS of the owner's speech frames at enrolment. */
  rms: number
  /** Seconds of speech the profile was made from. */
  seconds: number
  /** Round 7: how many read phrases the embedding is the mean of; 0 for the free-speech enrolment. */
  phrases: number
}

/** Round 7: one read phrase of scripted enrolment, embedded at once (the audio is not kept). */
export interface EnrolPhrase {
  /** Unit length; empty without the model. */
  embedding: number[]
  rms: number
  seconds: number
}

export interface Judgement {
  speaker: Speaker
  /** Cosine similarity to the owner's embedding, or 0 without one. */
  score: number
  /** Round 7: seconds of speech the verdict was made from (speechOnly); absent when not measured. */
  seconds?: number
  /** Round 7: why the verdict is not the score's: 'continuity' (continued, below). */
  reason?: 'continuity'
}

/**
 * Continuity (round 7, ARCHITECTURE 24.2): an utterance with under SHORT_UTTERANCE_SECONDS of
 * speech is the owner's when the session's last owner final judged on its score was at most
 * CONTINUITY_MS before `at`, whatever it scored. Otherwise, or when its length was not measured, the
 * judgement stands. ownerAt: when that owner final was delivered, or null when none counts.
 */
export function continued(judgement: Judgement, ownerAt: number | null, at: number): Judgement {
  if (ownerAt === null || judgement.seconds === undefined) return judgement
  if (judgement.seconds >= SHORT_UTTERANCE_SECONDS || at - ownerAt > CONTINUITY_MS) return judgement
  return { ...judgement, speaker: 'owner', reason: 'continuity' }
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
}

export interface SpeakerGateOptions {
  /** Where the profile is read at start and written at enrolment. */
  profilePath: string
  /** For the profile's record of which model made it. */
  modelName?: string
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

function readProfile(path: string): SpeakerProfile | null {
  if (!existsSync(path)) return null
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof value !== 'object' || value === null) return null
    const record = value as Record<string, unknown>
    if (record.version !== 1 || !Array.isArray(record.embedding) || typeof record.rms !== 'number') return null
    const embedding = record.embedding.filter((x): x is number => typeof x === 'number')
    return {
      version: 1,
      model: typeof record.model === 'string' ? record.model : '',
      embedding,
      rms: record.rms,
      seconds: typeof record.seconds === 'number' ? record.seconds : 0,
      phrases: typeof record.phrases === 'number' ? record.phrases : 0,
    }
  } catch {
    return null
  }
}

function writeProfile(path: string, profile: SpeakerProfile): void {
  mkdirSync(dirname(path), { recursive: true })
  const partial = `${path}.part`
  writeFileSync(partial, JSON.stringify(profile))
  renameSync(partial, path)
}

/**
 * The gate over an extractor (null without the model). The profile at profilePath is loaded once
 * here. With the model, the verdict is the cosine similarity of the utterance's embedding to the
 * owner's. Without it, only the energy gate speaks: an utterance whose speech RMS is below
 * ENERGY_OTHER_RATIO of the owner's enrolled RMS is `other`, everything else null (no verdict). Its limits
 * are plain: it tells distance from the microphone, not voices; a loud stranger near the microphone
 * passes it, and the owner speaking softly fails it (the strip then says someone else spoke; he
 * says it again). With the model the embedding alone decides.
 */
export function createSpeakerGate(extractor: EmbeddingExtractor | null, options: SpeakerGateOptions): SpeakerGate {
  let profile = readProfile(options.profilePath)
  const modelName = options.modelName ?? SPEAKER_MODEL_FILE
  // A profile made with the model cannot be compared without it, nor one made with another model
  // (review: its embedding would score the owner as a stranger); its loudness still can.
  const comparable = (p: SpeakerProfile): boolean => extractor !== null && p.embedding.length > 0 && (p.model === '' || p.model === modelName)
  const save = (next: SpeakerProfile): boolean => {
    try {
      writeProfile(options.profilePath, next)
    } catch {
      return false
    }
    profile = next
    return true
  }
  return {
    hasProfile: () => profile !== null,
    hasModel: () => extractor !== null,
    enrol(frames) {
      const speech = speechOnly(frames)
      const length = seconds(speech)
      if (length < MIN_ENROL_SECONDS) return false
      const level = speechRms(speech)
      let embedding: number[] = []
      if (extractor !== null) {
        try {
          embedding = normalised(extractor.embed(concat(speech)))
        } catch {
          return false
        }
      }
      return save({ version: 1, model: extractor === null ? '' : modelName, embedding, rms: level, seconds: Math.round(length * 10) / 10, phrases: 0 })
    },
    phrase(frames) {
      const speech = speechOnly(frames)
      const length = seconds(speech)
      if (length < MIN_PHRASE_SECONDS) return null
      let embedding: number[] = []
      if (extractor !== null) {
        try {
          embedding = normalised(extractor.embed(concat(speech)))
        } catch {
          return null
        }
      }
      return { embedding, rms: speechRms(speech), seconds: length }
    },
    enrolPhrases(phrases) {
      const length = phrases.reduce((n, p) => n + p.seconds, 0)
      if (phrases.length === 0 || length < MIN_ENROL_SECONDS) return false
      const embedded = phrases.filter((p) => p.embedding.length > 0)
      const embedding = extractor !== null && embedded.length === phrases.length ? meanEmbedding(embedded.map((p) => p.embedding)) : []
      const level = phrases.reduce((n, p) => n + p.rms, 0) / phrases.length
      return save({ version: 1, model: embedding.length > 0 ? modelName : '', embedding, rms: level, seconds: Math.round(length * 10) / 10, phrases: phrases.length })
    },
    judge(frames) {
      if (profile === null) return null
      const speech = speechOnly(frames)
      // Round 7: the seconds of speech go with every verdict, for continuity.
      const length = Math.round(seconds(speech) * 100) / 100
      if (extractor === null || !comparable(profile)) {
        // Round 7: loud enough is null, not unknown: strict mode drops unknown, and without a voice to
        // compare with that would drop every word he says.
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
      return { speaker: verdict(score), score: Math.round(score * 1000) / 1000, seconds: length }
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
export function speakerGates(extractor: EmbeddingExtractor | null, modelName?: string): (profilePath: string) => SpeakerGate {
  const gates = new Map<string, SpeakerGate>()
  return (path) => {
    let gate = gates.get(path)
    if (!gate) {
      gate = createSpeakerGate(extractor, modelName === undefined ? { profilePath: path } : { profilePath: path, modelName })
      gates.set(path, gate)
    }
    return gate
  }
}

/** What /api/status says of a profile: whether a voice is learnt, and from how many seconds. Never the embedding. */
export function profileSummary(path: string): { enrolled: boolean; seconds?: number } {
  const profile = readProfile(path)
  return profile === null ? { enrolled: false } : { enrolled: true, seconds: profile.seconds }
}
