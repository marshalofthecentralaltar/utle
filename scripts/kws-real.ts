/**
 * Round 10 (#2, ARCHITECTURE 35.6): the wake word on REAL human voices from public corpora, beside
 * the SYNTHETIC set of scripts/kws-set.ts. The corpora are fetched into a cache outside the
 * repository (never committed), each file's checksum printed and checked; the transcripts are
 * searched for every form of the verb (scripts/kws-forms.ts) and each clip labelled.
 *
 *   npx tsx scripts/kws-real.ts --fetch <cache>     (network, once) FLEURS et_ee dev, test, train (CC BY 4.0) and
 *                                                    VoxPopuli et validation, test (CC0); writes <cache>/labels.tsv
 *   npx tsx scripts/kws-real.ts --labels <cache>    the label table again, no network
 *   npx tsx scripts/kws-real.ts --eval <cache> --set fleurs-dev[,voxpopuli-test,...] [--part 1/2]
 *                                                    each set through the server's own decoder: one continuous
 *                                                    stream as one connection feeds it; writes artifacts/kws-real/
 *   npx tsx scripts/kws-real.ts --report            the tables from every artifacts/kws-real/*.json (a stopped run is saved every
 *                                                    CHECKPOINT clips; the same --eval command resumes it)
 *
 * The eval runs the server's path, not a copy of it: createAsrSession over decoderInThread with the
 * recogniser (server/asrModel.ts, hotwords included), the speech detector (server/vad.ts) and the
 * keyword spotter (server/kws.ts WAKE_SPEC), in command endpointing (wake mode, PASSIVE, no box),
 * every clip in 100 ms frames, then GAP_S of silence, decoded as fast as it goes (nothing dropped).
 * The coordinator is src/core/listen.ts from PASSIVE, as the client (src/speech/local.ts) feeds it:
 * a final is heard when it carries the segment of the newest wake. Each final is judged from PASSIVE
 * on its own (an upper bound: in ACTIVE a second wake is no wake); the assembler's joining of finals
 * is not modelled.
 */
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadModel } from '../server/asrModel.ts'
import { createAsrSession, decoderInThread } from '../server/asrSession.ts'
import { WAKE_LABEL, WAKE_SPEC, loadSpotter } from '../server/kws.ts'
import type { KeywordSpotterLike, SpotterStreamLike } from '../server/kws.ts'
import { loadVad } from '../server/vad.ts'
import type { AsrServerMessage } from '../src/speech/asrProtocol.ts'
import { createListen, listenFinal, listenOn } from '../src/core/listen.ts'
import { createWake } from '../src/core/wake.ts'
import { REAL_LABELS, formsOf, labelOf, poissonUpper } from './kws-forms.ts'
import type { RealLabel } from './kws-forms.ts'
import { readAnyWav, resample } from './wav.ts'

const RATE = 16000
const FRAME = 1600
const GAP_S = 1.5
const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = join(root, 'artifacts', 'kws-real')

// ---------- the sources (pinned revisions; the sizes and hashes are Hugging Face's own) ----------

const FLEURS_REV = '70bb2e84b976b7e960aa89f1c648e09c59f894dd'
const FLEURS = `https://huggingface.co/datasets/google/fleurs/resolve/${FLEURS_REV}`
const VOXPOPULI_REV = '42f01879c780b4a2e90ec0b4f616c2ece526e4f1'
const VOXPOPULI_README = `https://huggingface.co/datasets/facebook/voxpopuli/resolve/${VOXPOPULI_REV}/README.md`
/** The datasets-server serves these two splits' rows with their audio; the train split's rows are too large for it (HTTP 500). */
const VOXPOPULI_SPLITS = [
  { split: 'validation', rows: 50 },
  { split: 'test', rows: 51 },
] as const

interface Remote {
  url: string
  file: string
  bytes: number
  /** LFS files: the sha256 Hugging Face lists. */
  sha256?: string
  /** Plain files: the git blob id (sha1 of "blob <n>\0" + bytes). */
  blob?: string
}

