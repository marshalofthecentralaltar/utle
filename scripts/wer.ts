/**
 * Round 10, lane MEASURE (issue #4): word and character error rates of the speech engines on a
 * labelled folder (labels.tsv, scripts/measure.ts), per clip and in total, with each engine's median
 * end-of-utterance latency and its price per hour of audio.
 *
 *   npx tsx scripts/wer.ts --labels <labels.tsv> [--engine taltech] [--json <file>] [--kind command,...]
 *
 * Normalisation (both sides, scripts/measure.ts normaliseEt): lower case, punctuation and quotes
 * removed, apostrophes dropped inside a word, digits spelled one by one in Estonian. Clips with a
 * blank reference are skipped and counted. A total is the summed errors over the summed reference
 * words, not a mean of per-clip rates.
 *
 * Every clip is streamed in real time, 100 ms frames, then 2 s of silence (as scripts/asr-file.ts
 * does, so the endpoint rule can close the last utterance). End-of-utterance latency: wall time from
 * sending the frame that holds the clip's last speech (speechEndSample, -40 dBFS) to the engine's
 * last final for the clip. It includes each engine's own endpoint silence rule.
 *
 * Engines:
 *   taltech  the local recogniser through the same code as scripts/asr-file.ts and the server
 *            (server/asrModel.ts, decoderInThread, the speech detector). Cost: none per hour (this machine).
 *   A cloud recogniser was the second engine until round 12 removed it from the server (never run
 *   with a real key); another engine is one more entry in ENGINES (ElevenLabs is not wired: no key).
 *
 * Prints references and hypotheses to the terminal; writes them to the JSON file only, which by
 * default sits next to labels.tsv (artifacts/ when labels.tsv is in the repository).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ASR_FRAME_SAMPLES } from '../src/speech/asrProtocol.ts'
import { loadModel } from '../server/asrModel.ts'
import { decoderInThread } from '../server/asrSession.ts'
import { loadVad } from '../server/vad.ts'
import { charErrors, insideRepo, median, parseLabels, rate, speechEndSample, sumCounts, wordErrors } from './measure.ts'
import type { ErrorCount, LabelRow } from './measure.ts'
import { readAnyWav } from './wav.ts'

const RATE = 16000
const FRAME_MS = (ASR_FRAME_SAMPLES * 1000) / RATE
const TAIL_S = 2
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface Transcript {
  text: string
  /** Wall ms from the frame with the last speech to the last final; NaN when no final came. */
  eouMs: number
  /** Seconds of audio sent (clip plus tail), for the bill. */
  sentS: number
}
export interface Engine {
  name: string
  usdPerHour: number
  priceSource: string
  transcribe(samples: Float32Array): Promise<Transcript>
  close(): void
}

/** Frames of the clip plus the silent tail, and the index of the frame holding the last speech. */
function framesOf(samples: Float32Array): { frames: Float32Array[]; lastSpeechFrame: number } {
  const all = new Float32Array(samples.length + TAIL_S * RATE)
  all.set(samples)
  const frames: Float32Array[] = []
  for (let at = 0; at < all.length; at += ASR_FRAME_SAMPLES) frames.push(all.slice(at, at + ASR_FRAME_SAMPLES))
  return { frames, lastSpeechFrame: Math.max(0, Math.ceil(speechEndSample(samples) / ASR_FRAME_SAMPLES) - 1) }
}

async function taltech(): Promise<Engine> {
  const loaded = loadModel(repoRoot)
  if (!loaded.ok) throw new Error(`taltech: recogniser not loaded: ${loaded.reason} (npm run model)`)
  const vad = loadVad(repoRoot)
  return {
    name: 'taltech',
    usdPerHour: 0,
    priceSource: 'runs on this machine',
    async transcribe(samples) {
      const decoder = decoderInThread(loaded.recognizer, null, { vad: vad.ok ? vad.create : null })
      const { frames, lastSpeechFrame } = framesOf(samples)
      const finals: string[] = []
      let speechSentAt = Number.NaN
      let lastFinalAt = Number.NaN
      let last = ''
      const started = performance.now()
      for (const [i, frame] of frames.entries()) {
        await sleep(Math.max(0, started + i * FRAME_MS - performance.now()))
        const result = decoder.accept(frame)
        if (result instanceof Promise) throw new Error('in-thread decoder is synchronous')
        if (i === lastSpeechFrame) speechSentAt = performance.now()
        last = result.text
        if (result.endpoint && result.text !== '') {
          finals.push(result.text)
          lastFinalAt = performance.now()
          last = ''
        }
      }
      if (last !== '') {
        finals.push(last)
        lastFinalAt = performance.now()
      }
      return { text: finals.join(' '), eouMs: lastFinalAt - speechSentAt, sentS: frames.length * (FRAME_MS / 1000) }
    },
    close() {},
  }
}

