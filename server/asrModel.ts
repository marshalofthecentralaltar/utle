import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { AsrUnavailableReason } from '../src/speech/asrProtocol.ts'
import type { OnlineRecognizerLike } from './asrSession.ts'

export const MODEL_DIR = join('models', 'streaming-zipformer-large.et-en')
export const MODEL_FILES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'] as const

export type ModelLoad = { ok: true; recognizer: OnlineRecognizerLike; ms: number } | { ok: false; reason: AsrUnavailableReason }

type RecognizerConstructor = new (config: unknown) => OnlineRecognizerLike

/**
 * Loads the native addon and the model on the calling thread (the decode worker's, or the server's
 * when the worker cannot start). Lazily: nothing here runs in the browser bundle or the build.
 */
export function loadModel(root: string): ModelLoad {
  const dir = join(root, MODEL_DIR)
  if (!MODEL_FILES.every((file) => existsSync(join(dir, file)))) return { ok: false, reason: 'model_missing' }

  let OnlineRecognizer: RecognizerConstructor
  try {
    const addon: unknown = createRequire(join(root, 'package.json'))('sherpa-onnx-node')
    const found = (addon as { OnlineRecognizer?: unknown }).OnlineRecognizer
    if (typeof found !== 'function') return { ok: false, reason: 'addon_missing' }
    OnlineRecognizer = found as RecognizerConstructor
  } catch {
    return { ok: false, reason: 'addon_missing' }
  }

  try {
    const started = Date.now()
    const recognizer = new OnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: join(dir, 'encoder.int8.onnx'),
          decoder: join(dir, 'decoder.int8.onnx'),
          joiner: join(dir, 'joiner.int8.onnx'),
        },
        tokens: join(dir, 'tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
      },
      decodingMethod: 'modified_beam_search',
      enableEndpoint: true,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.0,
      rule3MinUtteranceLength: 30,
    })
    return { ok: true, recognizer, ms: Date.now() - started }
  } catch {
    return { ok: false, reason: 'load_failed' }
  }
}