const FLEURS_SPLITS = ['dev', 'test', 'train'] as const
type FleursSplit = (typeof FLEURS_SPLITS)[number]
const FLEURS_FILES: readonly Remote[] = [
  { url: `${FLEURS}/README.md`, file: 'fleurs-et/README.md', bytes: 385614, blob: 'dcc0872174e54ad416dee938651d777378d4ba4f' },
  { url: `${FLEURS}/data/et_ee/dev.tsv`, file: 'fleurs-et/dev.tsv', bytes: 206579, blob: '1e9bb0d1d73ecceb5c50951560c8567817c09a40' },
  { url: `${FLEURS}/data/et_ee/test.tsv`, file: 'fleurs-et/test.tsv', bytes: 498848, blob: 'f13c5a0cbb997abfa2592c103c5a211f766ae342' },
  { url: `${FLEURS}/data/et_ee/train.tsv`, file: 'fleurs-et/train.tsv', bytes: 1338877, blob: 'f1744beecc7e3b983638aabadff2ad7a9fb68bbb' },
  { url: `${FLEURS}/data/et_ee/audio/dev.tar.gz`, file: 'fleurs-et/dev.tar.gz', bytes: 209848270, sha256: 'ad7c8a257cea5cd6b86df76bae30998b88b48fa9d5e88d8439af55c33424d3e7' },
  { url: `${FLEURS}/data/et_ee/audio/test.tar.gz`, file: 'fleurs-et/test.tar.gz', bytes: 506753754, sha256: 'cdece29c50357790dc87f034242d54066fcacbc694cd057e75a29f2f56c14cbf' },
  { url: `${FLEURS}/data/et_ee/audio/train.tar.gz`, file: 'fleurs-et/train.tar.gz', bytes: 1290465249, sha256: '0a9e8fa13cde853c17fd41cdb36d6bb2f7347ad0026a02e61d45e17e163fc34b' },
]

// ---------- fetching ----------

const sha256Of = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const blobOf = (bytes: Buffer): string => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')

/** Streams url into path (through path.part), hashing as it goes. */
async function download(url: string, path: string): Promise<{ sha256: string; bytes: number }> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || response.body === null) throw new Error(`${url}: HTTP ${response.status}`)
  const hash = createHash('sha256')
  const part = `${path}.part`
  const out = createWriteStream(part)
  const reader = response.body.getReader()
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    hash.update(value)
    bytes += value.length
    if (!out.write(value)) await new Promise<void>((go) => out.once('drain', () => go()))
  }
  await new Promise<void>((go, fail) => out.end((error?: Error | null) => (error ? fail(error) : go())))
  renameSync(part, path)
  return { sha256: hash.digest('hex'), bytes }
}

/** Downloads a pinned file unless it is there already; checks its size and hash either way. */
async function fetchPinned(cache: string, remote: Remote): Promise<string> {
  const path = join(cache, remote.file)
  if (!existsSync(path) || statSync(path).size !== remote.bytes) await download(remote.url, path)
  const bytes = readFileSync(path)
  const sum = remote.sha256 !== undefined ? sha256Of(bytes) : blobOf(bytes)
  const want = remote.sha256 ?? remote.blob
  const ok = bytes.length === remote.bytes && sum === want
  console.log(`${ok ? 'OK ' : 'BAD'}  ${remote.file}  ${bytes.length} bytes  ${remote.sha256 !== undefined ? 'sha256' : 'git blob'} ${sum}`)
  if (!ok) throw new Error(`${remote.file}: expected ${remote.bytes} bytes, ${want}`)
  return path
}

interface VoxRow {
  audio_id: string
  raw_text: string
  normalized_text: string
  gender: string
  speaker_id: string
  audio: Array<{ src: string }>
}

/** A file name from a VoxPopuli audio id ("20151007-0900-PLENARY-4-et_20151007-09:47:59_0"). */
const voxFile = (id: string): string => `${id.replace(/[^\w.-]/g, '_')}.wav`

