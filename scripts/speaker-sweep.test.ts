import { describe, expect, it } from 'vitest'
import { bucketOf } from './measure.ts'
import { speechSecondsOf } from './speaker-sweep.ts'

describe('speechSecondsOf', () => {
  it('a 1.8 s clip with 0.45 s of speech counts as 0.45 s and buckets as <=0.7s', () => {
    const samples = new Float32Array(Math.round(1.8 * 16000)).fill(0.0005)
    // 0.45 s of loud speech, starting on a 100 ms frame boundary plus 50 ms: 4 whole frames and half of a fifth.
    for (let i = 8000; i < 8000 + 0.45 * 16000; i += 1) samples[i] = i % 2 === 0 ? 0.2 : -0.2
    const seconds = speechSecondsOf(samples)
    expect(seconds).toBeGreaterThan(0.39)
    expect(seconds).toBeLessThanOrEqual(0.5)
    expect(samples.length / 16000).toBeCloseTo(1.8)
    expect(bucketOf(seconds)).toBe('<=0.7s')
  })
})
