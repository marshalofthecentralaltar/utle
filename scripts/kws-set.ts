/**
 * Round 10 (#2, ARCHITECTURE 35): the labelled clips of the keyword spotter's evaluation
 * (scripts/kws-eval.ts) and the wake clips of voice.ts section 9.
 * SYNTHETIC: TartuNLP text-to-speech voices stand in for people (https://api.tartunlp.ai).
 *
 *   npx tsx scripts/kws-set.ts            (needs the network) both sets
 *   npx tsx scripts/kws-set.ts --eval     the evaluation set only, into artifacts/kws-set/ (not committed)
 *   npx tsx scripts/kws-set.ts --voice    voice.ts's clips only, into scripts/fixtures/wake-set/ (committed)
 *   npx tsx scripts/kws-set.ts --chrome   voice.ts section 10's one clip only (CHROME_CLIP), into scripts/fixtures/wake-set/ (committed)
 *
 * Each clip is 16 kHz mono 16-bit PCM with 0.3 s of floor before it, 0.8 s after it, and a noise
 * floor at about -66 dBFS, as scripts/listen-set.ts makes them. The evaluation set is every sentence
 * below in six voices (three male, three female) at three speeds, plus a long paragraph without the
 * word in each voice (the false wakes per hour of talk).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { wavBytes } from '../server/capture.ts'
import { readAnyWav, resample } from './wav.ts'

const RATE = 16000
const root = fileURLToPath(new URL('..', import.meta.url))

/**
 * The label of a clip: wake (said to Ütle), relative (another form of the verb), literal (the word as
 * text he dictates), other (the word said to someone else: the sound is the wake word's, only the
 * addressee differs), room (no form of the word).
 */
export type KwsLabel = 'wake' | 'relative' | 'literal' | 'other' | 'room'

/** Where the wake word is in a wake sentence. */
export type KwsWhere = 'start' | 'middle' | 'end' | ''

export interface KwsSentence {
  name: string
  label: KwsLabel
  where: KwsWhere
  text: string
}

export const KWS_SENTENCES: readonly KwsSentence[] = [
  { name: 'wake-bare', label: 'wake', where: 'start', text: 'Ütle.' },
  { name: 'wake-start-youtube', label: 'wake', where: 'start', text: 'Ütle, ava YouTube.' },
  { name: 'wake-start-scroll', label: 'wake', where: 'start', text: 'Ütle, keri alla.' },
  { name: 'wake-middle-youtube', label: 'wake', where: 'middle', text: 'No nii, ütle, ava YouTube.' },
  { name: 'wake-middle-back', label: 'wake', where: 'middle', text: 'No kuule, ütle, mine tagasi.' },
  { name: 'wake-end-thought', label: 'wake', where: 'end', text: 'Ma mõtlesin... Ütle.' },
  { name: 'wake-end-well', label: 'wake', where: 'end', text: 'Noh, hästi. Ütle.' },
  { name: 'rel-utlen', label: 'relative', where: '', text: 'Ma ütlen sulle homme.' },
  { name: 'rel-utles', label: 'relative', where: '', text: 'Ta ütles, et tuleb.' },
  { name: 'rel-utleb', label: 'relative', where: '', text: 'Ta ütleb alati nii.' },
  { name: 'rel-utleme', label: 'relative', where: '', text: 'Me ütleme talle homme.' },
  { name: 'rel-utlemine', label: 'relative', where: '', text: 'See ütlemine on vale.' },
  { name: 'rel-utelda', label: 'relative', where: '', text: 'Seda on raske ütelda.' },
  { name: 'rel-utlesin', label: 'relative', where: '', text: 'Ma ütlesin seda eile.' },
  { name: 'lit-siia', label: 'literal', where: '', text: 'Kirjuta siia sõna ütle.' },
  { name: 'lit-sona', label: 'literal', where: '', text: 'Kirjuta sõna ütle.' },
  { name: 'room-shop', label: 'room', where: '', text: 'Kas sa tuled ka poodi?' },
  { name: 'room-weather', label: 'room', where: '', text: 'Täna on ilus ilm.' },
  { name: 'room-work', label: 'room', where: '', text: 'Ma lähen homme tööle.' },
  { name: 'room-glasses', label: 'room', where: '', text: 'Kus mu prillid on?' },
  { name: 'room-count', label: 'room', where: '', text: 'Üks, kaks, kolm, neli.' },
  { name: 'room-guest', label: 'room', where: '', text: 'Ülehomme tuleb külaline.' },
  { name: 'other-hello', label: 'other', where: '', text: 'Mine üle tee ja ütle tere.' },
  { name: 'other-tell', label: 'other', where: '', text: 'Ütle talle, et ma tulen homme.' },
]

