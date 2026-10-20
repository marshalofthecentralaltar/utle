/**
 * Streams a 16 kHz mono wav to a recogniser socket the way the extension does (src/speech/local.ts):
 * 100 ms frames of float32 samples, in real time, then a second and a half of silence and a flush.
 * Prints every partial and final with its time, and the time from the last frame of speech sent to
 * the last final. Works against the dev server, `npm run serve`, the container and a hosted wss://
 * address; the token goes in the address (`?token=`), as the extension sends it.
 *
 *   npx tsx scripts/asr-client.ts ws://localhost:5173/api/asr scripts/fixtures/et-dictate-send-16k.wav
 *   npx tsx scripts/asr-client.ts "wss://<host>/api/asr?token=<token>" scripts/fixtures/et-dictate-send-16k.wav
 *
 *   add `--enrol 8` to learn the caller's voice from the first 8 s of speech first (writes that token's profile)
 *
 * Exits 0 when at least one final came back, 1 otherwise (2 for a refused or failed connection).
 */
import { WebSocket } from 'ws'
import { ASR_FRAME_SAMPLES, ASR_SAMPLE_RATE, parseAsrMessage } from '../src/speech/asrProtocol.ts'
import { readPcmWav } from './wav.ts'

const args = process.argv.slice(2)
const enrolAt = args.indexOf('--enrol')
const enrolSeconds = enrolAt === -1 ? 0 : Number(args.splice(enrolAt, 2)[1])
const [url, wav] = args
if (url === undefined || wav === undefined) {
  console.error('usage: npx tsx scripts/asr-client.ts <ws(s)://host/api/asr[?token=…]> <16 kHz mono wav>')
  process.exit(2)
}

const FRAME_MS = (ASR_FRAME_SAMPLES * 1000) / ASR_SAMPLE_RATE
const TRAILING_SILENCE_MS = 1500
/** After the flush, how long to wait for the last final. */
const FINAL_WAIT_MS = 8000
const SILENCE = 1e-3

const { rate, samples } = readPcmWav(wav)
if (rate !== ASR_SAMPLE_RATE) throw new Error(`the wav must be ${ASR_SAMPLE_RATE} Hz, it is ${rate}`)
let lastSpeech = 0
for (let i = 0; i < samples.length; i += 1) if (Math.abs(samples[i] ?? 0) > SILENCE) lastSpeech = i
const lastSpeechFrame = Math.floor(lastSpeech / ASR_FRAME_SAMPLES)

const frames: Float32Array<ArrayBuffer>[] = []
for (let at = 0; at < samples.length; at += ASR_FRAME_SAMPLES) {
  const frame = new Float32Array(ASR_FRAME_SAMPLES)
  frame.set(samples.subarray(at, Math.min(at + ASR_FRAME_SAMPLES, samples.length)))
  frames.push(frame)
}
for (let i = 0; i < TRAILING_SILENCE_MS / FRAME_MS; i += 1) frames.push(new Float32Array(ASR_FRAME_SAMPLES))

const shown = url.replace(/token=[^&]*/, 'token=…')
console.log(`${shown}: ${(samples.length / ASR_SAMPLE_RATE).toFixed(1)} s of audio in ${frames.length} frames of ${FRAME_MS} ms`)

const opened = Date.now()
const stamp = (): string => `${String(Date.now() - opened).padStart(6)} ms`
const finals: string[] = []
let partials = 0
let speechSentAt = 0
let lastFinalAt = 0
let readyAt = 0
let finished = false

const ws = new WebSocket(url)
ws.binaryType = 'arraybuffer'

const finish = (code: number): void => {
  if (finished) return
  finished = true
  ws.close()
  console.log(`\nconnect to ready: ${readyAt === 0 ? '(never)' : `${readyAt - opened} ms`}`)
  console.log(`partials: ${partials}, finals: ${finals.length}`)
  if (lastFinalAt > 0 && speechSentAt > 0) console.log(`last speech frame sent to last final: ${lastFinalAt - speechSentAt} ms (includes the recogniser's 1000 ms endpoint silence)`)
  console.log(`final text: ${JSON.stringify(finals.join(' '))}`)
  process.exit(code)
}

ws.on('unexpected-response', (_req, res) => {
  console.error(`${stamp()}  refused: HTTP ${res.statusCode ?? 0}`)
  finished = true
  process.exit(2)
})
ws.on('error', (error) => {
  if (finished) return
  console.error(`${stamp()}  socket error: ${error.message}`)
  finished = true
  process.exit(2)
})
ws.on('close', (code) => {
  if (!finished) console.log(`${stamp()}  closed by the server, code ${code}`)
  finish(finals.length > 0 ? 0 : 1)
})

ws.on('message', (data: ArrayBuffer | Buffer, isBinary: boolean) => {
  if (isBinary) return
  const message = parseAsrMessage(data.toString())
  if (message === null) return
  switch (message.type) {
    case 'ready': {
      readyAt = Date.now()
      console.log(`${stamp()}  ready`)
      if (enrolSeconds > 0) ws.send(JSON.stringify({ type: 'enrol', seconds: enrolSeconds }))
      let next = 0
      const timer = setInterval(() => {
        const frame = frames[next]
        if (frame === undefined) {
          clearInterval(timer)
          ws.send(JSON.stringify({ type: 'flush' }))
          console.log(`${stamp()}  flush sent`)
          setTimeout(() => finish(finals.length > 0 ? 0 : 1), FINAL_WAIT_MS)
          return
        }
        ws.send(frame.buffer)
        if (next === lastSpeechFrame) speechSentAt = Date.now()
        next += 1
      }, FRAME_MS)
      return
    }
    case 'unavailable':
      console.log(`${stamp()}  unavailable: ${message.reason}`)
      finish(1)
      return
    case 'partial':
      partials += 1
      console.log(`${stamp()}  partial ${JSON.stringify(message.text)}`)
      return
    case 'final':
      if (message.text.trim() === '') return
      finals.push(message.text)
      lastFinalAt = Date.now()
      console.log(`${stamp()}  FINAL   ${JSON.stringify(message.text)}${message.speaker ? ` (${message.speaker})` : ''}`)
      return
    case 'lag':
      if (message.ms > 0) console.log(`${stamp()}  server ${message.ms} ms behind`)
      return
    case 'enrolled':
      console.log(`${stamp()}  enrolled ${message.ok ? 'ok' : 'failed'} (${message.seconds} s)`)
      return
  }
})
