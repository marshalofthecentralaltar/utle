/**
 * Round 10, lane MEASURE (issue #4): makes and corrects labels.tsv (scripts/measure.ts says the
 * columns). Every labels file it writes is outside the repository; the only committed one,
 * scripts/fixtures/labels.tsv, is typed by hand for the synthetic fixtures.
 *
 *   npx tsx scripts/label.ts --import <folder> --out <folder outside the repo> [--speaker <name>] [--kind <kind>]
 *       Adds every wav of <folder> to <out>/labels.tsv (made when missing; files already in it are
 *       skipped). An UTLE_CAPTURE folder (with log.tsv) is read through its log: the gate's speaker
 *       verdict is NOT copied (speaker stays blank unless --speaker names the person who was
 *       recorded), and the recognised text goes to <out>/heard.tsv as a hint, never into reference.
 *       A folder without log.tsv: its *.wav files, sorted.
 *
 *   npx tsx scripts/label.ts --edit <labels.tsv>
 *       Walks the clips whose speaker or reference is blank (--all: every clip). Per field: Enter keeps
 *       it, typed text replaces it, "-" clears it. "p" at any field plays the clip (Windows), "q" saves
 *       and stops. Saved after every clip.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { KINDS, LABEL_COLUMNS, formatLabels, insideRepo, parseLabels, rowsFromCaptureLog } from './measure.ts'
import type { Addressee, Kind, LabelRow } from './measure.ts'
import { readAnyWav } from './wav.ts'

const HELP = `usage:
  npx tsx scripts/label.ts --import <folder> --out <folder outside the repo> [--speaker <name>] [--kind <kind>]
  npx tsx scripts/label.ts --edit <labels.tsv> [--all]`

const argv = process.argv.slice(2)
const has = (name: string): boolean => argv.includes(name)
const value = (name: string): string | undefined => {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** A labels file's path to a wav: relative to the labels file when on the same drive, forward slashes. */
const fileField = (labelsDir: string, wav: string): string => {
  const rel = relative(labelsDir, wav)
  return (isAbsolute(rel) || rel.startsWith('..') ? wav : rel).replace(/\\/g, '/')
}
const seconds = (path: string): number => {
  try {
    const wav = readAnyWav(path)
    return wav.samples.length / wav.rate
  } catch {
    return 0
  }
}

function importFolder(folderArg: string, outArg: string): void {
  const folder = resolve(folderArg)
  const out = resolve(outArg)
  if (insideRepo(out, repoRoot)) {
    console.error(`refused: ${out} is inside the repository. Labels name people and hold what they said; use a folder outside it.`)
    process.exit(3)
  }
  const speaker = value('--speaker') ?? ''
  const kindArg = value('--kind') ?? 'other'
  const kind = KINDS.find((k) => k === kindArg)
  if (kind === undefined) throw new Error(`--kind must be one of ${KINDS.join(', ')}`)
  mkdirSync(out, { recursive: true })
  const labelsFile = join(out, 'labels.tsv')
  const existing = existsSync(labelsFile) ? parseLabels(readFileSync(labelsFile, 'utf8')) : []
  const known = new Set(existing.map((r) => r.file))

  const logFile = join(folder, 'log.tsv')
  const found: Array<{ row: LabelRow; heard: string }> = existsSync(logFile)
    ? rowsFromCaptureLog(readFileSync(logFile, 'utf8'), (f) => seconds(join(folder, f)))
    : readdirSync(folder)
        .filter((f) => f.toLowerCase().endsWith('.wav'))
        .sort()
        .map((f) => ({ row: { file: f, speaker: '', reference: '', addressee: '' as Addressee, kind: 'other' as Kind, durationS: seconds(join(folder, f)) }, heard: '' }))
  const added: LabelRow[] = []
  const heard: string[] = []
  for (const { row, heard: text } of found) {
    const file = fileField(out, join(folder, row.file))
    if (known.has(file)) continue
    known.add(file)
    added.push({ ...row, file, speaker, kind })
    if (text !== '') heard.push(`${file}\t${text}`)
  }
  writeFileSync(labelsFile, formatLabels([...existing, ...added]))
  if (heard.length > 0) {
    const heardFile = join(out, 'heard.tsv')
    const before = existsSync(heardFile) ? readFileSync(heardFile, 'utf8') : 'file\theard (the recogniser, a hint for typing the reference)\n'
    writeFileSync(heardFile, `${before}${heard.join('\n')}\n`)
  }
  console.log(`${added.length} clips added from ${folder}${existsSync(logFile) ? ' (capture log: gate verdicts not copied)' : ''}; ${existing.length} were there; ${labelsFile}`)
  if (speaker === '') console.log('speaker is blank: type it with --edit, or import again with --speaker <name> when the folder is one person.')
}

async function edit(labelsArg: string): Promise<void> {
  const labelsFile = resolve(labelsArg)
  const dir = dirname(labelsFile)
  const rows = parseLabels(readFileSync(labelsFile, 'utf8'))
  const heardFile = join(dir, 'heard.tsv')
  const heard = new Map<string, string>()
  if (existsSync(heardFile)) {
    for (const line of readFileSync(heardFile, 'utf8').split(/\r?\n/).slice(1)) {
      const [f, t] = line.split('\t')
      if (f && t) heard.set(f, t)
    }
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const play = (file: string): void => {
    const path = isAbsolute(file) ? file : join(dir, file)
    if (process.platform !== 'win32') return void console.log(`  (play it yourself: ${path})`)
    execFileSync('powershell', ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${path.replace(/'/g, "''")}').PlaySync()`])
  }
  const save = (): void => writeFileSync(labelsFile, formatLabels(rows))
  const ask = async (label: string, current: string, file: string): Promise<string | null> => {
    for (;;) {
      const answer = (await rl.question(`  ${label} [${current}]: `)).trim()
      if (answer === 'p') {
        play(file)
        continue
      }
      if (answer === 'q') return null
      if (answer === '') return current
      return answer === '-' ? '' : answer
    }
  }
  const todo = rows.filter((r) => has('--all') || r.speaker === '' || r.reference === '')
  console.log(`${todo.length} of ${rows.length} clips to label. Enter keeps, "-" clears, "p" plays, "q" saves and stops.`)
  for (const [n, row] of todo.entries()) {
    console.log(`\n${n + 1}/${todo.length}  ${row.file}  ${row.durationS.toFixed(2)} s${heard.has(row.file) ? `  heard: "${heard.get(row.file)}"` : ''}`)
    const speaker = await ask('speaker', row.speaker, row.file)
    if (speaker === null) break
    const reference = await ask('reference', row.reference, row.file)
    if (reference === null) break
    const addressee = await ask('addressee (ütle/not)', row.addressee, row.file)
    if (addressee === null) break
    const kind = await ask(`kind (${KINDS.join('/')})`, row.kind, row.file)
    if (kind === null) break
    row.speaker = speaker
    row.reference = reference
    if (addressee === 'ütle' || addressee === 'not' || addressee === '') row.addressee = addressee
    const k = KINDS.find((x) => x === kind)
    if (k !== undefined) row.kind = k
    save()
  }
  save()
  rl.close()
  console.log(`saved ${labelsFile}`)
}

if (has('--help') || has('-h')) console.log(`${HELP}\n\ncolumns: ${LABEL_COLUMNS.join(', ')}`)
else if (value('--import') !== undefined && value('--out') !== undefined) importFolder(value('--import') ?? '', value('--out') ?? '')
else if (value('--edit') !== undefined) await edit(value('--edit') ?? '')
else {
  console.error(HELP)
  process.exit(2)
}
