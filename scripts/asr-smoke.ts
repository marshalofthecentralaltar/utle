/**
 * Streams an Estonian fixture to a running dev server's local recogniser in real time and prints
 * what comes back, with the timings the client would act on. Exits non-zero unless a final holds
 * the expected words.
 *
 *   npx vite --port 5181 --strictPort        (in another shell)
 *   npx tsx scripts/asr-smoke.ts http://localhost:5181          the sentence
 *   npx tsx scripts/asr-smoke.ts http://localhost:5181 jah      the one-word quick reply
 */
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import {
  ASR_FRAME_SAMPLES,
  ASR_PATH,
  ASR_SAMPLE_RATE,
  INSTANT_SETTLE_MS,
  LOCAL_HOLD_MS,
  parseAsrMessage,
} from '../src/speech/asrProtocol.ts'
import { readPcmWav } from './wav.ts'

const base = process.argv[2] ?? 'http://localhost:5173'
const jah = process.argv[3] === 'jah'
const FIXTURE = fileURLToPath(new URL(jah ? './fixtures/et-jah-16k.wav' : './fixtures/et-sentence-16k.wav', import.meta.url))
const EXPECTED = jah ? ['jah'] : ['ava uus vaheleht', 'kell kolm']
const MIN_PARTIALS = jah ? 1 : 3
const words = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().replace(/\s+/g, ' ')
const SILENCE = 1e-3

const { rate, samples } = readPcmWav(FIXTURE)
if (rate !== ASR_SAMPLE_RATE) throw new Error(`fixture must be ${ASR_SAMPLE_RATE} Hz`)
let lastSpeech = 0
for (let i = 0; i < samples.length; i += 1) if (Math.abs(samples[i] ?? 0) > SILENCE) lastSpeech = i

const url = base.replace(/^http/, 'ws') + ASR_PATH
const opened = Date.now()
const ws = new WebSocket(url)
const partials: string[] = []
const finals: string[] = []
let speechEndSentAt = 0
let finalAt = 0
/** When the first partial reading just "jah" arrived, and when the partial next changed. */
let instantAt = 0
let instantChangedAt = 0
let readyMs = 0
const ms = (): string => `${String(Date.now() - opened).padStart(5)} ms`

const done = (code: number): void => {
  ws.close()
  console.log(`\npartials: ${partials.length}, finals: ${finals.length}`)
  console.log(`connect to ready: ${readyMs} ms`)
  if (finalAt > 0) {
    console.log(`last speech chunk sent to final: ${finalAt - speechEndSentAt} ms (includes the 1000 ms endpoint silence)`)
    if (!jah) console.log(`end of speech to the app, final + local hold ${LOCAL_HOLD_MS} ms: ${finalAt - speechEndSentAt + LOCAL_HOLD_MS} ms`)
  }
  if (jah && instantAt > 0) {
    const stable = instantChangedAt === 0 || instantChangedAt - instantAt >= INSTANT_SETTLE_MS
    console.log(`last speech chunk sent to first partial reading "jah": ${instantAt - speechEndSentAt} ms`)
    console.log(`end of speech to release, partial + settle ${INSTANT_SETTLE_MS} ms: ${instantAt - speechEndSentAt + INSTANT_SETTLE_MS} ms (partial stayed unchanged for the settle time: ${stable ? 'yes' : 'no'})`)
  }
  process.exit(code)
}

const stream = async (): Promise<void> => {
  const started = Date.now()
  for (let i = 0, n = 0; i < samples.length; i += ASR_FRAME_SAMPLES, n += 1) {
    // Real time: frame n leaves at n * 100 ms.
    const due = started + (n * ASR_FRAME_SAMPLES * 1000) / ASR_SAMPLE_RATE
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, due - Date.now())))
    const frame = samples.slice(i, i + ASR_FRAME_SAMPLES)
    ws.send(Buffer.from(frame.buffer))
    if (lastSpeech >= i && lastSpeech < i + ASR_FRAME_SAMPLES) speechEndSentAt = Date.now()
  }
  // Silence until the final arrives, as a quiet room would send.
  for (let n = 0; n < 30 && finals.length === 0; n += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    ws.send(Buffer.from(new Float32Array(ASR_FRAME_SAMPLES).buffer))
  }
  setTimeout(() => done(1), 500)
}

ws.on('message', (data, isBinary) => {
  if (isBinary) return
  const message = parseAsrMessage(data.toString())
  if (!message) return
  switch (message.type) {
    case 'ready':
      readyMs = Date.now() - opened
      console.log(`${ms()}  ready`)
      void stream()
      return
    case 'unavailable':
      console.log(`${ms()}  unavailable: ${message.reason}`)
      done(1)
      return
    case 'partial':
      partials.push(message.text)
      if (jah && instantAt > 0 && instantChangedAt === 0) instantChangedAt = Date.now()
      if (jah && instantAt === 0 && words(message.text) === 'jah') instantAt = Date.now()
      console.log(`${ms()}  partial  ${message.text}`)
      return
    case 'final': {
      finals.push(message.text)
      finalAt = Date.now()
      console.log(`${ms()}  FINAL    ${message.text}`)
      const lower = message.text.toLowerCase()
      if (EXPECTED.every((phrase) => lower.includes(phrase))) done(partials.length >= MIN_PARTIALS ? 0 : 1)
      return
    }
  }
})
ws.on('error', (error) => {
  console.log(`socket error: ${error.message}`)
  process.exit(1)
})
