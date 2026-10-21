/**
 * Runs one 16 kHz mono wav through the real recogniser with the speech detector in front, as the
 * server does (round 7, SPEECH lane), and prints each final. For noise: no final should print.
 *
 *   npx tsx scripts/asr-file.ts <wav> [--no-vad]
 *   npx tsx scripts/asr-file.ts --noise <out.wav> [seconds] [dBFS]   writes pink noise (default 20 s at -30 dBFS)
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ASR_FRAME_SAMPLES } from '../src/speech/asrProtocol.ts'
import { loadModel } from '../server/asrModel.ts'
import { decoderInThread, rms } from '../server/asrSession.ts'
import { wavBytes } from '../server/capture.ts'
import { vadLine } from '../server/asr.ts'
import { loadVad } from '../server/vad.ts'
import { readAnyWav } from './wav.ts'

const argv = process.argv.slice(2)

/** Pink noise (Paul Kellet's filter over white noise, fixed seed) scaled to an RMS of `dbfs`. */
function pinkNoise(seconds: number, dbfs: number): Float32Array {
  let seed = 12345
  const white = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return (seed / 2147483648) * 2 - 1
  }
  const out = new Float32Array(Math.round(seconds * 16000))
  let b0 = 0
  let b1 = 0
  let b2 = 0
  let b3 = 0
  let b4 = 0
  let b5 = 0
  let b6 = 0
  for (let i = 0; i < out.length; i += 1) {
    const w = white()
    b0 = 0.99886 * b0 + w * 0.0555179
    b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856
    b4 = 0.55 * b4 + w * 0.5329522
    b5 = -0.7616 * b5 - w * 0.016898
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
    b6 = w * 0.115926
  }
  const scale = 10 ** (dbfs / 20) / rms(out)
  for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) * scale
  return out
}

if (argv[0] === '--noise') {
  const target = argv[1]
  if (target === undefined) throw new Error('usage: asr-file.ts --noise <out.wav> [seconds] [dBFS]')
  const seconds = Number(argv[2] ?? 20)
  const dbfs = Number(argv[3] ?? -30)
  const noise = pinkNoise(seconds, dbfs)
  writeFileSync(target, wavBytes(noise))
  console.log(`${target}: ${seconds} s of pink noise at ${dbfs} dBFS (RMS ${rms(noise).toFixed(4)})`)
} else {
  const file = argv.find((a) => !a.startsWith('--'))
  if (file === undefined) throw new Error('usage: asr-file.ts <wav> [--no-vad]')
  const root = fileURLToPath(new URL('..', import.meta.url))
  const loaded = loadModel(root)
  if (!loaded.ok) throw new Error(`recogniser not loaded: ${loaded.reason} (npm run model)`)
  const vad = argv.includes('--no-vad') ? null : loadVad(root)
  console.log(vadLine(vad?.ok === true))
  const wav = readAnyWav(file)
  if (wav.rate !== 16000) throw new Error(`${file}: ${wav.rate} Hz, expected 16000`)
  const decoder = decoderInThread(loaded.recognizer, null, { vad: vad?.ok === true ? vad.create : null })
  // Two seconds of silence after the file, so the endpoint rule can end the last utterance.
  const samples = new Float32Array(wav.samples.length + 32000)
  samples.set(wav.samples)
  let finals = 0
  let last = ''
  for (let at = 0; at < samples.length; at += ASR_FRAME_SAMPLES) {
    const result = decoder.accept(samples.slice(at, at + ASR_FRAME_SAMPLES))
    if (result instanceof Promise) throw new Error('in-thread decoder is synchronous')
    last = result.text
    if (result.endpoint && result.text !== '') {
      finals += 1
      console.log(`final at ${(at / 16000).toFixed(1)} s: ${result.text}`)
      last = ''
    }
  }
  if (last !== '') {
    finals += 1
    console.log(`final at the end: ${last}`)
  }
  console.log(`${finals} finals from ${(wav.samples.length / 16000).toFixed(1)} s of ${file}`)
}