export const ENGINES: Readonly<Record<string, () => Promise<Engine>>> = {
  taltech,
  elevenlabs: () => Promise.reject(new Error('elevenlabs: not wired (no key); add a transcribe() here like taltech()')),
}

interface ClipResult {
  file: string
  speaker: string
  kind: string
  durationS: number
  reference: string
  engine: string
  hypothesis: string
  words: ErrorCount
  chars: ErrorCount
  eouMs: number
}

const argv = process.argv.slice(2)
const value = (name: string): string | undefined => {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}
const labelsArg = value('--labels')
if (labelsArg === undefined) {
  console.error('usage: npx tsx scripts/wer.ts --labels <labels.tsv> [--engine taltech] [--json <file>] [--kind command,dictation,...]')
  process.exit(2)
}
const labelsFile = resolve(labelsArg)
const labelsDir = dirname(labelsFile)
const kinds = value('--kind')?.split(',')
const rows: LabelRow[] = parseLabels(readFileSync(labelsFile, 'utf8')).filter((r) => kinds === undefined || kinds.includes(r.kind))
const usable = rows.filter((r) => r.reference !== '')
const engineNames = (value('--engine') ?? 'taltech').split(',').map((s) => s.trim())
const synthetic = insideRepo(labelsFile, repoRoot)

const results: ClipResult[] = []
const summary: Array<Record<string, unknown>> = []
for (const name of engineNames) {
  const make = ENGINES[name]
  if (make === undefined) throw new Error(`unknown engine "${name}"; known: ${Object.keys(ENGINES).join(', ')}`)
  const engine = await make()
  let sentS = 0
  console.log(`\n== ${name}: ${usable.length} clips with a reference (${rows.length - usable.length} without, skipped) ==`)
  for (const row of usable) {
    const path = isAbsolute(row.file) ? row.file : join(labelsDir, row.file)
    const wav = readAnyWav(path)
    if (wav.rate !== RATE) throw new Error(`${row.file}: ${wav.rate} Hz, expected ${RATE}`)
    const t = await engine.transcribe(wav.samples)
    sentS += t.sentS
    const r: ClipResult = { file: row.file, speaker: row.speaker, kind: row.kind, durationS: row.durationS, reference: row.reference, engine: name, hypothesis: t.text, words: wordErrors(row.reference, t.text), chars: charErrors(row.reference, t.text), eouMs: Math.round(t.eouMs) }
    results.push(r)
    console.log(`${basename(row.file).padEnd(30)} WER ${(rate(r.words) * 100).toFixed(0).padStart(3)}%  CER ${(rate(r.chars) * 100).toFixed(0).padStart(3)}%  ${String(r.eouMs).padStart(5)} ms  "${t.text}"  (ref "${row.reference}")`)
  }
  engine.close()
  const mine = results.filter((r) => r.engine === name)
  const words = sumCounts(mine.map((r) => r.words))
  const chars = sumCounts(mine.map((r) => r.chars))
  const eous = mine.map((r) => r.eouMs).filter((x) => Number.isFinite(x))
  summary.push({ engine: name, clips: mine.length, refWords: words.units, wordErrors: words.errors, wer: rate(words), cer: rate(chars), medianEouMs: median(eous), eouN: eous.length, usdPerHour: engine.usdPerHour, priceSource: engine.priceSource, audioSentS: Math.round(sentS * 10) / 10, spendUsd: (sentS / 3600) * engine.usdPerHour })
}

console.log(`\n${synthetic ? 'SYNTHETIC (labels inside the repository: TartuNLP text-to-speech voices, not people)\n' : ''}engine     clips  ref words  WER      CER      median EOU  per hour  spent`)
for (const s of summary) {
  console.log(
    `${String(s.engine).padEnd(10)} ${String(s.clips).padStart(5)}  ${String(s.refWords).padStart(9)}  ${(Number(s.wer) * 100).toFixed(1).padStart(5)} %  ${(Number(s.cer) * 100).toFixed(1).padStart(5)} %  ${String(Math.round(Number(s.medianEouMs))).padStart(7)} ms  $${Number(s.usdPerHour).toFixed(2).padStart(6)}  $${Number(s.spendUsd).toFixed(4)} (${s.audioSentS} s sent)`,
  )
}

const jsonPath = value('--json') ?? (synthetic ? join(repoRoot, 'artifacts', 'wer.json') : join(labelsDir, 'wer.json'))
mkdirSync(dirname(jsonPath), { recursive: true })
writeFileSync(jsonPath, `${JSON.stringify({ labels: labelsFile, synthetic, normalisation: 'scripts/measure.ts normaliseEt', summary, clips: results }, null, 2)}\n`)
console.log(`wrote ${jsonPath}${existsSync(jsonPath) ? '' : ' (failed)'}`)
