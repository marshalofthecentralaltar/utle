/**
 * Measures the speaker gate (round 7, SPEECH lane): embeds every clip with the real speaker model,
 * scores each against the owner, and picks the threshold with the fewest errors (ties toward
 * dropping others). Writes <dir>/scores.json.
 *
 *   npx tsx scripts/speaker-calibrate.ts <dir>                         owner-*.wav and other-*.wav in one folder
 *   npx tsx scripts/speaker-calibrate.ts --owner <dir> --other <dir>   every wav in each folder (UTLE_CAPTURE folders)
 *   ... --model <file in models/speaker/>                              measure another speaker model (default: the gate's)
 *   ... --profile models/speaker/owner.json                             also score every clip against a stored
 *                                                                        profile (read only), with the model that made it
 *
 * Round 10 (issue #4), the model sweep (scripts/speaker-sweep.ts; writes JSON, not scores.json):
 *   npx tsx scripts/speaker-calibrate.ts --labels <labels.tsv> --owner-speaker <name> --models all
 *   npx tsx scripts/speaker-calibrate.ts <dir> --models all           (owner-/other- names, as above)
 *   ... --models titanet-small,campplus,eres2net,resnet34              (npx tsx scripts/speaker-models.ts fetches them)
 *   ... --json <file>                                                  default: next to the labels, artifacts/ in the repo
 *
 * The owner is enrolled through the real gate (server/speaker.ts: one phrase per owner clip, the
 * profile is their mean, as scripted enrolment makes it) into a temporary profile, and every other
 * clip is judged by the gate against it (the `gate` column). Each owner clip's score is against the
 * mean of the OTHER owner clips (leave one out), so no clip is scored against itself; the threshold
 * is picked on those scores. Clips are 16 kHz mono wavs (16-bit or float).
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ASR_FRAME_SAMPLES } from '../src/speech/asrProtocol.ts'
import { OWNER_THRESHOLD, SPEAKER_MODEL_FILE, cosine, createSpeakerGate, embeddedSamples, meanEmbedding, normalised, pickThreshold } from '../server/speaker.ts'
import type { EnrolPhrase } from '../server/speaker.ts'
import { loadSpeakerModel } from '../server/speakerModel.ts'
import { runSweep } from './speaker-sweep.ts'
import { readAnyWav } from './wav.ts'

const argv = process.argv.slice(2)
// Round 10 (issue #4): --labels or --models runs the model sweep (scripts/speaker-sweep.ts) instead;
// without them everything below runs exactly as before.
if (argv.includes('--labels') || argv.includes('--models')) {
  await runSweep(argv)
  process.exit(0)
}
const flag =(name: string): string | undefined => {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv.splice(at, 2)[1]
}
const ownerDir = flag('--owner')
const otherDir = flag('--other')
const profilePath = flag('--profile')
const modelFile = flag('--model') ?? SPEAKER_MODEL_FILE
const dir = argv[0] ?? ownerDir
if (dir === undefined) throw new Error('usage: speaker-calibrate.ts <dir> | --owner <dir> --other <dir> [--profile owner.json]')

type Label = 'owner' | 'other'
const clips: Array<{ path: string; file: string; label: Label }> = []
const wavs = (d: string): string[] => readdirSync(d).filter((f) => f.toLowerCase().endsWith('.wav')).sort()
if (ownerDir !== undefined && otherDir !== undefined) {
  for (const f of wavs(ownerDir)) clips.push({ path: join(ownerDir, f), file: `owner/${f}`, label: 'owner' })
  for (const f of wavs(otherDir)) clips.push({ path: join(otherDir, f), file: `other/${f}`, label: 'other' })
} else {
  for (const f of wavs(dir)) {
    if (f.startsWith('owner-')) clips.push({ path: join(dir, f), file: f, label: 'owner' })
    else if (f.startsWith('other-')) clips.push({ path: join(dir, f), file: f, label: 'other' })
  }
}
if (!clips.some((c) => c.label === 'owner') || !clips.some((c) => c.label === 'other')) throw new Error('need at least one owner clip and one other clip')

const root = fileURLToPath(new URL('..', import.meta.url))
const model = loadSpeakerModel(root, modelFile)
if (!model.ok) throw new Error(`speaker model not loaded: ${model.reason} (npm run model)`)

/** 100 ms frames, as the server hands them to the gate. */
const framesOf = (samples: Float32Array): Float32Array[] => {
  const frames: Float32Array[] = []
  for (let at = 0; at < samples.length; at += ASR_FRAME_SAMPLES) frames.push(samples.slice(at, at + ASR_FRAME_SAMPLES))
  return frames
}

const loaded = clips.map((clip) => {
  const wav = readAnyWav(clip.path)
  if (wav.rate !== 16000) throw new Error(`${clip.file}: ${wav.rate} Hz, expected 16000`)
  return { ...clip, samples: wav.samples, seconds: wav.samples.length / 16000 }
})

// The stand-in owner through the real gate, into a temporary profile.
const temp = mkdtempSync(join(tmpdir(), 'utle-calibrate-'))
const gate = createSpeakerGate(model.extractor, { profilePath: join(temp, 'owner.json'), modelName: modelFile })
const phrases: EnrolPhrase[] = []
const embedded = loaded.map((clip) => {
  const started = performance.now()
  // The same samples the gate embeds: the clip's frames at or above SILENCE_RMS.
  const embedding = normalised(model.extractor.embed(embeddedSamples(framesOf(clip.samples))))
  const ms = performance.now() - started
  if (clip.label === 'owner') {
    const phrase = gate.phrase(framesOf(clip.samples))
    if (phrase) phrases.push(phrase)
  }
  return { ...clip, embedding, ms }
})
if (!gate.enrolPhrases(phrases)) throw new Error('the gate could not learn the owner from these clips')