async function fetchVoxPopuli(cache: string): Promise<void> {
  const dir = join(cache, 'voxpopuli-et')
  mkdirSync(dir, { recursive: true })
  const readme = join(dir, 'README.md')
  if (!existsSync(readme)) await download(VOXPOPULI_README, readme)
  console.log(`OK   voxpopuli-et/README.md  sha256 ${sha256Of(readFileSync(readme))} (revision ${VOXPOPULI_REV})`)
  const manifest: string[] = []
  for (const { split, rows } of VOXPOPULI_SPLITS) {
    const rowsFile = join(dir, `rows-${split}.json`)
    if (!existsSync(rowsFile)) {
      const response = await fetch(`https://datasets-server.huggingface.co/rows?dataset=facebook/voxpopuli&config=et&split=${split}&offset=0&length=${rows}`)
      if (!response.ok) throw new Error(`VoxPopuli ${split} rows: HTTP ${response.status}`)
      const page = (await response.json()) as { rows: Array<{ row: VoxRow }> }
      writeFileSync(rowsFile, JSON.stringify(page.rows.map((r) => r.row)))
    }
    const list = JSON.parse(readFileSync(rowsFile, 'utf8')) as VoxRow[]
    if (list.length !== rows) throw new Error(`VoxPopuli ${split}: ${list.length} rows, expected ${rows}`)
    mkdirSync(join(dir, split), { recursive: true })
    for (const row of list) {
      const path = join(dir, split, voxFile(row.audio_id))
      const src = row.audio[0]?.src
      if (!existsSync(path)) {
        if (src === undefined) throw new Error(`VoxPopuli ${row.audio_id}: no audio`)
        await download(src, path)
      }
      manifest.push(`${sha256Of(readFileSync(path))}  voxpopuli-et/${split}/${voxFile(row.audio_id)}`)
    }
  }
  const text = `${manifest.join('\n')}\n`
  writeFileSync(join(dir, 'SHA256SUMS'), text)
  console.log(`OK   voxpopuli-et: ${manifest.length} wav files (the datasets-server publishes no checksum; sha256 of each in voxpopuli-et/SHA256SUMS, whose own sha256 is ${sha256Of(Buffer.from(text))})`)
}

function extractFleurs(cache: string, split: FleursSplit): void {
  const dir = join(cache, 'fleurs-et')
  if (existsSync(join(dir, split)) && readdirSync(join(dir, split)).length > 0) return
  // A relative name and cwd: GNU tar under Git Bash would read "C:" in a path as a remote host.
  const done = spawnSync('tar', ['-xzf', `${split}.tar.gz`], { cwd: dir, stdio: 'inherit' })
  if (done.status !== 0) throw new Error(`tar ${split}.tar.gz: exit ${done.status}`)
}

// ---------- the labels ----------

interface Row {
  set: string
  /** Relative to the cache. */
  path: string
  speaker: string
  gender: string
  seconds: number
  label: RealLabel
  forms: string
  text: string
}

const LABELS_HEADER = 'set\tpath\tspeaker\tgender\tseconds\tlabel\tforms\ttext'
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

function fleursRows(cache: string, split: FleursSplit): Row[] {
  const dir = join(cache, 'fleurs-et')
  const lines = readFileSync(join(dir, `${split}.tsv`), 'utf8').split('\n').filter((line) => line.trim() !== '')
  return lines.map((line) => {
    const [, file = '', raw = '', , , samples = '0', gender = ''] = line.split('\t')
    return { set: `fleurs-${split}`, path: `fleurs-et/${split}/${file}`, speaker: '', gender: gender.toLowerCase(), seconds: Number(samples) / RATE, label: labelOf(raw), forms: formsOf(raw).join(' '), text: oneLine(raw) }
  })
}

function voxRows(cache: string): Row[] {
  const dir = join(cache, 'voxpopuli-et')
  return VOXPOPULI_SPLITS.flatMap(({ split }) =>
    (JSON.parse(readFileSync(join(dir, `rows-${split}.json`), 'utf8')) as VoxRow[]).map((row) => {
      const text = row.raw_text.trim() !== '' ? row.raw_text : row.normalized_text
      const path = `voxpopuli-et/${split}/${voxFile(row.audio_id)}`
      const wav = readAnyWav(join(cache, path))
      return { set: `voxpopuli-${split}`, path, speaker: row.speaker_id, gender: row.gender.toLowerCase(), seconds: wav.samples.length / wav.rate, label: labelOf(text), forms: formsOf(text).join(' '), text: oneLine(text) }
    }),
  )
}

