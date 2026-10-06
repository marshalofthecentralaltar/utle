/**
 * The owner's voice (round 4, VOICE lane; ARCHITECTURE 24.2). The server learns one voice from
 * eight seconds of speech and, at every final, says whether the utterance was the owner's, someone
 * else's, or it cannot tell. The client with "Kuula ainult mind" on drops the finals of others.
 *
 * Model: WeSpeaker CAM++ trained on VoxCeleb, in sherpa-onnx's speaker-recognition release:
 *   https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_CAM++.onnx
 *   29.3 MB (29 292 684 bytes), 16 kHz, 192-dimensional embeddings.
 * Why this one: a speaker embedding describes the voice, not the words, so the model is text- and
 * language-independent by design (VoxCeleb is celebrity interviews in many languages; the "en" in
 * the name is the training set's label, not a limit). CAM++ is the lightest of the release's
 * VoxCeleb models in compute (a few hundred MFLOPs per second of audio), so judging a three-second
 * utterance costs well under 150 ms on a laptop CPU, and it is under 30 MB. Nothing in the release
 * was trained on Estonian; nothing in the release is for one language either. Not measured on an
 * Estonian voice by anyone: the thresholds below come from the model's VoxCeleb report and from
 * the usual practice with cosine scores, and are constants so a session with the owner can move them.
 *
 * The profile is `models/speaker/owner.json`: a unit-length embedding and the owner's speech
 * loudness (RMS). Never audio. `npm run model` downloads the model (optional second step); without
 * it the gate still works on loudness alone (energy gate, below) and never says `owner`.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Speaker } from '../src/speech/asrProtocol.ts'
import { ASR_SAMPLE_RATE } from '../src/speech/asrProtocol.ts'
import { SILENCE_RMS, rms } from './asrSession.ts'

export const SPEAKER_DIR = join('models', 'speaker')
export const SPEAKER_MODEL_FILE = 'wespeaker_en_voxceleb_CAM++.onnx'
export const SPEAKER_MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/${SPEAKER_MODEL_FILE}`
export const SPEAKER_MODEL_BYTES = 29_292_684
export const PROFILE_FILE = 'owner.json'

/**
 * Cosine similarity at or above this is the owner. 0.55: VoxCeleb-trained CAM++ scores the same
 * speaker on different sentences at about 0.6 to 0.8 and different speakers at about 0.0 to 0.3;
 * the equal-error point reported for such models is near 0.45. 0.55 sits above it, so a stranger
 * is rarely let through, and an owner on a bad day (a cold, a far microphone) lands in `unknown`
 * rather than `other`: unknown is still obeyed, so a wrong profile never locks him out.
 */
export const OWNER_THRESHOLD = 0.55
/** At or below this it is someone else. Below the equal-error point with a margin: `other` is the only verdict that drops words. */
export const OTHER_THRESHOLD = 0.35
/** An utterance shorter than this is `unknown`: too little voice for an embedding to mean anything. */
export const MIN_JUDGE_SECONDS = 0.8
/** The energy gate: an utterance whose speech RMS is below this share of the owner's enrolled RMS is `other`. */
export const ENERGY_OTHER_RATIO = 0.4
/** Enrolment needs at least this much speech. */
export const MIN_ENROL_SECONDS = 2

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
}

export interface Judgement {
  speaker: Speaker
  /** Cosine similarity to the owner's embedding, or 0 without one. */
  score: number
}

export interface SpeakerGate {
  /** A profile is stored: finals carry a speaker. */
  hasProfile(): boolean
  /** The embedding model is loaded: `owner` is possible. */
  hasModel(): boolean
  /** Learns the owner from these frames (speech only; the caller skips silence). Replaces any earlier profile. False when there is too little speech. */
  enrol(frames: Float32Array[]): boolean
  /** Who spoke these frames (one whole utterance), or null when there is no profile. */
  judge(frames: Float32Array[]): Judgement | null
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

/** Cosine similarity of two vectors already of unit length. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  for (let i = 0; i < a.length; i += 1) dot += (a[i] ?? 0) * (b[i] ?? 0)
  return dot
}

/** The verdict for a score: owner at or above OWNER_THRESHOLD, other at or below OTHER_THRESHOLD, unknown between. */
export function verdict(score: number): Speaker {
  if (score >= OWNER_THRESHOLD) return 'owner'
  if (score <= OTHER_THRESHOLD) return 'other'
  return 'unknown'
}

function readProfile(path: string): SpeakerProfile | null {
  if (!existsSync(path)) return null
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof value !== 'object' || value === null) return null
    const record = value as Record<string, unknown>
    if (record.version !== 1 || !Array.isArray(record.embedding) || typeof record.rms !== 'number') return null
    const embedding = record.embedding.filter((x): x is number => typeof x === 'number')
    return { version: 1, model: typeof record.model === 'string' ? record.model : '', embedding, rms: record.rms, seconds: typeof record.seconds === 'number' ? record.seconds : 0 }
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
 * ENERGY_OTHER_RATIO of the owner's enrolled RMS is `other`, everything else `unknown`. Its limits
 * are plain: it tells distance from the microphone, not voices; a loud stranger near the microphone
 * passes it, and the owner speaking softly fails it (the strip then says someone else spoke; he
 * says it again). With the model the embedding alone decides.
 */
export function createSpeakerGate(extractor: EmbeddingExtractor | null, options: SpeakerGateOptions): SpeakerGate {
  let profile = readProfile(options.profilePath)
  // A profile made with the model cannot be compared without it; its loudness still can.
  return {
    hasProfile: () => profile !== null,
    hasModel: () => extractor !== null,
    enrol(frames) {
      const speech = frames.filter((frame) => rms(frame) >= SILENCE_RMS)
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
      const next: SpeakerProfile = { version: 1, model: extractor === null ? '' : (options.modelName ?? SPEAKER_MODEL_FILE), embedding, rms: level, seconds: Math.round(length * 10) / 10 }
      try {
        writeProfile(options.profilePath, next)
      } catch {
        return false
      }
      profile = next
      return true
    },
    judge(frames) {
      if (profile === null) return null
      if (seconds(frames) < MIN_JUDGE_SECONDS) return { speaker: 'unknown', score: 0 }
      if (extractor === null || profile.embedding.length === 0) {
        const level = speechRms(frames)
        return { speaker: profile.rms > 0 && level < profile.rms * ENERGY_OTHER_RATIO ? 'other' : 'unknown', score: 0 }
      }
      let score: number
      try {
        score = cosine(normalised(extractor.embed(concat(frames))), profile.embedding)
      } catch {
        return { speaker: 'unknown', score: 0 }
      }
      if (!Number.isFinite(score)) return { speaker: 'unknown', score: 0 }
      return { speaker: verdict(score), score: Math.round(score * 1000) / 1000 }
    },
  }
}