const owners = embedded.filter((c) => c.label === 'owner')
const scored = embedded.map((clip) => {
  const against = clip.label === 'owner' && owners.length > 1 ? meanEmbedding(owners.filter((o) => o !== clip).map((o) => o.embedding)) : meanEmbedding(owners.map((o) => o.embedding))
  return {
    file: clip.file,
    label: clip.label,
    seconds: Math.round(clip.seconds * 100) / 100,
    score: Math.round(cosine(clip.embedding, against) * 1000) / 1000,
    gate: gate.judge(framesOf(clip.samples))?.speaker ?? 'none',
    ms: Math.round(clip.ms),
  }
})
rmSync(temp, { recursive: true, force: true })

const ownerScores = scored.filter((s) => s.label === 'owner').map((s) => s.score)
const otherScores = scored.filter((s) => s.label === 'other').map((s) => s.score)
const pick = pickThreshold(ownerScores, otherScores)
const errorsAt = (t: number): { ownerDropped: number; otherPassed: number } => ({
  ownerDropped: ownerScores.filter((s) => s < t).length,
  otherPassed: otherScores.filter((s) => s >= t).length,
})

console.log(`model ${modelFile}; owner enrolled through the gate from ${phrases.length} clips (owner scores: leave one out); ${owners.length} owner clips, ${otherScores.length} other clips`)
console.log('')
console.log(`${'clip'.padEnd(34)} ${'label'.padEnd(6)} ${'sec'.padStart(5)} ${'score'.padStart(7)} ${'gate'.padStart(8)} ${'ms'.padStart(5)}`)
for (const s of [...scored].sort((a, b) => b.score - a.score)) {
  console.log(`${s.file.padEnd(34)} ${s.label.padEnd(6)} ${s.seconds.toFixed(2).padStart(5)} ${s.score.toFixed(3).padStart(7)} ${s.gate.padStart(8)} ${String(s.ms).padStart(5)}`)
}
const ownerMin = Math.min(...ownerScores)
const otherMax = Math.max(...otherScores)
console.log('')
console.log(`owner min ${ownerMin.toFixed(3)}   other max ${otherMax.toFixed(3)}   gap ${(ownerMin - otherMax).toFixed(3)}`)
console.log(`best threshold ${pick.threshold.toFixed(3)}: ${pick.ownerDropped} owner clips dropped, ${pick.otherPassed} other clips passed`)
const now = errorsAt(OWNER_THRESHOLD)
console.log(`OWNER_THRESHOLD in server/speaker.ts is ${OWNER_THRESHOLD}: ${now.ownerDropped} owner clips dropped, ${now.otherPassed} other clips passed`)
console.log(`gate column: the other clips judged against the profile of all owner clips; owner verdicts there include the clip itself`)
const meanMs = Math.round(scored.reduce((n, s) => n + s.ms, 0) / scored.length)
console.log(`embedding time: mean ${meanMs} ms per clip`)

// Every clip against a stored profile (read only), with the model that made it.
let stored: { profile: string; model: string; scores: Array<{ file: string; score: number }> } | null = null
if (profilePath !== undefined) {
  if (!existsSync(profilePath)) throw new Error(`no profile at ${profilePath}`)
  const value = JSON.parse(readFileSync(profilePath, 'utf8')) as { embedding?: unknown; model?: unknown }
  if (!Array.isArray(value.embedding)) throw new Error(`${profilePath} has no embedding`)
  const embedding = value.embedding.filter((x): x is number => typeof x === 'number')
  const file = typeof value.model === 'string' && value.model !== '' ? value.model : SPEAKER_MODEL_FILE
  const its = loadSpeakerModel(root, file)
  console.log('')
  if (!its.ok) console.log(`${basename(profilePath)} was made with ${file}, which is not in models/speaker/ (${its.reason}): not scored`)
  else {
    const scores = loaded.map((clip) => ({ file: clip.file, score: Math.round(cosine(normalised(its.extractor.embed(embeddedSamples(framesOf(clip.samples)))), embedding) * 1000) / 1000 }))
    stored = { profile: profilePath, model: file, scores }
    const note = file === SPEAKER_MODEL_FILE ? '' : ` (not the gate's model: its scores are on ${file}'s scale, not comparable with OWNER_THRESHOLD)`
    console.log(`against ${basename(profilePath)}, model ${file}${note}:`)
    for (const s of [...scores].sort((a, b) => b.score - a.score)) console.log(`  ${s.file.padEnd(32)} ${s.score.toFixed(3)}`)
    console.log(`  max ${Math.max(...scores.map((s) => s.score)).toFixed(3)}`)
  }
}

const outFile = join(dir, 'scores.json')
writeFileSync(
  outFile,
  `${JSON.stringify({ model: modelFile, ownerPhrases: phrases.length, ownerMin, otherMax, threshold: pick.threshold, ownerDropped: pick.ownerDropped, otherPassed: pick.otherPassed, currentThreshold: OWNER_THRESHOLD, currentErrors: now, scores: scored, stored }, null, 2)}\n`,
)
console.log(`wrote ${outFile}`)
