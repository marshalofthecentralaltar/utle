/**
 * Builds the speaker gate's calibration set (round 7, SPEECH lane) in scripts/fixtures/speaker-set/:
 *
 * - owner-*.wav: the five recogniser fixtures (scripts/fixtures/*.wav, one voice: TartuNLP's
 *   speaker "mari", 16 kHz mono) cut into utterances by the speech detector, each with 0.25 s before
 *   and 0.5 s after, as the live path keeps them (the pre-roll, then speech until the detector lets go).
 * - other-<voice>-*.wav: three utterances from each of six other Estonian voices of the same
 *   text-to-speech service (albert, kalev, meelis: male; kylli, vesta, liivika: female), cut the same way.
 * - other-mari-pitch20-*.wav: the hard negative: two owner utterances played 1.2 times as fast
 *   (pitch and tempo up 20 %), the nearest thing to the owner that is not him.
 *
 *   npx tsx scripts/speaker-set.ts            (needs the network for the text-to-speech, and models/vad/)
 *
 * Every clip gets a noise floor at about -66 dBFS (brown-ish noise, fixed seed): a microphone never
 * gives digital silence, and the zeros around text-to-speech made every voice score alike.
 *
 * The voices are synthetic: TartuNLP's multi-speaker Estonian model (https://api.tartunlp.ai). They
 * are a stand-in for people until the owner records his own with UTLE_CAPTURE (HANDOFF 1g).
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { wavBytes } from '../server/capture.ts'
import { loadVad } from '../server/vad.ts'
import { readAnyWav, resample } from './wav.ts'

const RATE = 16000
const root = fileURLToPath(new URL('..', import.meta.url))
const fixtures = join(root, 'scripts', 'fixtures')
const out = join(fixtures, 'speaker-set')
const BEFORE = 0.25
const AFTER = 0.5

const VOICES = ['albert', 'kalev', 'meelis', 'kylli', 'vesta', 'liivika'] as const
const LINES = ['Saada.', 'Keri natuke alla.', 'Tere, kas sa jõuad täna õhtul kell seitse koju?'] as const

const vadLoad = loadVad(root)
if (!vadLoad.ok) throw new Error(`the speech detector is needed to cut utterances (${vadLoad.reason}); run npm run model`)
const vad = vadLoad

/** The utterances of a 16 kHz recording, by the speech detector, padded as the live path keeps them. */
function utterances(samples: Float32Array): Float32Array[] {
  const detector = vad.create()
  const segments: Array<{ start: number; end: number }> = []
  let start = -1
  const step = 1600
  for (let i = 0; i < samples.length + step * 10; i += step) {
    // Silence after the end lets the detector close the last segment.
    detector.acceptWaveform(i < samples.length ? samples.subarray(i, i + step) : new Float32Array(step))
    const on = detector.isDetected()
    while (!detector.isEmpty()) detector.pop()
    if (on && start < 0) start = i
    if (!on && start >= 0) {
      segments.push({ start, end: i })
      start = -1
    }
  }
  // The detector says "speech" up to 0.2 s after it starts and lets go 0.5 s after it ends: back off both.
  return segments.map(({ start: s, end: e }) => {
    const from = Math.max(0, s - Math.round((0.2 + BEFORE) * RATE))
    const to = Math.min(samples.length, e - Math.round(VAD_RELEASE * RATE) + Math.round(AFTER * RATE))
    return samples.slice(from, to)
  })
}
const VAD_RELEASE = 0.5

async function tts(text: string, speaker: string): Promise<Float32Array> {
  const response = await fetch('https://api.tartunlp.ai/text-to-speech/v2', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, speaker, speed: 1 }),
  })
  if (!response.ok) throw new Error(`text-to-speech ${speaker}: HTTP ${response.status}`)
  const file = join(tmpdir(), `utle-tts-${speaker}-${Date.now()}.wav`)
  writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  const wav = readAnyWav(file)
  rmSync(file, { force: true })
  return wav.rate === RATE ? wav.samples : resample(wav.samples, wav.rate, RATE)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
let seed = 7
const noise = (): number => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648 - 0.5
}
/** The clip with a quiet noise floor, as a microphone would give it. */
const floored = (samples: Float32Array): Float32Array => {
  const out = new Float32Array(samples.length)
  let brown = 0
  for (let i = 0; i < samples.length; i += 1) {
    brown = 0.97 * brown + noise()
    out[i] = (samples[i] ?? 0) + brown * FLOOR
  }
  return out
}
const FLOOR = 0.0005
const save = (name: string, samples: Float32Array): void => {
  writeFileSync(join(out, name), wavBytes(floored(samples), RATE))
  console.log(`${name}  ${(samples.length / RATE).toFixed(2)} s`)
}

const owner: Array<{ name: string; samples: Float32Array }> = []
for (const file of readdirSync(fixtures).filter((f) => f.endsWith('.wav')).sort()) {
  const wav = readAnyWav(join(fixtures, file))
  if (wav.rate !== RATE) throw new Error(`${file}: ${wav.rate} Hz, expected ${RATE}`)
  const stem = file.replace(/^et-/, '').replace(/-16k\.wav$/, '')
  utterances(wav.samples).forEach((samples, i) => {
    const name = `owner-${stem}-${i + 1}.wav`
    owner.push({ name, samples })
    save(name, samples)
  })
}

for (const voice of VOICES) {
  for (const [i, line] of LINES.entries()) {
    const parts = utterances(await tts(line, voice))
    // One line is one utterance; a pause the detector split is joined back.
    const joined = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const part of parts) {
      joined.set(part, at)
      at += part.length
    }
    save(`other-${voice}-${i + 1}.wav`, joined)
  }
}

// The hard negative: the two longest owner utterances, 20 % higher and faster.
const longest = [...owner].sort((a, b) => b.samples.length - a.samples.length).slice(0, 2)
longest.forEach(({ samples }, i) => save(`other-mari-pitch20-${i + 1}.wav`, resample(samples, RATE * 1.2, RATE)))
