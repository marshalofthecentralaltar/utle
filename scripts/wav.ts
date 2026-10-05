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
