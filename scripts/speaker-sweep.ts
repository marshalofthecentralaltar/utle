/**
 * Round 10, lane MEASURE (issue #4, for #3): the model sweep of scripts/speaker-calibrate.ts, run
 * when it is given --labels or --models. For each speaker model and each length bucket: EER, the
 * best threshold, FAR and FRR at the gate's OWNER_THRESHOLD and at the best threshold, the number of
 * owner and other trials, and Wilson 95 % intervals.
 *
 * Trials, as the calibration has always made them: every clip is embedded the way the gate embeds it
 * (embeddedSamples: its frames at or above SILENCE_RMS, then normalised). An owner trial is one owner
 * clip against the mean of the OTHER owner clips (leave one out); an other trial is one other clip
 * against the mean of all owner clips. The bucket is the trial clip's length (labels' duration_s);
 * the profile is always made of every other owner clip, whatever their length.
 *
 * OWNER_THRESHOLD (0.54) was set on TitaNet-small; on the other models it is on another scale and its
 * FAR/FRR are shown only for comparison.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ASR_FRAME_SAMPLES } from '../src/speech/asrProtocol.ts'
import { OWNER_THRESHOLD, SPEAKER_MODEL_FILE, cosine, embeddedSamples, meanEmbedding, normalised } from '../server/speaker.ts'
import { loadSpeakerModel } from '../server/speakerModel.ts'
import { BUCKETS, bucketOf, eer, insideRepo, parseLabels, ratesAt } from './measure.ts'
import type { Bucket, Rates } from './measure.ts'
import { sweepModels } from './speaker-models.ts'
import { readAnyWav } from './wav.ts'

interface SweepClip {
  path: string
  file: string
  label: 'owner' | 'other'
  speaker: string
  seconds: number
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const framesOf = (samples: Float32Array): Float32Array[] => {
  const frames: Float32Array[] = []
  for (let at = 0; at < samples.length; at += ASR_FRAME_SAMPLES) frames.push(samples.slice(at, at + ASR_FRAME_SAMPLES))
  return frames
}
const pct = (x: number): string => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '-')
const ci = (c: { low: number; high: number }): string => `[${(c.low * 100).toFixed(0)}-${(c.high * 100).toFixed(0)}]`

/** The clips: from --labels (owner = --owner-speaker), or owner-/other- prefixes in a folder, or --owner/--other folders. */
function clipsFrom(opts: { labels?: string; ownerSpeaker?: string; dir?: string; ownerDir?: string; otherDir?: string }): { clips: SweepClip[]; source: string; skipped: number } {
  const clips: SweepClip[] = []
  let skipped = 0
  if (opts.labels !== undefined) {
    if (opts.ownerSpeaker === undefined) throw new Error('--labels needs --owner-speaker <name>: whose voice is the owner')
    const file = resolve(opts.labels)
    for (const row of parseLabels(readFileSync(file, 'utf8'))) {
      if (row.speaker === '' || row.kind === 'crosstalk') {
        skipped += 1
        continue
      }
      clips.push({ path: isAbsolute(row.file) ? row.file : join(dirname(file), row.file), file: row.file, label: row.speaker === opts.ownerSpeaker ? 'owner' : 'other', speaker: row.speaker, seconds: row.durationS })
    }
    return { clips, source: file, skipped }
  }
  const wavsIn = (d: string): string[] =>
    (readdirSyncSafe(d) ?? []).filter((f) => f.toLowerCase().endsWith('.wav')).sort()
  const add = (d: string, f: string, label: 'owner' | 'other', name: string): void => {
    const path = join(d, f)
    const wav = readAnyWav(path)
    clips.push({ path, file: name, label, speaker: label, seconds: wav.samples.length / wav.rate })
  }
  if (opts.ownerDir !== undefined && opts.otherDir !== undefined) {
    for (const f of wavsIn(opts.ownerDir)) add(opts.ownerDir, f, 'owner', `owner/${f}`)
    for (const f of wavsIn(opts.otherDir)) add(opts.otherDir, f, 'other', `other/${f}`)
    return { clips, source: resolve(opts.ownerDir), skipped }
  }
  const dir = opts.dir ?? ''
  for (const f of wavsIn(dir)) {
    if (f.startsWith('owner-')) add(dir, f, 'owner', f)
    else if (f.startsWith('other-')) add(dir, f, 'other', f)
  }
  return { clips, source: resolve(dir), skipped }
}

function readdirSyncSafe(d: string): string[] | null {
  try {
    return readdirSync(d)
  } catch {
    return null
  }
}

export interface SweepRow {
  model: string
  file: string
  bucket: Bucket | 'all'
  nOwner: number
  nOther: number
  eer: number
  bestThreshold: number
  atCurrent: Rates
  atBest: Rates
}

