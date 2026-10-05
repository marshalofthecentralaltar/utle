/**
 * Turns a TartuNLP text-to-speech wav (32-bit float, 22050 Hz, mono) into a recogniser fixture:
 * 16-bit PCM at 16 kHz with 0.3 s of silence before and 1.7 s after, so the endpoint rule fires.
 *
 *   curl -X POST -H "Content-Type: application/json" --data-binary @body.json \
 *     https://api.tartunlp.ai/text-to-speech/v2 -o tts.wav      (body: {"text":"Jah.","speaker":"mari","speed":1})
 *   npx tsx scripts/fixture.ts tts.wav scripts/fixtures/et-jah-16k.wav
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error('usage: fixture.ts <in.wav> <out.wav>')
const buf = readFileSync(input)
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
if (!data || format !== 3) throw new Error('expected a 32-bit float wav')
const n = data.length / 4
const source = new Float32Array(n)
for (let i = 0; i < n; i += 1) source[i] = data.readFloatLE(i * 4)

const OUT = 16000
const length = Math.floor((n * OUT) / rate)
const lead = Math.round(0.3 * OUT)
const total = lead + length + Math.round(1.7 * OUT)
const pcm = Buffer.alloc(total * 2)
for (let i = 0; i < length; i += 1) {
  const x = (i * rate) / OUT
  const k = Math.floor(x)
  const f = x - k
  const v = (source[k] ?? 0) * (1 - f) + (source[k + 1] ?? 0) * f
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), (lead + i) * 2)
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
