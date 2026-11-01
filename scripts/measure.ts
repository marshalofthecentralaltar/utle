/**
 * Round 10, lane MEASURE (GitHub issue #4): the pure parts of the measurement scripts, so they can be
 * tested. No file system, no network, no audio here; scripts/record.ts, label.ts, wer.ts,
 * speaker-calibrate.ts and latency.ts do the I/O.
 *
 * labels.tsv (one header line, tab separated, one clip per line):
 *   file        the wav's path relative to the labels file (forward slashes)
 *   speaker     who spoke, typed by a person ("ralf", "partner1", ...); blank until someone labels it.
 *               The speaker gate's own verdict is never copied here: it is what is being measured.
 *   reference   what was said, typed by a person, in words (see normaliseEt for digits)
 *   addressee   "ütle" when the words were meant for Ütle, "not" when not, blank when unknown
 *   kind        enrol | command | dictation | wake | short | crosstalk | other (enrol: one of the 12
 *               enrolment phrases, src/core/enrolPhrases.ts; the speaker sweep builds the owner's
 *               profile from his enrol clips, as the product does)
 *   duration_s  the clip's length in seconds, two decimals
 */

import { ENROL_PHRASES } from '../src/core/enrolPhrases.ts'

export const LABEL_COLUMNS = ['file', 'speaker', 'reference', 'addressee', 'kind', 'duration_s'] as const

export type Addressee = 'ütle' | 'not' | ''
export const KINDS = ['enrol', 'command', 'dictation', 'wake', 'short', 'crosstalk', 'other'] as const
export type Kind = (typeof KINDS)[number]

export interface LabelRow {
  file: string
  speaker: string
  reference: string
  addressee: Addressee
  kind: Kind
  durationS: number
}

const clean = (text: string): string => text.replace(/[\t\r\n]+/g, ' ').trim()

/** labels.tsv text for rows, header first. Tabs and newlines inside a field become spaces. */
export function formatLabels(rows: readonly LabelRow[]): string {
  const lines = [LABEL_COLUMNS.join('\t')]
  for (const r of rows) lines.push([clean(r.file), clean(r.speaker), clean(r.reference), r.addressee, r.kind, r.durationS.toFixed(2)].join('\t'))
  return `${lines.join('\n')}\n`
}

/** Reads labels.tsv. Throws with the line number on a malformed line; the header must be exactly LABEL_COLUMNS. */
export function parseLabels(text: string): LabelRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  const header = lines.shift()
  if (header !== LABEL_COLUMNS.join('\t')) throw new Error(`labels.tsv: the first line must be "${LABEL_COLUMNS.join('<TAB>')}"`)
  return lines.map((line, i) => {
    const cells = line.split('\t')
    if (cells.length !== LABEL_COLUMNS.length) throw new Error(`labels.tsv line ${i + 2}: ${cells.length} columns, expected ${LABEL_COLUMNS.length}`)
    const [file = '', speaker = '', reference = '', addressee = '', kind = '', duration = ''] = cells
    if (addressee !== 'ütle' && addressee !== 'not' && addressee !== '') throw new Error(`labels.tsv line ${i + 2}: addressee "${addressee}" is not ütle, not or blank`)
    const k = KINDS.find((x) => x === kind)
    if (k === undefined) throw new Error(`labels.tsv line ${i + 2}: kind "${kind}" is not one of ${KINDS.join(', ')}`)
    const durationS = Number(duration)
    if (!Number.isFinite(durationS) || durationS < 0) throw new Error(`labels.tsv line ${i + 2}: duration_s "${duration}" is not a number`)
    return { file, speaker: speaker.trim(), reference: reference.trim(), addressee, kind: k, durationS }
  })
}

/**
 * An UTLE_CAPTURE folder's log.tsv (server/capture.ts: file, gate score, gate speaker, recognised
 * text) as label rows. The speaker is left blank on purpose: the gate's verdict is not ground truth.
 * The recognised text is NOT copied into reference either (it is the thing WER measures); it is
 * returned beside each row as a hint for the person typing the reference.
 */