export async function runSweep(argv: string[]): Promise<void> {
  const value = (name: string): string | undefined => {
    const at = argv.indexOf(name)
    return at === -1 ? undefined : argv[at + 1]
  }
  const positional = argv.filter((a, i) => !a.startsWith('--') && (i === 0 || !(argv[i - 1] ?? '').startsWith('--')))
  const { clips, source, skipped } = clipsFrom({ labels: value('--labels'), ownerSpeaker: value('--owner-speaker'), dir: positional[0], ownerDir: value('--owner'), otherDir: value('--other') })
  const nOwnerClips = clips.filter((c) => c.label === 'owner').length
  if (nOwnerClips < 2 || !clips.some((c) => c.label === 'other')) throw new Error('need at least two owner clips (leave one out) and one other clip')
  const models = sweepModels(value('--models') ?? SPEAKER_MODEL_FILE)
  const synthetic = clips.some((c) => insideRepo(c.path, join(repoRoot, 'scripts', 'fixtures')))
  const banner = synthetic ? 'SYNTHETIC: TartuNLP text-to-speech voices from scripts/fixtures, not people. No model or threshold is picked from this.' : 'REAL recordings'

  const loaded = clips.map((c) => {
    const wav = readAnyWav(c.path)
    if (wav.rate !== 16000) throw new Error(`${c.file}: ${wav.rate} Hz, expected 16000`)
    return { ...c, samples: wav.samples }
  })

  const rows: SweepRow[] = []
  const perClip: Array<{ model: string; file: string; speaker: string; label: string; seconds: number; score: number }> = []
  for (const m of models) {
    const model = loadSpeakerModel(repoRoot, m.file)
    if (!model.ok) throw new Error(`${m.file}: ${model.reason} (npx tsx scripts/speaker-models.ts)`)
    const embedded = loaded.map((c) => ({ ...c, embedding: normalised(model.extractor.embed(embeddedSamples(framesOf(c.samples)))) }))
    const owners = embedded.filter((c) => c.label === 'owner')
    const all = meanEmbedding(owners.map((o) => o.embedding))
    const scored = embedded.map((c) => {
      const against = c.label === 'owner' ? meanEmbedding(owners.filter((o) => o !== c).map((o) => o.embedding)) : all
      return { file: c.file, speaker: c.speaker, label: c.label, seconds: c.seconds, score: Math.round(cosine(c.embedding, against) * 1000) / 1000 }
    })
    for (const s of scored) perClip.push({ model: m.name, ...s })
    for (const bucket of ['all', ...BUCKETS] as const) {
      const inBucket = scored.filter((s) => bucket === 'all' || bucketOf(s.seconds) === bucket)
      const owner = inBucket.filter((s) => s.label === 'owner').map((s) => s.score)
      const other = inBucket.filter((s) => s.label === 'other').map((s) => s.score)
      const e = eer(owner, other)
      rows.push({ model: m.name, file: m.file, bucket, nOwner: owner.length, nOther: other.length, eer: e.eer, bestThreshold: e.bestThreshold, atCurrent: ratesAt(owner, other, OWNER_THRESHOLD), atBest: ratesAt(owner, other, e.bestThreshold) })
    }
  }

  console.log(banner)
  console.log(`${source}: ${nOwnerClips} owner clips, ${clips.length - nOwnerClips} other clips${skipped > 0 ? `, ${skipped} skipped (no speaker or crosstalk)` : ''}; owner trials leave one out`)
  console.log(`FAR = others accepted / other trials, FRR = owner rejected / owner trials, [Wilson 95 % CI in %]; current = OWNER_THRESHOLD ${OWNER_THRESHOLD} (TitaNet's scale)\n`)
  console.log(`${'model'.padEnd(14)}${'bucket'.padEnd(8)}${'n own'.padStart(6)}${'n oth'.padStart(6)}${'EER'.padStart(8)}${'best t'.padStart(8)}   ${'FAR@0.54'.padEnd(16)}${'FRR@0.54'.padEnd(16)}${'FAR@best'.padEnd(16)}FRR@best`)
  for (const r of rows) {
    const cell = (x: number, c: { low: number; high: number }): string => `${pct(x)} ${ci(c)}`.padEnd(16)
    const empty = r.nOwner === 0 || r.nOther === 0
    console.log(
      `${r.model.padEnd(14)}${r.bucket.padEnd(8)}${String(r.nOwner).padStart(6)}${String(r.nOther).padStart(6)}${pct(r.eer).padStart(8)}${(empty ? '-' : r.bestThreshold.toFixed(3)).padStart(8)}   ${cell(r.atCurrent.far, r.atCurrent.farCi)}${cell(r.atCurrent.frr, r.atCurrent.frrCi)}${empty ? '-'.padEnd(16) : cell(r.atBest.far, r.atBest.farCi)}${empty ? '-' : cell(r.atBest.frr, r.atBest.frrCi)}`,
    )
  }
  const jsonPath = value('--json') ?? (insideRepo(source, repoRoot) ? join(repoRoot, 'artifacts', 'speaker-sweep.json') : join(dirname(source), 'speaker-sweep.json'))
  mkdirSync(dirname(jsonPath), { recursive: true })
  writeFileSync(jsonPath, `${JSON.stringify({ synthetic, banner, source, currentThreshold: OWNER_THRESHOLD, rows, scores: perClip }, null, 2)}\n`)
  console.log(`\nwrote ${jsonPath}`)
}
