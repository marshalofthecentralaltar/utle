/**
 * Round 10 (#2, ARCHITECTURE 35.1): does sherpa-onnx's KeywordSpotter over TalTech's zipformer hear
 * "Ütle" in the audio, and only "Ütle"? Runs the labelled clips of scripts/kws-set.ts (SYNTHETIC
 * TartuNLP voices, artifacts/kws-set/) through the spotter and prints, per keyword spec, how many clips
 * of each set fired the wake word, the decoys that fired, the time from the speech end to the wake
 * for the bare word, and the spotter's CPU and memory.
 *
 *   npx tsx scripts/kws-set.ts --eval               (once, needs the network)
 *   npx tsx scripts/kws-eval.ts                     the server's spec (server/kws.ts WAKE_SPEC)
 *   npx tsx scripts/kws-eval.ts --spec bare1,decoy3 named specs (see SPECS below), one process each is fairer for CPU
 *   npx tsx scripts/kws-eval.ts --sweep             every spec in SPECS
 *   npx tsx scripts/kws-eval.ts --tokens            the recogniser's own tokens for each relative and literal clip
 *   npx tsx scripts/kws-eval.ts --clips             one line per clip and spec (what fired, when)
 *   npx tsx scripts/kws-eval.ts --coordinator       also runs the recogniser over each clip and says what the
 *                                                   wake coordinator (src/core/listen.ts) does from PASSIVE: on the
 *                                                   text alone (LIMITED, 32) and with the spotter (35)
 *
 * The frames are fed in 100 ms chunks, with no speech filter (the clips are clean); the spotter has
 * one thread, as on the server. Nothing is written into models/; the keywords go in as a buffer.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadModel } from '../server/asrModel.ts'
import { WAKE_DECOYS, WAKE_KEYWORDS, WAKE_LABEL, WAKE_SPEC, loadSpotter } from '../server/kws.ts'
import type { SpotterSpec } from '../server/kws.ts'
import { readPcmWav } from './wav.ts'
import { createListen, listenFinal, listenOn } from '../src/core/listen.ts'
import { createWake } from '../src/core/wake.ts'

const RATE = 16000
const CHUNK = 1600
const root = fileURLToPath(new URL('..', import.meta.url))
const setDir = join(root, 'artifacts', 'kws-set')

/** Round 1 of the sweep: the lower-case token only (the model is cased: it missed every "Ütle" at a sentence start). */
const lower: SpotterSpec = { ...WAKE_SPEC, keywords: [{ tokens: '▁ütle', label: WAKE_LABEL }] }
const lowerDecoy: SpotterSpec = { ...WAKE_SPEC, keywords: [{ tokens: '▁ütle', label: WAKE_LABEL }, ...WAKE_DECOYS.filter((k) => !k.tokens.startsWith('▁Ü'))] }
/** Round 2: both spellings. */
const cased: SpotterSpec = { ...WAKE_SPEC, keywords: [...WAKE_KEYWORDS] }
const decoy: SpotterSpec = { ...WAKE_SPEC, keywords: [...WAKE_KEYWORDS, ...WAKE_DECOYS] }
const SPECS: Record<string, SpotterSpec> = {
  server: WAKE_SPEC,
  bare1: { ...lower, numTrailingBlanks: 1 },
  bare3: { ...lower, numTrailingBlanks: 3 },
  decoy1: { ...lowerDecoy, numTrailingBlanks: 1 },
  decoy3: { ...lowerDecoy, numTrailingBlanks: 3 },
  cased1: { ...cased, numTrailingBlanks: 1 },
  cased3: { ...cased, numTrailingBlanks: 3 },
  'cdecoy1': { ...decoy, numTrailingBlanks: 1 },
  'cdecoy2': { ...decoy, numTrailingBlanks: 2 },
  'cdecoy3': { ...decoy, numTrailingBlanks: 3 },
  'cdecoy5': { ...decoy, numTrailingBlanks: 5 },
  'cdecoy1-t10': { ...decoy, numTrailingBlanks: 1, keywordsThreshold: 0.1 },
  'cdecoy2-t10': { ...decoy, numTrailingBlanks: 2, keywordsThreshold: 0.1 },
  'cdecoy1-s2': { ...decoy, numTrailingBlanks: 1, keywordsScore: 2 },
  'cdecoy1-s3-t10': { ...decoy, numTrailingBlanks: 1, keywordsScore: 3, keywordsThreshold: 0.1 },
  'cdecoy1-p8': { ...decoy, numTrailingBlanks: 1, maxActivePaths: 8 },
  'cdecoy2-t15': { ...decoy, numTrailingBlanks: 2, keywordsThreshold: 0.15 },
  'cdecoy2-p8': { ...decoy, numTrailingBlanks: 2, maxActivePaths: 8 },
}