function readLabels(cache: string): Row[] {
  const file = join(cache, 'labels.tsv')
  if (!existsSync(file)) throw new Error(`${file} is missing: run npx tsx scripts/kws-real.ts --fetch ${cache}`)
  const [, ...lines] = readFileSync(file, 'utf8').trim().split('\n')
  return lines.map((line) => {
    const [set = '', path = '', speaker = '', gender = '', seconds = '0', label = 'none', forms = '', text = ''] = line.split('\t')
    return { set, path, speaker, gender, seconds: Number(seconds), label: label as RealLabel, forms, text }
  })
}

const hours = (rows: readonly Row[]): number => rows.reduce((sum, r) => sum + r.seconds, 0) / 3600

function labelTable(rows: readonly Row[]): void {
  const sets = [...new Set(rows.map((r) => r.set))]
  const lines = [
    '| set | clips | hours | speakers | female / male | ' + REAL_LABELS.join(' | ') + ' |',
    '|---|---|---|---|---|' + REAL_LABELS.map(() => '---|').join(''),
  ]
  for (const set of [...sets, 'all']) {
    const these = rows.filter((r) => set === 'all' || r.set === set)
    const speakers = these.every((r) => r.speaker === '') ? 'not published' : String(new Set(these.filter((r) => r.speaker !== '').map((r) => r.speaker)).size) + (these.some((r) => r.speaker === '') ? ' (VoxPopuli only)' : '')
    const female = these.filter((r) => r.gender === 'female').length
    const male = these.filter((r) => r.gender === 'male').length
    lines.push(`| ${set} | ${these.length} | ${hours(these).toFixed(2)} | ${speakers} | ${female} / ${male} | ${REAL_LABELS.map((label) => {
      const n = these.filter((r) => r.label === label)
      return `${n.length} (${(hours(n) * 60).toFixed(0)} min)`
    }).join(' | ')} |`)
  }
  console.log(lines.join('\n'))
  const forms = new Map<string, number>()
  for (const r of rows) for (const form of r.forms.split(' ').filter((f) => f !== '')) forms.set(form, (forms.get(form) ?? 0) + 1)
  console.log(`\nForms of the verb in the transcripts: ${[...forms].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(', ')}`)
}

// ---------- the eval: the server's decoder over one continuous stream ----------

interface FinalOut {
  text: string
  /** The final carried the segment of the newest wake (src/speech/local.ts matchWake). */
  spotted: boolean
  /** The coordinator from PASSIVE: with the spotter (35, the shipped spec) and on the text alone (32, LIMITED). */
  woke: boolean
  limited: boolean
}

interface ClipOut {
  set: string
  path: string
  label: RealLabel
  seconds: number
  text: string
  /** Wake events on the wire (the spotter heard the wake word; a decoy is never one). */
  wakes: number
  /** The spotter's hits on a decoy (a relative): reset and dropped by the server. */
  decoys: string[]
  finals: FinalOut[]
}

interface SetOut {
  name: string
  spec: string
  audioS: number
  cpuS: number
  wallS: number
  clips: ClipOut[]
  /** Saved at a checkpoint (every CHECKPOINT clips): the same command resumes after its last clip. */
  partial?: boolean
}

/** Clips between checkpoints: a stopped run loses at most this many. */
const CHECKPOINT = 50

/** The spotter with its hits counted (the server never reports a decoy). */
function counted(spotter: KeywordSpotterLike, onHit: (label: string) => void): KeywordSpotterLike {
  return {
    createStream: () => spotter.createStream(),
    isReady: (s: SpotterStreamLike) => spotter.isReady(s),
    decode: (s: SpotterStreamLike) => spotter.decode(s),
    getResult: (s: SpotterStreamLike) => {
      const result = spotter.getResult(s)
      if (result.keyword !== '') onHit(result.keyword)
      return result
    },
    reset: (s: SpotterStreamLike) => spotter.reset(s),
  }
}

/**
 * A resumed run (previous: a checkpoint of the same set and part) starts a new stream at the first clip the
 * checkpoint does not have: one stream boundary more than an uninterrupted run, nothing else differs.
 */