export function rowsFromCaptureLog(log: string, durationOf: (file: string) => number): Array<{ row: LabelRow; heard: string }> {
  const out: Array<{ row: LabelRow; heard: string }> = []
  for (const line of log.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const [file = '', , , heard = ''] = line.split('\t')
    if (!file.toLowerCase().endsWith('.wav')) continue
    out.push({ row: { file, speaker: '', reference: '', addressee: '', kind: 'other', durationS: durationOf(file) }, heard })
  }
  return out
}

// ---------- Estonian normalisation, WER and CER ----------

const DIGIT_WORDS = ['null', 'üks', 'kaks', 'kolm', 'neli', 'viis', 'kuus', 'seitse', 'kaheksa', 'üheksa'] as const

/**
 * The text both sides are compared in, for Estonian:
 * - Unicode NFC, then lower case (Estonian rules: Õ Ä Ö Ü Š Ž keep their marks).
 * - Digits are spelled one by one ("5551234" and "5 5 5" become "viis viis viis ..."), as a person
 *   reads a phone number. A number said as a whole word ("kaksteist") must be typed as that word in
 *   the reference: "12" would become "üks kaks" and count as two errors.
 * - Apostrophes are removed inside a word ("youtube'i" is "youtubei"); hyphens and every other
 *   punctuation mark become a space. Quotes of any kind („ü“ "ü" «ü») go.
 * - Runs of white space become one space.
 */
export function normaliseEt(text: string): string {
  return text
    .normalize('NFC')
    .toLocaleLowerCase('et')
    .replace(/['’ʼ`´]/g, '')
    .replace(/\d/g, (d) => ` ${DIGIT_WORDS[Number(d)] ?? d} `)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Levenshtein distance between two sequences. */
export function editDistance<T>(a: readonly T[], b: readonly T[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
      row[j] = Math.min(substitution, (previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1)
    }
    previous = row
  }
  return previous[b.length] ?? 0
}

export interface ErrorCount {
  /** Edits needed to turn the hypothesis into the reference. */
  errors: number
  /** Units (words or characters) in the normalised reference. */
  units: number
}

/** Word errors over normaliseEt text. */
export function wordErrors(reference: string, hypothesis: string): ErrorCount {
  const ref = normaliseEt(reference).split(' ').filter(Boolean)
  const hyp = normaliseEt(hypothesis).split(' ').filter(Boolean)
  return { errors: editDistance(ref, hyp), units: ref.length }
}

/** Character errors over normaliseEt text, spaces between words counted as characters. */
export function charErrors(reference: string, hypothesis: string): ErrorCount {
  const ref = [...normaliseEt(reference)]
  const hyp = [...normaliseEt(hypothesis)]
  return { errors: editDistance(ref, hyp), units: ref.length }
}

/** errors / units; a total is the sum of errors over the sum of units (not a mean of rates). 0/0 is 0, n/0 is 1. */
export function rate(count: ErrorCount): number {
  return count.units === 0 ? (count.errors === 0 ? 0 : 1) : count.errors / count.units
}

export function sumCounts(counts: readonly ErrorCount[]): ErrorCount {
  return counts.reduce((s, c) => ({ errors: s.errors + c.errors, units: s.units + c.units }), { errors: 0, units: 0 })
}

// ---------- statistics ----------

/** The p-th percentile (0..100) by linear interpolation between closest ranks; NaN for no values. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(at)
  const hi = Math.ceil(at)
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (at - lo)
}

export const median = (values: readonly number[]): number => percentile(values, 50)

/** Wilson score interval (95 % by default) for k successes in n trials; [0, 1] for n = 0. */
export function wilson(k: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 }
  const p = k / n
  const z2 = z * z
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n)
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n)
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) }
}

export interface Rates {
  threshold: number
  /** Other trials accepted as the owner (score >= threshold), and their share. */
  falseAccepts: number
  far: number
  /** Owner trials rejected (score < threshold), and their share. */
  falseRejects: number
  frr: number
  nOwner: number
  nOther: number
  farCi: { low: number; high: number }
  frrCi: { low: number; high: number }
}