/** About 120 words of plain Estonian without the word: the false wakes per hour of talk. */
export const KWS_PARAGRAPH =
  'Eesti suvi on lühike, aga see-eest valge ja soe. Juunis paistab päike peaaegu kogu öö ning inimesed ' +
  'sõidavad maale, kus vanaema aed on täis maasikaid ja sõstraid. Lapsed ujuvad järves, käivad metsas ' +
  'mustikal ja jooksevad paljajalu üle niidu. Jaanipäeval tehakse lõkkeid, lauldakse vanu laule ja ' +
  'otsitakse sõnajalaõit, mida keegi pole kunagi leidnud. Juuli on kõige soojem kuu. Siis on rannad ' +
  'rahvast täis, turul müüakse värskeid kurke ja uut kartulit ning õhtuti kostab külades muusikat. ' +
  'Augustis lähevad ööd jälle pimedaks ja taevas võib näha langevaid tähti. Seened kerkivad samblast ' +
  'ja korvid täituvad kukeseente ning puravikega.'

export const KWS_VOICES = ['albert', 'kalev', 'meelis', 'kylli', 'vesta', 'liivika'] as const
export const KWS_SPEEDS = [0.9, 1, 1.15] as const

/** voice.ts section 9 (SYNTHETIC): "mari" is the stand-in owner of scripts/fixtures/speaker-set, "kalev" a stranger. */
const VOICE_SET = [
  { name: 'owner-bare', speaker: 'mari', parts: ['Ütle.'] },
  { name: 'owner-lead-youtube', speaker: 'mari', parts: ['No nii, ütle, ava YouTube.'] },
  { name: 'owner-utlen', speaker: 'mari', parts: ['Ma ütlen sulle homme.'] },
  { name: 'owner-literal', speaker: 'mari', parts: ['Kirjuta siia sõna ütle.'] },
  { name: 'owner-pause-gmail', speaker: 'mari', parts: ['Ütle.', 'Ava Gmail.'] },
  { name: 'owner-scroll', speaker: 'mari', parts: ['Keri alla.'] },
  { name: 'stranger-youtube', speaker: 'kalev', parts: ['Ütle, ava YouTube.'] },
  { name: 'stranger-scroll', speaker: 'kalev', parts: ['Keri alla.'] },
] as const

/**
 * voice.ts section 10 (SYNTHETIC, voice "vesta"): the extension in Chromium with the spotter, one
 * fake-microphone file. Each part its own utterance (CHROME_PAUSE_S apart): the relative wakes
 * nothing, "Ütle." wakes ACTIVE, "Ütle." again toggles back to PASSIVE, "Ütle, ava YouTube." wakes
 * and opens the page. "vesta": TalTech's model writes her "YouTube" as "juutube", which the rules
 * know (most voices give "jõudube", which goes to the model).
 */
export const CHROME_CLIP = { name: 'chrome-sequence', speaker: 'vesta', parts: ['Ma ütlen sulle homme.', 'Ütle.', 'Ütle.', 'Ütle, ava YouTube.'] } as const
/** Long enough for each part's final and the strip's change to land before the next part. */
export const CHROME_PAUSE_S = 5
/** The quiet before the first part: the microphone and the connection settle. */
export const CHROME_LEAD_S = 2.5

/** The pause between the parts of a voice.ts clip ("Ütle" + a natural pause + "ava Gmail"). */
const PAUSE_S = 0.9