function evaluate(cache: string, name: string, rows: readonly Row[], previous: SetOut | null, save: (result: SetOut) => void): SetOut {
  const model = loadModel(root)
  if (!model.ok) throw new Error(`recogniser: ${model.reason}`)
  const vad = loadVad(root)
  if (!vad.ok) throw new Error(`speech detector: ${vad.reason}`)
  const loaded = loadSpotter(root, WAKE_SPEC)
  if (!loaded.ok) throw new Error(`spotter: ${loaded.reason}`)
  const word = createWake('Ütle')
  const out: ClipOut[] = [...(previous?.clips ?? [])]
  let clip: ClipOut | null = null
  let pendingWake: number | null = null
  let spotterOn = false
  const spotter = counted(loaded.spotter, (label) => {
    if (label !== WAKE_LABEL) clip?.decoys.push(label)
  })
  const decoder = decoderInThread(model.recognizer, null, { vad: vad.create, spotter: () => spotter })
  const steps: Array<() => void> = []
  const fromPassive = (text: string, heard?: { spotted: boolean }): boolean => listenFinal(listenOn(createListen(), 0), word, text, 1000, heard).event === 'woke'
  const session = createAsrSession(decoder, (message: AsrServerMessage) => {
    if (message.type === 'spotter') spotterOn = message.on
    if (message.type === 'wake') {
      pendingWake = message.segment
      if (clip) clip.wakes += 1
    }
    if (message.type === 'final') {
      const spotted = pendingWake !== null && message.segment === pendingWake
      pendingWake = null
      if (clip && /[\p{L}\p{N}]/u.test(message.text)) clip.finals.push({ text: message.text, spotted, woke: fromPassive(message.text, { spotted }), limited: fromPassive(message.text) })
    }
  }, { schedule: (step) => steps.push(step), sessionId: 'kws-real' })
  const run = (): void => {
    for (let step = steps.shift(); step !== undefined; step = steps.shift()) step()
  }
  session.endpointMode('command')
  session.spotter(true)
  run()
  if (!spotterOn) throw new Error('the session did not turn the spotter on')
  const gap = new Float32Array(Math.round(GAP_S * RATE))
  const cpu = process.cpuUsage()
  const wall = performance.now()
  let audioS = 0
  const sofar = (partial: boolean): SetOut => {
    const used = process.cpuUsage(cpu)
    return { name, spec: 'server (WAKE_SPEC)', audioS: (previous?.audioS ?? 0) + audioS, cpuS: (previous?.cpuS ?? 0) + (used.user + used.system) / 1e6, wallS: (previous?.wallS ?? 0) + (performance.now() - wall) / 1000, clips: out, ...(partial ? { partial: true } : {}) }
  }
  if (previous !== null) console.log(`  ${name}: resuming after ${out.length} clips of a checkpoint`)
  for (const [i, row] of rows.entries()) {
    if (i < out.length) continue
    const wav = readAnyWav(join(cache, row.path))
    const samples = wav.rate === RATE ? wav.samples : resample(wav.samples, wav.rate, RATE)
    clip = { set: row.set, path: row.path, label: row.label, seconds: samples.length / RATE, text: row.text, wakes: 0, decoys: [], finals: [] }
    out.push(clip)
    for (const audio of [samples, gap]) {
      for (let at = 0; at < audio.length; at += FRAME) {
        session.audio(audio.slice(at, Math.min(audio.length, at + FRAME)))
        run()
      }
    }
    audioS += samples.length / RATE + GAP_S
    if ((i + 1) % CHECKPOINT === 0) {
      save(sofar(true))
      console.log(`  ${name}: ${i + 1}/${rows.length} clips, ${(audioS / 60).toFixed(0)} min of audio this run, RTF ${((performance.now() - wall) / 1000 / audioS).toFixed(3)}`)
    }
  }
  session.flush()
  run()
  session.close()
  return sofar(false)
}

// ---------- the report ----------

const rate = (n: number, h: number): string => (h === 0 ? '-' : (n / h).toFixed(2))