/** FAR and FRR at a threshold, with Wilson 95 % intervals. A score at the threshold passes, as in server/speaker.ts verdict(). */
export function ratesAt(owner: readonly number[], other: readonly number[], threshold: number): Rates {
  const falseAccepts = other.filter((s) => s >= threshold).length
  const falseRejects = owner.filter((s) => s < threshold).length
  return {
    threshold,
    falseAccepts,
    far: other.length === 0 ? Number.NaN : falseAccepts / other.length,
    falseRejects,
    frr: owner.length === 0 ? Number.NaN : falseRejects / owner.length,
    nOwner: owner.length,
    nOther: other.length,
    farCi: wilson(falseAccepts, other.length),
    frrCi: wilson(falseRejects, owner.length),
  }
}

/**
 * Equal error rate: over every candidate threshold (each score, and just above the highest), the one
 * where |FAR - FRR| is smallest; the EER is their mean there and eerThreshold that threshold. NaN when
 * a side is empty. (No "fewest errors" threshold: with 5 owner and 20 other trials it trades owner
 * rejections for strangers' by how many clips each side happens to have.)
 */
export function eer(owner: readonly number[], other: readonly number[]): { eer: number; eerThreshold: number } {
  if (owner.length === 0 || other.length === 0) return { eer: Number.NaN, eerThreshold: Number.NaN }
  let eerValue = Number.NaN
  let eerThreshold = Number.NaN
  let gap = Number.POSITIVE_INFINITY
  for (const t of candidateThresholds(owner, other)) {
    const r = ratesAt(owner, other, t)
    const d = Math.abs(r.far - r.frr)
    if (d < gap) {
      gap = d
      eerValue = (r.far + r.frr) / 2
      eerThreshold = t
    }
  }
  return { eer: eerValue, eerThreshold }
}

/** Every score, ascending, and one just above the highest (where nothing passes). */
function candidateThresholds(owner: readonly number[], other: readonly number[]): number[] {
  const candidates = [...new Set([...owner, ...other])].sort((a, b) => a - b)
  candidates.push((candidates[candidates.length - 1] ?? 0) + 1e-6)
  return candidates
}

export interface OperatingPoint {
  /** The lowest threshold where the measured FAR is at most farTarget; NaN when there are no other trials. */
  threshold: number
  rates: Rates
  /** True only when the Wilson upper bound of FAR there is at most farTarget: the sample shows the target is met. */
  verifiable: boolean
}

/**
 * Issue #3's operating point, with FAR, FRR and their Wilson intervals there. It depends only on the
 * other trials' scores, never on how many owner trials there are:
 * - verified: the lowest threshold where the Wilson 95 % upper bound of FAR is at most farTarget (the
 *   sample shows strangers stay under the target, keeping the most owner speech);
 * - when no threshold can show that (too few other trials: 0 of 20 accepted still has an upper bound
 *   of 16 %), the lowest threshold whose MEASURED FAR is at most farTarget, with verifiable false; the
 *   table then says "not verifiable at n=...".
 */
export function operatingPoint(owner: readonly number[], other: readonly number[], farTarget: number): OperatingPoint {
  if (other.length === 0) return { threshold: Number.NaN, rates: ratesAt(owner, other, Number.NaN), verifiable: false }
  const candidates = candidateThresholds(owner, other)
  const verified = candidates.find((t) => ratesAt(owner, other, t).farCi.high <= farTarget)
  if (verified !== undefined) return { threshold: verified, rates: ratesAt(owner, other, verified), verifiable: true }
  const measured = candidates.find((t) => ratesAt(owner, other, t).far <= farTarget) ?? Number.NaN
  return { threshold: measured, rates: ratesAt(owner, other, measured), verifiable: false }
}

/** The number of other trials, all rejected, needed for the Wilson upper bound of FAR to reach farTarget. */
export function otherTrialsNeeded(farTarget: number): number {
  let n = 1
  while (wilson(0, n).high > farTarget && n < 1_000_000) n += 1
  return n
}