async function tts(text: string, speaker: string, speed: number): Promise<Float32Array> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch('https://api.tartunlp.ai/text-to-speech/v2', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, speaker, speed }) })
    if (response.ok) {
      const file = join(tmpdir(), `utle-kws-${speaker}-${Date.now()}.wav`)
      writeFileSync(file, Buffer.from(await response.arrayBuffer()))
      const wav = readAnyWav(file)
      rmSync(file, { force: true })
      return wav.rate === RATE ? wav.samples : resample(wav.samples, wav.rate, RATE)
    }
    if (attempt >= 3) throw new Error(`text-to-speech ${speaker}: HTTP ${response.status}`)
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
  }
}

let seed = 17
const noise = (): number => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648 - 0.5
}
/** 0.3 s of floor (leadS), the parts with PAUSE_S (pauseS) of floor between them, 0.8 s of floor. */
function floored(parts: readonly Float32Array[], pauseS = PAUSE_S, leadS = 0.3): Float32Array {
  const lead = Math.round(leadS * RATE)
  const gap = Math.round(pauseS * RATE)
  const speech = parts.reduce((sum, p) => sum + p.length, 0) + gap * (parts.length - 1)
  const samples = new Float32Array(lead + speech + Math.round(0.8 * RATE))
  let at = lead
  for (const part of parts) {
    samples.set(part, at)
    at += part.length + gap
  }
  let brown = 0
  for (let i = 0; i < samples.length; i += 1) {
    brown = 0.97 * brown + noise()
    samples[i] = (samples[i] ?? 0) + brown * 0.0005
  }
  return samples
}

const only = process.argv.includes('--eval') ? 'eval' : process.argv.includes('--voice') ? 'voice' : process.argv.includes('--chrome') ? 'chrome' : 'both'

if (only === 'chrome') {
  const parts: Float32Array[] = []
  for (const text of CHROME_CLIP.parts) parts.push(await tts(text, CHROME_CLIP.speaker, 1))
  const samples = floored(parts, CHROME_PAUSE_S, CHROME_LEAD_S)
  const file = join(root, 'scripts', 'fixtures', 'wake-set', `${CHROME_CLIP.name}.wav`)
  writeFileSync(file, wavBytes(samples, RATE))
  console.log(`${CHROME_CLIP.name}.wav  ${CHROME_CLIP.speaker}  ${(samples.length / RATE).toFixed(2)} s  "${CHROME_CLIP.parts.join(' | ')}"`)
}

if (only === 'eval' || only === 'both') {
  const out = join(root, 'artifacts', 'kws-set')
  mkdirSync(out, { recursive: true })
  const rows = ['file\tlabel\twhere\tvoice\tspeed\ttext']
  for (const [v, voice] of KWS_VOICES.entries()) {
    for (const [s, sentence] of KWS_SENTENCES.entries()) {
      const speed = KWS_SPEEDS[(v + s) % KWS_SPEEDS.length] ?? 1
      const file = `${sentence.name}-${voice}.wav`
      writeFileSync(join(out, file), wavBytes(floored([await tts(sentence.text, voice, speed)]), RATE))
      rows.push(`${file}\t${sentence.label}\t${sentence.where}\t${voice}\t${speed}\t${sentence.text}`)
    }
    const file = `paragraph-${voice}.wav`
    const samples = floored([await tts(KWS_PARAGRAPH, voice, 1)])
    writeFileSync(join(out, file), wavBytes(samples, RATE))
    rows.push(`${file}\troom\t\t${voice}\t1\t(paragraph)`)
    console.log(`${voice}: ${KWS_SENTENCES.length} sentences and the paragraph (${(samples.length / RATE).toFixed(1)} s)`)
  }
  writeFileSync(join(out, 'labels.tsv'), `${rows.join('\n')}\n`)
}

if (only === 'voice' || only === 'both') {
  const out = join(root, 'scripts', 'fixtures', 'wake-set')
  mkdirSync(out, { recursive: true })
  for (const clip of VOICE_SET) {
    const parts: Float32Array[] = []
    for (const text of clip.parts) parts.push(await tts(text, clip.speaker, 1))
    const samples = floored(parts)
    writeFileSync(join(out, `${clip.name}.wav`), wavBytes(samples, RATE))
    console.log(`${clip.name}.wav  ${clip.speaker}  ${(samples.length / RATE).toFixed(2)} s  "${clip.parts.join(' | ')}"`)
  }
}
