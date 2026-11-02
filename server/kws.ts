import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MODEL_DIR, MODEL_FILES } from './asrModel.ts'

/**
 * Round 10 (#2, ARCHITECTURE 35): the wake word heard in the audio. sherpa-onnx's KeywordSpotter
 * over TalTech's streaming zipformer (the recogniser's own model files, no download): a beam search
 * that may only follow the keywords' token paths, so it hears "Ütle" as a sound, not as a word the
 * recogniser chose to write. Lazily loaded on the decoder's thread (the worker, or the server's).
 *
 * The keyword is the model's one token `▁ütle` (id 231). Its relatives start with the same token
 * ("ütlen" is `▁ütle n`), so the spec has them as decoys: a path that goes on into a suffix ends in
 * the decoy, which is never a wake, and `numTrailingBlanks` asks for silence after the word before
 * `▁ütle` alone counts (scripts/kws-eval.ts measured the values; 35.1).
 */

/** One line of the keyword spec: the model's tokens, and the label a hit carries. */
export interface SpotterKeyword {
  tokens: string
  label: string
  /** Per keyword: the boost of its path (sherpa's `:score`) and its own threshold (`#threshold`). */
  boost?: number
  threshold?: number
}

export interface SpotterSpec {
  keywords: readonly SpotterKeyword[]
  numTrailingBlanks: number
  keywordsThreshold: number
  keywordsScore: number
  maxActivePaths: number
  numThreads: number
}

/** The label of the wake word's line; every other label is a decoy. */
export const WAKE_LABEL = 'ütle'

/**
 * The model is cased: "Ütle" at the start of a sentence is `▁Ü t le`, inside one `▁ütle` (measured
 * with `kws-eval.ts --tokens`). Both spellings are the wake word.
 */
export const WAKE_FORMS: readonly string[] = ['▁ütle', '▁Ü t le']

/** The suffix tokens of the relatives that start with the wake word's tokens ("ütlen" is `▁ütle n`). */
const RELATIVE_SUFFIXES: readonly string[] = ['n', 's', 'b', 'me', 'mine', 'sin', 'ja', 'ks', 'v', 'd', 'te', 'ma', 'mise', 'sid']

/** The relatives of "ütle" in both spellings: each a decoy, never a wake. */
export const WAKE_DECOYS: readonly SpotterKeyword[] = [
  ...WAKE_FORMS.flatMap((form) => RELATIVE_SUFFIXES.map((suffix) => ({ tokens: `${form} ${suffix}`, label: `ütle-${suffix}` }))),
  { tokens: '▁ütleme', label: 'ütle-me' },
]

/** The wake word's lines. */
export const WAKE_KEYWORDS: readonly SpotterKeyword[] = WAKE_FORMS.map((tokens) => ({ tokens, label: WAKE_LABEL }))

/** The spec the server runs (scripts/kws-eval.ts measured it; ARCHITECTURE 35.1). */
export const WAKE_SPEC: SpotterSpec = {
  keywords: [...WAKE_KEYWORDS, ...WAKE_DECOYS],
  numTrailingBlanks: 2,
  keywordsThreshold: 0.1,
  keywordsScore: 1.0,
  maxActivePaths: 4,
  numThreads: 1,
}

/** The keyword file's text: one keyword per line, `tokens [:boost] [#threshold] @label`. */
export function keywordsText(spec: SpotterSpec): string {
  return spec.keywords
    .map((k) => [k.tokens, k.boost === undefined ? '' : `:${k.boost}`, k.threshold === undefined ? '' : `#${k.threshold}`, `@${k.label}`].filter((part) => part !== '').join(' '))
    .join('\n')
}

/** The parts of sherpa-onnx-node's KeywordSpotter this server uses. */
export interface SpotterStreamLike {
  acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void
}
export interface KeywordSpotterLike<S extends SpotterStreamLike = SpotterStreamLike> {
  createStream(): S
  isReady(stream: S): boolean
  decode(stream: S): void
  getResult(stream: S): { keyword: string }
  reset(stream: S): void
}

export type SpotterLoad = { ok: true; spotter: KeywordSpotterLike; ms: number } | { ok: false; reason: 'model_missing' | 'addon_missing' | 'load_failed' }

type SpotterConstructor = new (config: unknown) => KeywordSpotterLike

/** The spotter over the recogniser's model files, or why not. Never throws. */
export function loadSpotter(root: string, spec: SpotterSpec = WAKE_SPEC): SpotterLoad {
  const dir = join(root, MODEL_DIR)
  if (!MODEL_FILES.every((file) => existsSync(join(dir, file)))) return { ok: false, reason: 'model_missing' }
  let KeywordSpotter: SpotterConstructor
  try {
    const addon: unknown = createRequire(join(root, 'package.json'))('sherpa-onnx-node')
    const found = (addon as { KeywordSpotter?: unknown }).KeywordSpotter
    if (typeof found !== 'function') return { ok: false, reason: 'addon_missing' }
    KeywordSpotter = found as SpotterConstructor
  } catch {
    return { ok: false, reason: 'addon_missing' }
  }
  try {
    const started = Date.now()
    const keywords = keywordsText(spec)
    const spotter = new KeywordSpotter({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: join(dir, 'encoder.int8.onnx'), decoder: join(dir, 'decoder.int8.onnx'), joiner: join(dir, 'joiner.int8.onnx') },
        tokens: join(dir, 'tokens.txt'),
        numThreads: spec.numThreads,
        provider: 'cpu',
        debug: 0,
      },
      maxActivePaths: spec.maxActivePaths,
      numTrailingBlanks: spec.numTrailingBlanks,
      keywordsScore: spec.keywordsScore,
      keywordsThreshold: spec.keywordsThreshold,
      keywordsBuf: keywords,
      keywordsBufSize: Buffer.byteLength(keywords, 'utf8'),
    })
    return { ok: true, spotter, ms: Date.now() - started }
  } catch {
    return { ok: false, reason: 'load_failed' }
  }
}