function report(sets: readonly SetOut[]): void {
  const clips = sets.flatMap((s) => s.clips)
  const audio = sets.reduce((sum, s) => sum + s.audioS, 0)
  const cpu = sets.reduce((sum, s) => sum + s.cpuS, 0)
  const partial = sets.filter((s) => s.partial === true).map((s) => `${s.name} (${s.clips.length} clips)`)
  if (partial.length > 0) console.log(`PARTIAL: these sets stopped at a checkpoint and are counted as far as they got: ${partial.join(', ')}`)
  console.log(`REAL: ${clips.length} clips of real human Estonian voices (${sets.map((s) => s.name).join(', ')}); spec ${sets[0]?.spec ?? '-'}; ${(audio / 3600).toFixed(2)} h fed (gaps included), CPU ${(100 * cpu / audio).toFixed(1)} % of one core for the recogniser, speech detector and spotter together.`)
  const groups = [...new Set(clips.map((c) => c.set.split('-')[0] ?? ''))]
  const negLines = [
    '| corpus | hours without any form | clips | spotter hits (wake events on the wire) | per hour (95 % upper) | coordinator wakes (spotter AND text, 35) | per hour (95 % upper) | text alone (LIMITED, 32) | per hour | decoy hits |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const group of [...groups, 'all']) {
    const none = clips.filter((c) => c.label === 'none' && (group === 'all' || c.set.startsWith(`${group}-`)))
    const h = none.reduce((sum, c) => sum + c.seconds, 0) / 3600
    const hits = none.reduce((sum, c) => sum + c.wakes, 0)
    const woke = none.reduce((sum, c) => sum + c.finals.filter((f) => f.woke).length, 0)
    const limited = none.reduce((sum, c) => sum + c.finals.filter((f) => f.limited).length, 0)
    const decoys = none.reduce((sum, c) => sum + c.decoys.length, 0)
    negLines.push(`| ${group} | ${h.toFixed(2)} | ${none.length} | ${hits} | ${rate(hits, h)} (${(poissonUpper(hits) / h).toFixed(2)}) | ${woke} | ${rate(woke, h)} (${(poissonUpper(woke) / h).toFixed(2)}) | ${limited} | ${rate(limited, h)} | ${decoys} |`)
  }
  console.log(`\nFalse wakes on the clips without any form of the word (#2's trial target: <= 0.1 false activations per hour):\n${negLines.join('\n')}`)
  const posLines = ['| label | clips (n) | spotter hit (a wake event) | coordinator woke (35) | text alone woke (LIMITED) | decoy hit |', '|---|---|---|---|---|---|']
  for (const label of REAL_LABELS.filter((l) => l !== 'none')) {
    const these = clips.filter((c) => c.label === label)
    const n = these.length
    const count = (pick: (c: ClipOut) => boolean): string => `${these.filter(pick).length}/${n}`
    posLines.push(`| ${label} | ${n} | ${count((c) => c.wakes > 0)} | ${count((c) => c.finals.some((f) => f.woke))} | ${count((c) => c.finals.some((f) => f.limited))} | ${count((c) => c.decoys.length > 0)} |`)
  }
  console.log(`\nThe clips whose transcript has a form of the verb (per clip: at least one):\n${posLines.join('\n')}`)
  const wakeN = clips.filter((c) => c.label === 'wake').length
  if (wakeN < 20) console.log(`\nThe wake form "ütle" is in ${wakeN} clips: under 20, too few for a recall claim on real voices.`)
  const relForms = new Map<string, { n: number; hit: number }>()
  for (const c of clips.filter((x) => x.label === 'relative')) {
    for (const form of new Set(formsOf(c.text))) {
      const entry = relForms.get(form) ?? { n: 0, hit: 0 }
      entry.n += 1
      if (c.wakes > 0) entry.hit += 1
      relForms.set(form, entry)
    }
  }
  console.log(`\nRelatives per form (clips with it: spotter hit / n): ${[...relForms].sort((a, b) => b[1].n - a[1].n).map(([f, e]) => `${f} ${e.hit}/${e.n}`).join(', ')}`)
  const shown = clips.filter((c) => c.wakes > 0 || c.finals.some((f) => f.woke || f.limited))
  console.log(`\nEvery clip with a wake event or a wake on either path (${shown.length}):`)
  for (const c of shown) console.log(`  ${c.label}\t${c.path}\twakes ${c.wakes}\tdecoys ${c.decoys.join(',') || '-'}\tfinals: ${c.finals.map((f) => `${f.spotted ? '[heard] ' : ''}${f.woke ? '[WOKE] ' : ''}${f.limited ? '[text woke] ' : ''}${f.text}`).join(' | ')}\ttranscript: ${c.text}`)
}

