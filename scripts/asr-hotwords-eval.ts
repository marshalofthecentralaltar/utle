/**
 * Round 7 (ARCHITECTURE 28.1): runs the recorded fixtures through the real local recogniser with
 * and without hotwords and prints the finals and the word errors of each against the text spoken.
 *
 *   npx tsx scripts/asr-hotwords-eval.ts                  every fixture, off and at HOTWORDS_SCORE
 *   npx tsx scripts/asr-hotwords-eval.ts 1 2 3            off and at each score given
 *   npx tsx scripts/asr-hotwords-eval.ts <file.wav>       one fixture (its finals only, no reference)
 *
 * The recogniser config is server/asrModel.ts's (copied here so the score can vary); the hotword
 * files are written to a temporary folder, never into models/. Needs `npm run model`.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL_DIR } from '../server/asrModel.ts'
import { HOTWORDS_SCORE, hotwordsConfig } from '../server/hotwords.ts'
import { readPcmWav } from './wav.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = join(root, MODEL_DIR)
const fixtures = join(root, 'scripts', 'fixtures')

/** What each fixture says (TartuNLP speech, scripts/fixture.ts), lowercase words without punctuation. */
const SPOKEN: Record<string, string> = {
  'et-jah-16k.wav': 'jah',
  'et-scroll-tab-16k.wav': 'keri alla järgmine vaheleht',
  'et-numbers-one-16k.wav': 'näita numbreid üks',
  'et-sentence-16k.wav': 'tere ava uus vaheleht ja kirjuta marile et ma jõuan homme kell kolm',
  'et-dictate-send-16k.wav': 'tere mari ma jõuan homme kell kolm saada',
}

interface Stream {
  acceptWaveform(obj: { samples: Float32Array; sampleRate: number }): void
  inputFinished(): void
}
interface Recognizer {
  createStream(): Stream
  isReady(stream: Stream): boolean
  decode(stream: Stream): void
  getResult(stream: Stream): { text: string; tokens?: string[] }
  isEndpoint(stream: Stream): boolean
  reset(stream: Stream): void
}
type RecognizerConstructor = new (config: unknown) => Recognizer

const addon = createRequire(join(root, 'package.json'))('sherpa-onnx-node') as { OnlineRecognizer: RecognizerConstructor }

function recognizer(score: number, hotRoot: string): Recognizer {
  const hotwords = hotwordsConfig(hotRoot, dir, score)
  return new addon.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: join(dir, 'encoder.int8.onnx'), decoder: join(dir, 'decoder.int8.onnx'), joiner: join(dir, 'joiner.int8.onnx') },
      tokens: join(dir, 'tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
      ...hotwords.model,
    },
    decodingMethod: 'modified_beam_search',
    ...hotwords.recognizer,
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.0,
    rule3MinUtteranceLength: 30,
  })
}

/** The finals of one wav, fed in 100 ms frames as the server gets them, then 2 s of silence. */
function finals(r: Recognizer, path: string): { text: string; tokens: string[] }[] {
  const { rate, samples } = readPcmWav(path)
  const stream = r.createStream()
  const out: { text: string; tokens: string[] }[] = []
  const take = (): void => {
    const result = r.getResult(stream)
    if (result.text.trim() !== '') out.push({ text: result.text.trim(), tokens: result.tokens ?? [] })
  }
  const feed = (chunk: Float32Array): void => {
    stream.acceptWaveform({ samples: chunk, sampleRate: rate })
    while (r.isReady(stream)) r.decode(stream)
    if (r.isEndpoint(stream)) {
      take()
      r.reset(stream)
    }
  }
  const frame = rate / 10
  for (let i = 0; i < samples.length; i += frame) feed(samples.slice(i, i + frame))
  for (let i = 0; i < 20; i += 1) feed(new Float32Array(frame))
  stream.inputFinished()
  while (r.isReady(stream)) r.decode(stream)
  take()
  return out
}

const words = (text: string): string[] => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/u).filter((w) => w !== '')

/** Word-level edit distance (substitutions, insertions, deletions). */
function wordErrors(hyp: readonly string[], ref: readonly string[]): number {
  let prev = Array.from({ length: ref.length + 1 }, (_, j) => j)
  for (let i = 1; i <= hyp.length; i += 1) {
    const row = [i]
    for (let j = 1; j <= ref.length; j += 1) {
      row.push(Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (hyp[i - 1] === ref[j - 1] ? 0 : 1)))
    }
    prev = row
  }
  return prev[ref.length] ?? 0
}

const args = process.argv.slice(2)
const wav = args.find((a) => a.endsWith('.wav'))
const scores = args.filter((a) => !a.endsWith('.wav')).map(Number)
const runs = [0, ...(scores.length > 0 ? scores : [HOTWORDS_SCORE])]
const hotRoot = mkdtempSync(join(tmpdir(), 'utle-hotwords-eval-'))
try {
  const files = wav ? [wav] : Object.keys(SPOKEN).map((f) => join(fixtures, f))
  const recognizers = runs.map((score) => ({ score, r: recognizer(score, hotRoot) }))
  const totals = new Map<number, number>(runs.map((s) => [s, 0]))
  let refWords = 0
  for (const file of files) {
    const ref = SPOKEN[basename(file)]
    console.log(`\n== ${basename(file)}${ref === undefined ? '' : `   spoken: "${ref}"`}`)
    if (ref !== undefined) refWords += words(ref).length
    for (const { score, r } of recognizers) {
      const got = finals(r, file)
      const text = got.map((f) => f.text).join(' | ')
      const errors = ref === undefined ? NaN : wordErrors(words(got.map((f) => f.text).join(' ')), words(ref))
      totals.set(score, (totals.get(score) ?? 0) + (Number.isNaN(errors) ? 0 : errors))
      console.log(`  ${score === 0 ? 'off      ' : `score ${score.toFixed(1)}`}  errors ${String(errors).padStart(2)}  ${JSON.stringify(text)}`)
      if (process.env.UTLE_TOKENS === '1') for (const f of got) console.log(`             tokens ${f.tokens.join(' ')}`)
    }
  }
  if (!wav) {
    console.log(`\nword errors over ${refWords} words:`)
    for (const [score, n] of totals) console.log(`  ${score === 0 ? 'off      ' : `score ${score.toFixed(1)}`}  ${n}  (WER ${((100 * n) / refWords).toFixed(1)} %)`)
  }
} finally {
  rmSync(hotRoot, { recursive: true, force: true })
}
