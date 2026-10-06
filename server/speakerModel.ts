/**
 * Loads sherpa-onnx's speaker embedding extractor over the model in models/speaker/ (round 4;
 * server/speaker.ts says which model and why). On the calling thread, lazily, like asrModel.ts:
 * nothing here runs in the browser bundle or the build. Null when the model file or the addon is
 * missing: the speaker gate then works on loudness alone.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { ASR_SAMPLE_RATE } from '../src/speech/asrProtocol.ts'
import { SPEAKER_DIR, SPEAKER_MODEL_FILE } from './speaker.ts'
import type { EmbeddingExtractor } from './speaker.ts'

/** The parts of sherpa-onnx-node's SpeakerEmbeddingExtractor this server uses. */
interface ExtractorLike {
  createStream(): { acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void; inputFinished(): void }
  isReady(stream: unknown): boolean
  compute(stream: unknown): Float32Array
}

type ExtractorConstructor = new (config: unknown) => ExtractorLike

export type SpeakerModelLoad = { ok: true; extractor: EmbeddingExtractor; ms: number } | { ok: false; reason: 'model_missing' | 'addon_missing' | 'load_failed' }

export function loadSpeakerModel(root: string): SpeakerModelLoad {
  const model = join(root, SPEAKER_DIR, SPEAKER_MODEL_FILE)
  if (!existsSync(model)) return { ok: false, reason: 'model_missing' }

  let Extractor: ExtractorConstructor
  try {
    const addon: unknown = createRequire(join(root, 'package.json'))('sherpa-onnx-node')
    const found = (addon as { SpeakerEmbeddingExtractor?: unknown }).SpeakerEmbeddingExtractor
    if (typeof found !== 'function') return { ok: false, reason: 'addon_missing' }
    Extractor = found as ExtractorConstructor
  } catch {
    return { ok: false, reason: 'addon_missing' }
  }

  try {
    const started = Date.now()
    const extractor = new Extractor({ model, numThreads: 1, provider: 'cpu', debug: 0 })
    return {
      ok: true,
      ms: Date.now() - started,
      extractor: {
        embed(samples) {
          const stream = extractor.createStream()
          stream.acceptWaveform({ samples, sampleRate: ASR_SAMPLE_RATE })
          stream.inputFinished()
          if (!extractor.isReady(stream)) throw new Error('too little audio for an embedding')
          return extractor.compute(stream)
        },
      },
    }
  } catch {
    return { ok: false, reason: 'load_failed' }
  }
}
