/**
 * Turns a TartuNLP text-to-speech wav (32-bit float, 22050 Hz, mono) into a recogniser fixture:
 * 16-bit PCM at 16 kHz with 0.3 s of silence before and 1.7 s after, so the endpoint rule fires.
 *
 *   curl -X POST -H "Content-Type: application/json" --data-binary @body.json \
 *     https://api.tartunlp.ai/text-to-speech/v2 -o tts.wav      (body: {"text":"Jah.","speaker":"mari","speed":1})
 *   npx tsx scripts/fixture.ts tts.wav scripts/fixtures/et-jah-16k.wav
 *
 * More recordings can follow, each after a pause in seconds, into one fixture:
 *   npx tsx scripts/fixture.ts first.wav out.wav 3 second.wav
 * and --lead <s> sets the silence before the first one (default 0.3 s).
 */
import { readFileSync, writeFileSync } from 'node:fs'

// --lead <s> changes the silence before the first recording (default 0.3 s).
const argv = process.argv.slice(2)
const leadAt = argv.indexOf('--lead')
const LEAD = leadAt === -1 ? 0.3 : Number(argv.splice(leadAt, 2)[1])
const [input, output, ...rest] = argv
if (!input || !output || rest.length % 2 !== 0) throw new Error('usage: fixture.ts <in.wav> <out.wav> [<pause s> <in.wav>]...')

const OUT = 16000

/** A TartuNLP wav (32-bit float) resampled to 16 kHz. */
function decode(path: string): Float32Array {
  const buf = readFileSync(path)
  let p = 12
  let rate = 0
  let format = 0
  let data: Buffer | null = null
  while (p < buf.length - 8) {
    const id = buf.toString('ascii', p, p + 4)
    const size = buf.readUInt32LE(p + 4)
    if (id === 'fmt ') {
      format = buf.readUInt16LE(p + 8)
      rate = buf.readUInt32LE(p + 12)
    }
    if (id === 'data') {
      data = buf.subarray(p + 8, p + 8 + size)
      break
    }
    p += 8 + size + (size % 2)
  }
  if (!data || format !== 3) throw new Error(`expected a 32-bit float wav: ${path}`)
  const n = data.length / 4
  const source = new Float32Array(n)
  for (let i = 0; i < n; i += 1) source[i] = data.readFloatLE(i * 4)
  const length = Math.floor((n * OUT) / rate)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const x = (i * rate) / OUT
    const k = Math.floor(x)
    const f = x - k
    out[i] = (source[k] ?? 0) * (1 - f) + (source[k + 1] ?? 0) * f
  }
  return out
}

const parts: Float32Array[] = [new Float32Array(Math.round(LEAD * OUT)), decode(input)]
for (let i = 0; i < rest.length; i += 2) {
  parts.push(new Float32Array(Math.round(Number(rest[i]) * OUT)), decode(rest[i + 1] ?? ''))
}
parts.push(new Float32Array(Math.round(1.7 * OUT)))
const total = parts.reduce((sum, part) => sum + part.length, 0)
const pcm = Buffer.alloc(total * 2)
let at = 0
for (const part of parts) {
  for (const v of part) {
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), at * 2)
    at += 1
  }
}
const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + pcm.length, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20)
header.writeUInt16LE(1, 22)
header.writeUInt32LE(OUT, 24)
header.writeUInt32LE(OUT * 2, 28)
header.writeUInt16LE(2, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36)
header.writeUInt32LE(pcm.length, 40)
writeFileSync(output, Buffer.concat([header, pcm]))
console.log(`${output}: ${(total / OUT).toFixed(2)} s, ${header.length + pcm.length} bytes`)
