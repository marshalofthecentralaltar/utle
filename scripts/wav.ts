import { readFileSync } from 'node:fs'

/** Reads a mono 16-bit PCM wav into float samples. Enough for the fixtures; not a general reader. */
export function readPcmWav(path: string): { rate: number; samples: Float32Array<ArrayBuffer> } {
  const buf = readFileSync(path)
  let p = 12
  let rate = 0
  let bits = 0
  while (p < buf.length - 8) {
    const id = buf.toString('ascii', p, p + 4)
    const size = buf.readUInt32LE(p + 4)
    if (id === 'fmt ') {
      rate = buf.readUInt32LE(p + 12)
      bits = buf.readUInt16LE(p + 22)
    }
    if (id === 'data') {
      if (bits !== 16) throw new Error(`expected 16-bit PCM, got ${bits}-bit`)
      const count = size / 2
      const samples = new Float32Array(count)
      for (let i = 0; i < count; i += 1) samples[i] = buf.readInt16LE(p + 8 + i * 2) / 32768
      return { rate, samples }
    }
    p += 8 + size + (size % 2)
  }
  throw new Error('no data chunk')
}

/** Reads a mono wav of 16-bit PCM or 32-bit float at any rate (TartuNLP's speech is float at 22 050 Hz). */
export function readAnyWav(path: string): { rate: number; samples: Float32Array<ArrayBuffer> } {
  const buf = readFileSync(path)
  let p = 12
  let rate = 0
  let bits = 0
  let format = 0
  let channels = 1
  while (p < buf.length - 8) {
    const id = buf.toString('ascii', p, p + 4)
    const size = buf.readUInt32LE(p + 4)
    if (id === 'fmt ') {
      format = buf.readUInt16LE(p + 8)
      channels = buf.readUInt16LE(p + 10)
      rate = buf.readUInt32LE(p + 12)
      bits = buf.readUInt16LE(p + 22)
    }
    if (id === 'data') {
      if (channels !== 1) throw new Error(`${path}: expected mono, got ${channels} channels`)
      const width = bits / 8
      const count = Math.floor(size / width)
      const samples = new Float32Array(count)
      for (let i = 0; i < count; i += 1) {
        const at = p + 8 + i * width
        samples[i] = format === 3 && bits === 32 ? buf.readFloatLE(at) : bits === 16 ? buf.readInt16LE(at) / 32768 : Number.NaN
      }
      if (samples.some((x) => Number.isNaN(x))) throw new Error(`${path}: unsupported wav (format ${format}, ${bits}-bit)`)
      return { rate, samples }
    }
    p += 8 + size + (size % 2)
  }
  throw new Error(`${path}: no data chunk`)
}

/** Linear resampling: enough for speech at 16 to 24 kHz and for the pitch-shifted negative. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array<ArrayBuffer> {
  const length = Math.floor((samples.length * to) / from)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const x = (i * from) / to
    const k = Math.floor(x)
    const f = x - k
    out[i] = (samples[k] ?? 0) * (1 - f) + (samples[k + 1] ?? 0) * f
  }
  return out
}
