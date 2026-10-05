/**
 * Streams an Estonian sentence to a running dev server's local recogniser in real time and prints
 * what comes back. Exits non-zero unless a final holds the sentence.
 *
 *   npx vite --port 5181 --strictPort        (in another shell)
 *   npx tsx scripts/asr-smoke.ts http://localhost:5181
 */
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { ASR_FRAME_SAMPLES, ASR_PATH, ASR_SAMPLE_RATE, parseAsrMessage } from '../src/speech/asrProtocol.ts'
import { readPcmWav } from './wav.ts'

const base = process.argv[2] ?? 'http://localhost:5173'
const FIXTURE = fileURLToPath(new URL('./fixtures/et-sentence-16k.wav', import.meta.url))
const EXPECTED = ['ava uus vaheleht', 'kell kolm']
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
let readyMs = 0
const ms = (): string => `${String(Date.now() - opened).padStart(5)} ms`

const done = (code: number): void => {
  ws.close()
  console.log(`\npartials: ${partials.length}, finals: ${finals.length}`)
  console.log(`connect to ready: ${readyMs} ms`)
  if (finalAt > 0) console.log(`last speech chunk sent to final: ${finalAt - speechEndSentAt} ms (includes the 1000 ms endpoint silence)`)
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
      console.log(`${ms()}  partial  ${message.text}`)
      return
    case 'final': {
      finals.push(message.text)
      finalAt = Date.now()
      console.log(`${ms()}  FINAL    ${message.text}`)
      const lower = message.text.toLowerCase()
      if (EXPECTED.every((phrase) => lower.includes(phrase))) done(partials.length >= 3 ? 0 : 1)
      return
    }
  }
})
ws.on('error', (error) => {
  console.log(`socket error: ${error.message}`)
  process.exit(1)
})