interface Clip {
  file: string
  label: string
  where: string
  voice: string
  text: string
}

function clips(): Clip[] {
  const labels = join(setDir, 'labels.tsv')
  if (!existsSync(labels)) throw new Error('artifacts/kws-set/labels.tsv is missing: run npx tsx scripts/kws-set.ts --eval first')
  const [, ...rows] = readFileSync(labels, 'utf8').trim().split('\n')
  return rows.map((row) => {
    const [file = '', label = '', where = '', voice = '', , text = ''] = row.split('\t')
    return { file, label, where, voice, text }
  })
}

/** The end of speech: the last 10 ms window above the floor. */
function speechEnd(samples: Float32Array): number {
  const win = 160
  for (let end = samples.length; end >= win; end -= win) {
    let sum = 0
    for (let i = end - win; i < end; i += 1) sum += (samples[i] ?? 0) ** 2
    if (Math.sqrt(sum / win) > 0.01) return end / RATE
  }
  return 0
}

interface Hit {
  label: string
  at: number
  /** The result's own times: the stream's start_time and the keyword's first token (s). */
  raw: string
}

interface SpotterRun {
  spotter: { createStream(): unknown; isReady(s: unknown): boolean; decode(s: unknown): void; getResult(s: unknown): { keyword: string; start_time?: number; timestamps?: number[] }; reset(s: unknown): void }
}

/** Floor between clips in the one continuous stream: longer than the spotter's slowest hit after a word (about 0.9 s). */
const GAP_S = 1.5

/**
 * Every clip through ONE stream, as the server feeds one connection: clip, GAP_S of floor, the next.
 * A hit belongs to the clip it falls in or to the gap after it.
 */
function spotAll(run: SpotterRun, samples: readonly Float32Array[]): Hit[][] {
  const stream = run.spotter.createStream() as { acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void }
  const hits: Hit[][] = samples.map(() => [])
  const gap = new Float32Array(Math.round(GAP_S * RATE))
  let fed = 0
  const feed = (index: number, audio: Float32Array): void => {
    for (let at = 0; at < audio.length; at += CHUNK) {
      const chunk = audio.slice(at, Math.min(audio.length, at + CHUNK))
      stream.acceptWaveform({ samples: chunk, sampleRate: RATE })
      fed += chunk.length
      while (run.spotter.isReady(stream)) {
        run.spotter.decode(stream)
        const result = run.spotter.getResult(stream)
        if (result.keyword !== '') {
          hits[index]?.push({ label: result.keyword, at: (at + chunk.length) / RATE, raw: JSON.stringify({ ...result, fedS: fed / RATE }) })
          run.spotter.reset(stream)
        }
      }
    }
  }
  for (const [index, audio] of samples.entries()) {
    feed(index, audio)
    // The gap's hits are the clip's: their time counts on from the clip's end.
    const before = hits[index]?.length ?? 0
    feed(index, gap)
    for (const hit of hits[index]?.slice(before) ?? []) hit.at += audio.length / RATE
  }
  return hits
}

const pct = (n: number, d: number): string => (d === 0 ? '-' : `${Math.round((100 * n) / d)}%`)
const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN
}

/** What the coordinator did from PASSIVE for one clip: woke (and what ran), on the text alone and with the spotter. */
interface Decided {
  limited: boolean
  spotted: boolean
  ran: string
}

/** The clip's finals through src/core/listen.ts from PASSIVE: once without the spotter (LIMITED), once with what it heard. */
function decide(finals: readonly string[], spotted: boolean): Decided {
  const word = createWake('Ütle')
  const run = (heard: boolean | undefined): { woke: boolean; ran: string[] } => {
    let state = listenOn(createListen(), 0)
    let woke = false
    const ran: string[] = []
    for (const [i, final] of finals.entries()) {
      const r = listenFinal(state, word, final, 1000 * (i + 1), heard === undefined ? undefined : { spotted: heard })
      state = r.state
      if (r.event === 'woke') woke = true
      if (r.utterance !== null) ran.push(r.utterance)
    }
    return { woke, ran }
  }
  const withSpotter = run(spotted)
  return { limited: run(undefined).woke, spotted: withSpotter.woke, ran: withSpotter.ran.join(' | ') }
}