// ---------- main ----------

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag)
  return i < 0 ? undefined : process.argv[i + 1]
}

function cacheArg(flag: string): string {
  const given = arg(flag)
  if (given === undefined) throw new Error(`${flag} <cache>: a directory outside the repository`)
  const cache = resolve(given)
  if (!relative(root, cache).startsWith('..')) throw new Error(`${cache} is inside the repository: the corpora stay outside it`)
  return cache
}

async function main(): Promise<void> {
  if (process.argv.includes('--fetch')) {
    const cache = cacheArg('--fetch')
    mkdirSync(join(cache, 'fleurs-et'), { recursive: true })
    for (const remote of FLEURS_FILES) await fetchPinned(cache, remote)
    for (const split of FLEURS_SPLITS) extractFleurs(cache, split)
    await fetchVoxPopuli(cache)
    const rows = [...FLEURS_SPLITS.flatMap((split) => fleursRows(cache, split)), ...voxRows(cache)]
    const missing = rows.filter((r) => !existsSync(join(cache, r.path)))
    if (missing.length > 0) throw new Error(`${missing.length} clips listed but not on disk, first ${missing[0]?.path}`)
    writeFileSync(join(cache, 'labels.tsv'), `${[LABELS_HEADER, ...rows.map((r) => [r.set, r.path, r.speaker, r.gender, r.seconds.toFixed(3), r.label, r.forms, r.text].join('\t'))].join('\n')}\n`)
    console.log(`\nwrote ${join(cache, 'labels.tsv')}\n`)
    labelTable(rows)
    return
  }
  if (process.argv.includes('--labels')) {
    labelTable(readLabels(cacheArg('--labels')))
    return
  }
  if (process.argv.includes('--eval')) {
    const cache = cacheArg('--eval')
    const wanted = (arg('--set') ?? '').split(',').filter((s) => s !== '')
    const [part = 1, parts = 1] = (arg('--part') ?? '1/1').split('/').map(Number)
    mkdirSync(outDir, { recursive: true })
    for (const set of wanted) {
      const all = readLabels(cache).filter((r) => r.set === set)
      if (all.length === 0) throw new Error(`no clips in set ${set}`)
      const rows = all.filter((_, i) => i % parts === part - 1)
      const name = parts === 1 ? set : `${set}.${part}of${parts}`
      console.log(`${name}: ${rows.length} clips, ${hours(rows).toFixed(2)} h`)
      const file = join(outDir, `${name}.json`)
      const previous = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as SetOut) : null
      if (previous !== null && previous.partial !== true) {
        console.log(`${name}: done already (${file}); delete it to run again`)
        continue
      }
      const result = evaluate(cache, name, rows, previous, (partial) => writeFileSync(file, JSON.stringify(partial)))
      writeFileSync(file, JSON.stringify(result))
      console.log(`${name}: ${(result.audioS / 3600).toFixed(2)} h in ${(result.wallS / 60).toFixed(1)} min (RTF ${(result.wallS / result.audioS).toFixed(3)}, CPU ${(100 * result.cpuS / result.audioS).toFixed(1)} % of one core)`)
    }
    return
  }
  if (process.argv.includes('--report')) {
    const files = existsSync(outDir) ? readdirSync(outDir).filter((f) => f.endsWith('.json')).sort() : []
    if (files.length === 0) throw new Error('no results in artifacts/kws-real: run --eval first')
    report(files.map((f) => JSON.parse(readFileSync(join(outDir, f), 'utf8')) as SetOut))
    return
  }
  console.log('npx tsx scripts/kws-real.ts --fetch <cache> | --labels <cache> | --eval <cache> --set <sets> [--part i/n] | --report')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
