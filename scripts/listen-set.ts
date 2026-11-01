/**
 * Round 10 (ARCHITECTURE 32.4): the two-voice fixture of lane LISTEN, in scripts/fixtures/listen-set/.
 * SYNTHETIC: TartuNLP text-to-speech voices stand in for people (https://api.tartunlp.ai).
 *
 * - owner-wake.wav: "mari" (the stand-in owner of scripts/fixtures/speaker-set) says the wake word
 *   in the middle of a sentence: "No nii. Ütle, mine youtube'i."
 * - room-shop.wav: "kalev" talks to someone in the room: "Kas sa tuled ka poodi?"
 * - room-wake.wav: "vesta" says the wake word to someone else: "Ütle talle, et ma tulen homme."
 *
 * Each clip is 16 kHz mono 16-bit PCM with 0.3 s before it and a noise floor at about -66 dBFS.
 *
 *   npx tsx scripts/listen-set.ts            (needs the network)
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { wavBytes } from '../server/capture.ts'
import { readAnyWav, resample } from './wav.ts'

const RATE = 16000
const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'scripts', 'fixtures', 'listen-set')

const LISTEN_SET = [
  { name: 'owner-wake', speaker: 'mari', text: "No nii. Ütle, mine youtube'i." },
  { name: 'room-shop', speaker: 'kalev', text: 'Kas sa tuled ka poodi?' },
  { name: 'room-wake', speaker: 'vesta', text: 'Ütle talle, et ma tulen homme.' },
] as const

async function tts(text: string, speaker: string): Promise<Float32Array> {
  const response = await fetch('https://api.tartunlp.ai/text-to-speech/v2', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, speaker, speed: 1 }) })
  if (!response.ok) throw new Error(`text-to-speech ${speaker}: HTTP ${response.status}`)
  const file = join(tmpdir(), `utle-tts-${speaker}-${Date.now()}.wav`)
  writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  const wav = readAnyWav(file)
  rmSync(file, { force: true })
  return wav.rate === RATE ? wav.samples : resample(wav.samples, wav.rate, RATE)
}

let seed = 11
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
for (const clip of LISTEN_SET) {
  const samples = floored(await tts(clip.text, clip.speaker))
  writeFileSync(join(out, `${clip.name}.wav`), wavBytes(samples, RATE))
  console.log(`${clip.name}.wav  ${clip.speaker}  ${(samples.length / RATE).toFixed(2)} s  "${clip.text}"`)
}