function evaluate(name: string, spec: SpotterSpec, all: Clip[], perClip: boolean, finals: readonly string[][] | null, coordinatorLines: string[]): string[] {
  const rssBefore = process.memoryUsage().rss
  const loaded = loadSpotter(root, spec)
  if (!loaded.ok) throw new Error(`spotter ${name}: ${loaded.reason}`)
  const rssLoaded = process.memoryUsage().rss
  const run: SpotterRun = { spotter: loaded.spotter as SpotterRun['spotter'] }
  const cpu = process.cpuUsage()
  const wall = performance.now()
  const audios = all.map((clip) => readPcmWav(join(setDir, clip.file)).samples)
  const audio = audios.reduce((sum, a) => sum + a.length / RATE + GAP_S, 0)
  const found = spotAll(run, audios)
  const rows = all.map((clip, i) => {
    const samples = audios[i] ?? new Float32Array(0)
    const hits = found[i] ?? []
    if (perClip) console.log(`${name}\t${clip.file}\t${hits.map((h) => `${h.label}@${h.at.toFixed(1)}`).join(' ') || '-'}\t${hits[0]?.raw ?? ''}\t${clip.text}`)
    return { clip, hits, end: speechEnd(samples), seconds: samples.length / RATE }
  })
  const used = process.cpuUsage(cpu)
  const wallS = (performance.now() - wall) / 1000
  const rssAfter = process.memoryUsage().rss
  const woke = (r: { hits: Hit[] }): boolean => r.hits.some((h) => h.label === WAKE_LABEL)
  const sentence = rows.filter((r) => !r.clip.file.startsWith('paragraph-'))
  const paragraph = rows.filter((r) => r.clip.file.startsWith('paragraph-'))
  const set = (label: string, where?: string): string => {
    const these = sentence.filter((r) => r.clip.label === label && (where === undefined || r.clip.where === where))
    const n = these.filter(woke).length
    return `${n}/${these.length} (${pct(n, these.length)})`
  }
  const relForms = [...new Set(sentence.filter((r) => r.clip.label === 'relative').map((r) => r.clip.file.split('-')[1] ?? ''))]
  const relDetail = relForms.map((form) => {
    const these = sentence.filter((r) => r.clip.file.startsWith(`rel-${form}-`))
    return `${form} ${these.filter(woke).length}/${these.length}`
  })
  const paraHits = paragraph.reduce((sum, r) => sum + r.hits.filter((h) => h.label === WAKE_LABEL).length, 0)
  const paraHours = paragraph.reduce((sum, r) => sum + r.seconds, 0) / 3600
  const latencies = sentence.filter((r) => r.clip.file.startsWith('wake-bare-')).flatMap((r) => r.hits.filter((h) => h.label === WAKE_LABEL).slice(0, 1).map((h) => (h.at - r.end) * 1000))
  const decoys = rows.reduce((sum, r) => sum + r.hits.filter((h) => h.label !== WAKE_LABEL).length, 0)
  const cpuPct = ((used.user + used.system) / 1e6 / audio) * 100
  if (finals !== null) {
    const decided = rows.map((r, i) => decide(finals[i] ?? [], woke(r)))
    const count = (label: string, pick: (d: Decided) => boolean): string => {
      const these = rows.map((r, i) => ({ r, d: decided[i] })).filter(({ r }) => r.clip.label === label && !r.clip.file.startsWith('paragraph-'))
      const n = these.filter(({ d }) => d !== undefined && pick(d)).length
      return `${n}/${these.length}`
    }
    const paraWoke = (pick: (d: Decided) => boolean): number => rows.filter((r, i) => r.clip.file.startsWith('paragraph-') && decided[i] !== undefined && pick(decided[i] as Decided)).length
    for (const label of ['wake', 'relative', 'literal', 'other', 'room']) {
      coordinatorLines.push(`| ${name} | ${label} | ${set(label)} | ${count(label, (d) => d.limited)} | ${count(label, (d) => d.spotted)} |`)
    }
    coordinatorLines.push(`| ${name} | paragraph (${(paraHours * 60).toFixed(1)} min) | ${paraHits} hits | ${paraWoke((d) => d.limited)} clips woke | ${paraWoke((d) => d.spotted)} clips woke |`)
    if (perClip) rows.forEach((r, i) => console.log(`coordinator\t${name}\t${r.clip.file}\tlimited ${decided[i]?.limited ? 'WOKE' : '-'}\tspotter ${decided[i]?.spotted ? 'WOKE' : '-'}\tran: ${decided[i]?.ran ?? ''}\tfinals: ${(finals[i] ?? []).join(' | ')}`))
  }
  return [
    `| ${name} | ${spec.numTrailingBlanks} | ${spec.keywordsThreshold} | ${spec.keywordsScore} | ${spec.keywords.filter((k) => k.label !== WAKE_LABEL).length} | ${set('wake')} | ${set('wake', 'start')} | ${set('wake', 'middle')} | ${set('wake', 'end')} | ${set('relative')} | ${relDetail.join(', ')} | ${set('literal')} | ${set('other')} | ${set('room')} | ${paraHits} in ${(paraHours * 60).toFixed(1)} min | ${decoys} | ${latencies.length === 0 ? '-' : `${Math.round(quantile(latencies, 0.5))} / ${Math.round(quantile(latencies, 0.95))}`} | ${cpuPct.toFixed(1)}% (RTF ${(wallS / audio).toFixed(3)}) | ${Math.round((rssLoaded - rssBefore) / 2 ** 20)} / ${Math.round((rssAfter - rssBefore) / 2 ** 20)} |`,
  ]
}

