import { describe, expect, it } from 'vitest'
import { SPEND_KEY, SPEND_RING, spendLine, spendRingWith } from './spend.ts'
import type { SpendRecord } from './spend.ts'

const record = (asks: number): SpendRecord => ({ outcome: 'done', asks, steps: 1, goals: 1, input: 10, cacheRead: 6900, output: 40, ms: 900, provider: 'anthropic', model: 'claude-sonnet-5-5' })

describe('round 9 (30.5.4): the spend ring', () => {
  it('spend: the ring keeps the last 200 under utle-spend, the oldest dropped', () => {
    expect(SPEND_KEY).toBe('utle-spend')
    expect(SPEND_RING).toBe(200)
    let ring: SpendRecord[] = []
    for (let i = 1; i <= 205; i += 1) ring = spendRingWith(ring, record(i))
    expect(ring).toHaveLength(200)
    expect(ring[0]?.asks).toBe(6)
    expect(ring.at(-1)?.asks).toBe(205)
  })

  it('spend: anything stored that is not a list starts a fresh ring', () => {
    expect(spendRingWith(undefined, record(1))).toEqual([record(1)])
    expect(spendRingWith({ broken: true }, record(2))).toEqual([record(2)])
  })

  it('spend: the console line has counts and names only', () => {
    expect(spendLine(record(3))).toBe('[spend] outcome=done asks=3 steps=1 goals=1 in=10 cached=6900 out=40 ms=900 provider=anthropic model=claude-sonnet-5-5')
    expect(spendLine({ ...record(0), outcome: 'rules', provider: '', model: '' })).toContain('provider=- model=-')
  })
})
