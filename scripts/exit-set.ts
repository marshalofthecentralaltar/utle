/**
 * Round 10 prompt 6 (lane EXIT): the voices of the exit test's rehearsal (#9), in scripts/fixtures/exit-set/.
 * SYNTHETIC: TartuNLP text-to-speech voices stand in for people (https://api.tartunlp.ai).
 *
 * - The owner is "mari", the stand-in owner of scripts/fixtures/enrol-set (his enrolment) and speaker-set.
 * - The room is "kalev" and "vesta" (as in scripts/listen-set.ts): two people talking to each other,
 *   one of them saying the wake word to someone else. Their sentences share no three-word run with
 *   the owner's, so a strip or a message that shows three of their words in a row is a leak.
 *
 * Each clip is 16 kHz mono 16-bit PCM with 0.3 s before it, 0.5 s after it and a noise floor at about
 * -66 dBFS. The texts are in exit-set.json next to them (extension/test/exit.ts reads both).
 *
 *   npx tsx scripts/exit-set.ts            (needs the network)
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { wavBytes } from '../server/capture.ts'
import { readAnyWav, resample } from './wav.ts'

const RATE = 16000
const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'scripts', 'fixtures', 'exit-set')

const EXIT_SET = [
  // The owner (mari): the exit test's sentence, the consent if it stays, the chat, the message, the send.
  { name: 'owner-youtube', speaker: 'mari', room: false, text: 'Ütle, mine youtube’i ja otsi lastelaulud.' },
  { name: 'owner-accept', speaker: 'mari', room: false, text: 'Ütle, nõustu kõigiga.' },
  { name: 'owner-chat', speaker: 'mari', room: false, text: 'Ütle, mine whatsappi ja ava Jaan Tamme vestlus.' },
  { name: 'owner-message', speaker: 'mari', room: false, text: 'Tere Jaan, ma jõuan homme kella kolmeks.' },
  { name: 'owner-send', speaker: 'mari', room: false, text: 'Saada.' },
  // 31: under only-owner a one-word command can be too short to verify; the strip then asks for "saada sõnum".
  { name: 'owner-send-long', speaker: 'mari', room: false, text: 'Saada sõnum.' },
  // When the strip shows he is not heard (ACTIVE ended), a person says the word alone first.
  { name: 'owner-wake', speaker: 'mari', room: false, text: 'Ütle.' },
  // The room: two people talking to each other, around and over him.
  { name: 'room-kalev-1', speaker: 'kalev', room: true, text: 'Kas sa tuled täna õhtul ka poodi kaasa?' },
  { name: 'room-vesta-1', speaker: 'vesta', room: true, text: 'Ei tule, mul on vaja vanaemale helistada.' },
  { name: 'room-kalev-2', speaker: 'kalev', room: true, text: 'Ütle talle, et ma ostan leiba ja piima.' },
  { name: 'room-vesta-2', speaker: 'vesta', room: true, text: 'Ilm on täna jälle nii hall ja külm.' },
  { name: 'room-kalev-3', speaker: 'kalev', room: true, text: 'Kus mu prillid küll on, kas sa nägid neid?' },
  { name: 'room-vesta-3', speaker: 'vesta', room: true, text: 'Bussipeatus on kohe maja taga.' },
] as const

async function tts(text: string, speaker: string): Promise<Float32Array> {
  // TartuNLP reads the typographic apostrophe as the plain one.
  const response = await fetch('https://api.tartunlp.ai/text-to-speech/v2', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text.replace(/’/g, "'"), speaker, speed: 1 }) })
  if (!response.ok) throw new Error(`text-to-speech ${speaker}: HTTP ${response.status}`)
  const file = join(tmpdir(), `utle-tts-${speaker}-${Date.now()}.wav`)
  writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  const wav = readAnyWav(file)
  rmSync(file, { force: true })
  return wav.rate === RATE ? wav.samples : resample(wav.samples, wav.rate, RATE)
}

let seed = 23
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
for (const clip of EXIT_SET) {
  const samples = floored(await tts(clip.text, clip.speaker))
  writeFileSync(join(out, `${clip.name}.wav`), wavBytes(samples, RATE))
  console.log(`${clip.name}.wav  ${clip.speaker}  ${(samples.length / RATE).toFixed(2)} s  "${clip.text}"`)
}
writeFileSync(join(out, 'exit-set.json'), `${JSON.stringify(EXIT_SET, null, 2)}\n`)