const HEADER = [
  '| spec | trailing blanks | threshold | score | decoys | wake (all) | start | middle | end | relatives fired | per form | literal fired | other fired | room fired | paragraph wakes | decoy hits | bare word: speech end to wake, ms p50 / p95 | CPU of one core (RTF) | RSS MB load / after |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
]

/**
 * The recogniser (server/asrModel.ts's config, hotwords included) over each clip on its own, with
 * the floor after it: the finals as the server would send them, and their tokens.
 */
function recognise(all: readonly Clip[]): Array<{ finals: string[]; tokens: string[] }> {
  const loaded = loadModel(root)
  if (!loaded.ok) throw new Error(`recogniser: ${loaded.reason}`)
  const recognizer = loaded.recognizer as unknown as { createStream(): { acceptWaveform(i: { samples: Float32Array; sampleRate: number }): void }; isReady(s: unknown): boolean; decode(s: unknown): void; getResult(s: unknown): { text: string; tokens?: string[] }; isEndpoint(s: unknown): boolean; reset(s: unknown): void }
  const gap = new Float32Array(Math.round(GAP_S * RATE))
  return all.map((clip) => {
    const { samples } = readPcmWav(join(setDir, clip.file))
    const audio = new Float32Array(samples.length + gap.length)
    audio.set(samples)
    const stream = recognizer.createStream()
    const finals: string[] = []
    const tokens: string[] = []
    const take = (): void => {
      const r = recognizer.getResult(stream)
      if (/[\p{L}\p{N}]/u.test(r.text)) {
        finals.push(r.text.trim())
        tokens.push((r.tokens ?? []).join(' '))
      }
      recognizer.reset(stream)
    }
    for (let at = 0; at < audio.length; at += CHUNK) {
      stream.acceptWaveform({ samples: audio.slice(at, at + CHUNK), sampleRate: RATE })
      while (recognizer.isReady(stream)) recognizer.decode(stream)
      if (recognizer.isEndpoint(stream)) take()
    }
    take()
    return { finals, tokens }
  })
}

/** The recogniser's tokens for every clip but the room ones: how the model spells each form. */
function tokens(all: Clip[]): void {
  const some = all.filter((c) => c.label !== 'room')
  recognise(some).forEach((r, i) => console.log(`${some[i]?.file ?? ''}\t${r.tokens.join(' | ')}`))
}

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag)
  return i < 0 ? undefined : process.argv[i + 1]
}
const all = clips()
if (process.argv.includes('--tokens')) tokens(all)
else {
  const names = process.argv.includes('--sweep') ? Object.keys(SPECS) : (arg('--spec') ?? 'server').split(',')
  console.log(`SYNTHETIC: ${all.length} clips of TartuNLP voices (artifacts/kws-set), ${new Set(all.map((c) => c.voice)).size} voices; not one real voice.`)
  const lines = [...HEADER]
  console.log(`One stream per spec: every clip, then ${GAP_S} s of silence, in 100 ms frames; the spotter on one thread.`)
  const finals = process.argv.includes('--coordinator') ? recognise(all).map((r) => r.finals) : null
  const coordinator = ['| spec | set | spotter fired | woke on the text alone (LIMITED, 32) | woke with the spotter (35) |', '|---|---|---|---|---|']
  for (const name of names) {
    const spec = SPECS[name]
    if (spec === undefined) throw new Error(`no spec ${name}: ${Object.keys(SPECS).join(', ')}`)
    lines.push(...evaluate(name, spec, all, process.argv.includes('--clips'), finals, coordinator))
  }
  console.log(lines.join('\n'))
  if (finals !== null) console.log(`\nThe coordinator from PASSIVE (clips that woke):\n${coordinator.join('\n')}`)
}