/** Issue #3's length buckets: very short (<= 0.7 s), short (1 to 2 s), long (> 2 s). 0.7 to 1 s is in no bucket and reported as such. */
export type Bucket = '<=0.7s' | '1-2s' | '>2s' | '0.7-1s'
export const BUCKETS: readonly Bucket[] = ['<=0.7s', '0.7-1s', '1-2s', '>2s']
export function bucketOf(seconds: number): Bucket {
  if (seconds <= 0.7) return '<=0.7s'
  if (seconds < 1) return '0.7-1s'
  if (seconds <= 2) return '1-2s'
  return '>2s'
}

// ---------- where recordings may go ----------

/**
 * True when target is the repository root or inside it. Both are absolute paths; compared case
 * insensitively on Windows, with either slash.
 */
export function insideRepo(target: string, repoRoot: string, windows = process.platform === 'win32'): boolean {
  const norm = (p: string): string => {
    const s = p.replace(/\\/g, '/').replace(/\/+$/, '')
    return windows ? s.toLowerCase() : s
  }
  const t = norm(target)
  const r = norm(repoRoot)
  return t === r || t.startsWith(`${r}/`)
}

// ---------- the recording script ----------

export interface Prompt {
  /** File stem, unique within one person's session. */
  id: string
  text: string
  kind: Kind
  addressee: Addressee
}

/**
 * What record.ts asks each person to say. First the 12 enrolment phrases the product learns a voice
 * from (src/core/enrolPhrases.ts), then commands and dictations as round 10's plan sets them (10
 * each), the wake cases of issue #2's matrix (Ütle at the start, middle and end of a sentence;
 * "ütlen", "ütles"; a quoted "ütle"), and issue #3's short words. For the crosstalk set, everyone
 * talks at once while the owner reads the commands.
 */
export const PROMPTS: readonly Prompt[] = [
  ...ENROL_PHRASES.map((text, i): Prompt => ({ id: `enrol-${String(i + 1).padStart(2, '0')}`, text, kind: 'enrol', addressee: '' })),
  { id: 'cmd-01', text: 'Keri alla.', kind: 'command', addressee: 'ütle' },
  { id: 'cmd-02', text: 'Mine tagasi.', kind: 'command', addressee: 'ütle' },
  { id: 'cmd-03', text: 'Ava uus vaheleht.', kind: 'command', addressee: 'ütle' },
  { id: 'cmd-04', text: 'Mine youtube’i.', kind: 'command', addressee: 'ütle' },
  { id: 'cmd-05', text: 'Näita numbreid.', kind: 'command', addressee: 'ütle' },
  { id: 'cmd-06', text: 'Vajuta kolm.', kind: 'command', addressee: 'ütle' },
  { id: 'cmd-07', text: 'Mine emaili.', kind: 'command', addressee: 'ütle' },
  { id: 'cmd-08', text: 'Kustuta viimane sõna.', kind: 'command', addressee: 'ütle' },
  { id: 'cmd-09', text: 'Loe viimane sõnum ette.', kind: 'command', addressee: 'ütle' },
  { id: 'cmd-10', text: 'Sulge see vaheleht.', kind: 'command', addressee: 'ütle' },
  { id: 'dict-01', text: 'Tere, kas sa jõuad täna õhtul kell seitse koju?', kind: 'dictation', addressee: 'ütle' },
  { id: 'dict-02', text: 'Ma jõuan homme kella kolmeks.', kind: 'dictation', addressee: 'ütle' },
  { id: 'dict-03', text: 'Too poest piima ja leiba.', kind: 'dictation', addressee: 'ütle' },
  { id: 'dict-04', text: 'Uue kepiga on siin vahepeal palju lihtsam käia.', kind: 'dictation', addressee: 'ütle' },
  { id: 'dict-05', text: 'Aitäh, et sa eile appi tulid.', kind: 'dictation', addressee: 'ütle' },
  { id: 'dict-06', text: 'Kohtume reedel kell viis raamatukogu ees.', kind: 'dictation', addressee: 'ütle' },
  { id: 'dict-07', text: 'Mul on täna arsti juures aeg kell üksteist.', kind: 'dictation', addressee: 'ütle' },
  { id: 'dict-08', text: 'Palun helista mulle, kui sul aega on.', kind: 'dictation', addressee: 'ütle' },
  { id: 'dict-09', text: 'See film oli päris hea, aga lõpp oli natuke igav.', kind: 'dictation', addressee: 'ütle' },
  { id: 'dict-10', text: 'Ilm on täna ilus ja päike paistab.', kind: 'dictation', addressee: 'ütle' },
  { id: 'wake-start', text: 'Ütle, mine youtube’i.', kind: 'wake', addressee: 'ütle' },
  { id: 'wake-alone', text: 'Ütle.', kind: 'wake', addressee: 'ütle' },
  { id: 'wake-middle', text: 'No kuule, ütle, mine tagasi.', kind: 'wake', addressee: 'ütle' },
  { id: 'wake-end', text: 'Ma mõtlesin natuke ja ütle.', kind: 'wake', addressee: 'ütle' },
  { id: 'wake-utlen', text: 'Ma ütlen sulle homme.', kind: 'wake', addressee: 'not' },
  { id: 'wake-utles', text: 'Ta ütles, et tuleb hiljem.', kind: 'wake', addressee: 'not' },
  { id: 'wake-quoted', text: 'Kirjuta siia sõna ütle.', kind: 'wake', addressee: 'ütle' },
  { id: 'wake-tv', text: 'Ütle mulle, mis kell on.', kind: 'wake', addressee: 'not' },
  { id: 'short-saada', text: 'Saada.', kind: 'short', addressee: 'ütle' },
  { id: 'short-jah', text: 'Jah.', kind: 'short', addressee: 'ütle' },
  { id: 'short-yks', text: 'Üks.', kind: 'short', addressee: 'ütle' },
]

