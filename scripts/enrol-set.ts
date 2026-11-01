/**
 * Round 10 (ARCHITECTURE 31.7): the enrolment fixture of lane VOICE, in scripts/fixtures/enrol-set/.
 * SYNTHETIC: TartuNLP's text-to-speech voice "mari" (the stand-in owner of scripts/fixtures/speaker-set)
 * reads the real enrolment phrases of src/core/enrolPhrases.ts (https://api.tartunlp.ai).
 *
 * - enrol-01.wav ... enrol-12.wav: ENROL_PHRASES, in order (what the welcome page asks him to read).
 * - verify-1.wav, verify-2.wav: VERIFY_PHRASES (what "Proovi minu häält" asks him to say).
 *
 * Each clip is 16 kHz mono 16-bit PCM with 0.3 s of floor before and 0.5 s after the speech, the floor
 * a brown noise at about -66 dBFS, as scripts/listen-set.ts makes it. No person's voice is in it.
 *
 *   npx tsx scripts/enrol-set.ts            (needs the network)
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { wavBytes } from '../server/capture.ts'
import { ENROL_PHRASES, VERIFY_PHRASES } from '../src/core/enrolPhrases.ts'
import { readAnyWav, resample } from './wav.ts'

const RATE = 16000
const SPEAKER = 'mari'
const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'scripts', 'fixtures', 'enrol-set')

const ENROL_SET = [
  ...ENROL_PHRASES.map((text, i) => ({ name: `enrol-${String(i + 1).padStart(2, '0')}`, text })),
  ...VERIFY_PHRASES.map((text, i) => ({ name: `verify-${i + 1}`, text })),
]

async function tts(text: string): Promise<Float32Array> {
  const response = await fetch('https://api.tartunlp.ai/text-to-speech/v2', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, speaker: SPEAKER, speed: 1 }) })
  if (!response.ok) throw new Error(`text-to-speech ${SPEAKER}: HTTP ${response.status}`)
  const file = join(tmpdir(), `utle-tts-${SPEAKER}-${Date.now()}.wav`)
  writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  const wav = readAnyWav(file)
  rmSync(file, { force: true })
  return wav.rate === RATE ? wav.samples : resample(wav.samples, wav.rate, RATE)
}

let seed = 17
const noise = (): number => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648 - 0.5
}
/** 0.3 s of floor, the speech, 0.5 s of floor, as a microphone would give it. */
function floored(speech: Float32Array): Float32Array {
  const lead = Math.round(0.3 * RATE)
  const samples = new Float32Array(lead + speech.length + Math.round(0.5 * RATE))
  samples.set(speech, lead)
  let brown = 0
  for (let i = 0; i < samples.length; i += 1) {
    brown = 0.97 * brown + noise()
    samples[i] = (samples[i] ?? 0) + brown * 0.0005
  }
  return samples
}

mkdirSync(out, { recursive: true })
for (const clip of ENROL_SET) {
  const samples = floored(await tts(clip.text))
  writeFileSync(join(out, `${clip.name}.wav`), wavBytes(samples, RATE))
  console.log(`${clip.name}.wav  ${SPEAKER}  ${(samples.length / RATE).toFixed(2)} s  "${clip.text}"`)
}
