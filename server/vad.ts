/**
 * The speech detector in front of the decoder (round 7, SPEECH lane; ARCHITECTURE 24.2). The owner's
 * report: room noise was typed as words. The recogniser decodes every frame it is given and will
 * find words in a fan or a street; Silero VAD tells speech from everything else, and only speech
 * reaches the decoder and the speaker gate. Everything else is replaced by digital silence of the
 * same length, so the decoder's clock (its endpoint rules count trailing silence) is unchanged.
 *
 * Model: Silero VAD v5 in sherpa-onnx's asr-models release:
 *   https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad_v5.onnx
 *   2 313 101 bytes, 16 kHz, 32 ms windows. Not v4 (`silero_vad.onnx`, 644 kB): through Chrome's
 *   microphone path (the extension's voice test, et-numbers-one) v4 missed the quiet one-word "üks"
 *   at every threshold above 0.2; v5 finds it at 0.5 with 0.1 s minimum speech, and neither finds
 *   anything in 20 s of pink noise at -30 dBFS. `npm run model` fetches it as a third, optional file;
 *   without it the server decodes every frame, as before, and logs `[asr] no vad model`.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { ASR_SAMPLE_RATE } from '../src/speech/asrProtocol.ts'

export const VAD_DIR = join('models', 'vad')
export const VAD_MODEL_FILE = 'silero_vad_v5.onnx'
export const VAD_MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${VAD_MODEL_FILE}`
export const VAD_MODEL_BYTES = 2_313_101

/**
 * Silero's settings. threshold 0.5 is the model's own default. A segment needs 0.1 s of speech (a
 * click is shorter; "jah" and "üks" are about 0.4 s, and 0.15 s missed the live "üks") and ends after
 * 0.5 s below the threshold, so the pause between two words of one sentence stays inside it.
 */
export const VAD_THRESHOLD = 0.5
export const VAD_MIN_SPEECH_SECONDS = 0.1
export const VAD_MIN_SILENCE_SECONDS = 0.5
/**
 * Audio remembered while no speech is detected, and passed on again as speech when it starts.
 * Silero says "speech" about 0.1 to 0.2 s after a word begins (measured on the fixtures: segment
 * start 2.378 s, first detected frame 2.4 to 2.5 s); 0.4 s covers the onset of the first word with
 * room. Nothing waits: silence goes to the decoder at once, so finals come no later than before;
 * at the start of speech the decoder hears the remembered 0.4 s once more, as audio this time.
 */
export const PRE_ROLL_MS = 400

/** The parts of sherpa-onnx-node's Vad this server uses. */
export interface VadLike {
  acceptWaveform(samples: Float32Array): void
  /** True while inside a speech segment. */
  isDetected(): boolean
  isEmpty(): boolean
  /** Drops the oldest finished segment (the filter does not need them; popping keeps memory flat). */
  pop(): void
}

/** One detector per stream: it has state. */
export type VadFactory = () => VadLike

export type VadLoad = { ok: true; create: VadFactory; ms: number } | { ok: false; reason: 'model_missing' | 'addon_missing' | 'load_failed' }

type VadConstructor = new (config: unknown, bufferSizeInSeconds: number) => VadLike

/** Loads the addon's Vad over models/vad/silero_vad.onnx, lazily, like asrModel.ts. One detector is made here to prove the model loads. */
export function loadVad(root: string): VadLoad {
  const model = join(root, VAD_DIR, VAD_MODEL_FILE)
  if (!existsSync(model)) return { ok: false, reason: 'model_missing' }
  let Vad: VadConstructor
  try {
    const addon: unknown = createRequire(join(root, 'package.json'))('sherpa-onnx-node')
    const found = (addon as { Vad?: unknown }).Vad
    if (typeof found !== 'function') return { ok: false, reason: 'addon_missing' }
    Vad = found as VadConstructor
  } catch {
    return { ok: false, reason: 'addon_missing' }
  }
  const config = {
    sileroVad: { model, threshold: VAD_THRESHOLD, minSilenceDuration: VAD_MIN_SILENCE_SECONDS, minSpeechDuration: VAD_MIN_SPEECH_SECONDS, windowSize: 512, maxSpeechDuration: 30 },
    sampleRate: ASR_SAMPLE_RATE,
    numThreads: 1,
    provider: 'cpu',
    debug: 0,
  }
  try {
    const started = Date.now()
    const create = (): VadLike => new Vad(config, 60)
    create()
    return { ok: true, create, ms: Date.now() - started }
  } catch {
    return { ok: false, reason: 'load_failed' }
  }
}

/** A frame for the decoder: the audio as heard (speech) or silence of its length (not speech). */
export interface FilteredFrame {
  samples: Float32Array
  speech: boolean
}

export interface SpeechFilter {
  /** One frame in; the frames the decoder gets now, in order (none while the pre-roll fills). */
  push(samples: Float32Array): FilteredFrame[]
}

const ms = (samples: Float32Array): number => (samples.length * 1000) / ASR_SAMPLE_RATE

/**
 * The detector as a filter over frames. While speech is detected each frame passes as heard. While
 * it is not, the frame passes at once as silence of its length, and is remembered (the newest
 * preRollMs of them); when speech starts, the remembered frames pass first, as speech: they hold
 * the start of the first word. The decoder then hears up to preRollMs more audio than arrived,
 * which it does not mind; its endpoint rules see the silence when it happens.
 */
export function createSpeechFilter(vad: VadLike, preRollMs = PRE_ROLL_MS): SpeechFilter {
  let recent: Float32Array[] = []
  let recentMs = 0
  return {
    push(samples) {
      vad.acceptWaveform(samples)
      while (!vad.isEmpty()) vad.pop()
      if (vad.isDetected()) {
        const out = recent.map((frame) => ({ samples: frame, speech: true }))
        recent = []
        recentMs = 0
        out.push({ samples, speech: true })
        return out
      }
      recent.push(samples)
      recentMs += ms(samples)
      while (recentMs > preRollMs && recent.length > 1) {
        const oldest = recent.shift()
        if (oldest) recentMs -= ms(oldest)
      }
      return [{ samples: new Float32Array(samples.length), speech: false }]
    },
  }
}