/** The prompts for a set: "all", or a comma list of kinds (command,dictation,wake,short). */
export function promptsFor(set: string): Prompt[] {
  if (set === 'all') return [...PROMPTS]
  const kinds = new Set(set.split(',').map((s) => s.trim()))
  for (const k of kinds) if (!KINDS.includes(k as Kind)) throw new Error(`unknown kind "${k}"; use all or a comma list of ${KINDS.join(', ')}`)
  return PROMPTS.filter((p) => kinds.has(p.kind))
}

// ---------- where speech ends in a clip ----------

/** -40 dBFS: above a microphone's noise floor (the synthetic set's is about -64 dBFS), below quiet speech. */
export const SPEECH_RMS = 0.01

/**
 * The sample just after the last 20 ms window whose RMS is at least SPEECH_RMS, or 0 when no window
 * is. Latencies "from speech end" are measured from here.
 */
export function speechEndSample(samples: Float32Array, rate = 16000, threshold = SPEECH_RMS): number {
  const win = Math.round(rate * 0.02)
  let end = 0
  for (let at = 0; at < samples.length; at += win) {
    const stop = Math.min(samples.length, at + win)
    let sum = 0
    for (let i = at; i < stop; i += 1) sum += (samples[i] ?? 0) ** 2
    if (Math.sqrt(sum / Math.max(1, stop - at)) >= threshold) end = stop
  }
  return end
}

// ---------- the speaker sweep's trials ----------

export interface TrialClip {
  label: 'owner' | 'other'
  kind: Kind
}

/**
 * How the sweep makes its trials (issue #3's held-out phrases). With owner clips of kind enrol: the
 * owner's profile is the mean of his enrol clips only, as the product's enrolment makes it, and the
 * trials are every other clip (his non-enrol clips, and every clip of other people, their enrol
 * clips included). Without: leave one out, the round 7 method (each owner clip against the mean of
 * the other owner clips, each other clip against all owner clips).
 */
export function splitTrials<T extends TrialClip>(clips: readonly T[]): { method: 'enrol' | 'leave-one-out'; enrol: T[]; trials: T[] } {
  const enrol = clips.filter((c) => c.label === 'owner' && c.kind === 'enrol')
  if (enrol.length === 0) return { method: 'leave-one-out', enrol: [], trials: [...clips] }
  return { method: 'enrol', enrol, trials: clips.filter((c) => !enrol.includes(c)) }
}
