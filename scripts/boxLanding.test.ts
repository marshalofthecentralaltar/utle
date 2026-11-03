import { describe, expect, it } from 'vitest'
import { boxLanding } from './boxLanding.ts'

const SENTENCE = 'Tere, Mari, ma jõuan homme kell kolm.'
const s = (t: number, box: string) => ({ t, box })

describe('boxLanding (voice.ts section 1, check 1)', () => {
  it('a sent sentence that came whole: landed at its first sample, no previews', () => {
    const r = boxLanding([s(0, ''), s(100, ''), s(200, SENTENCE), s(300, SENTENCE), s(400, '')], SENTENCE)
    expect(r.at).toBe(200)
    expect(r.previews).toEqual([])
  })

  it('a sent sentence typed word by word: the partial values are previews', () => {
    const r = boxLanding([s(0, 'Tere'), s(100, 'Tere, Mari'), s(200, SENTENCE), s(300, '')], SENTENCE)
    expect(r.at).toBe(200)
    expect(r.previews).toEqual(['Tere', 'Tere, Mari'])
  })

  it('nothing sent (the send word lost), the sentence came whole: it landed, no previews', () => {
    const r = boxLanding([s(0, ''), s(100, SENTENCE), s(200, SENTENCE), s(300, SENTENCE)], '')
    expect(r.text).toBe(SENTENCE)
    expect(r.at).toBe(100)
    expect(r.previews).toEqual([])
  })

  it('nothing sent, the sentence typed word by word: still previews', () => {
    const r = boxLanding([s(0, 'Tere'), s(100, 'Tere, Mari'), s(200, SENTENCE), s(300, SENTENCE)], '')
    expect(r.at).toBe(200)
    expect(r.previews).toEqual(['Tere', 'Tere, Mari'])
  })

  it('nothing sent and the box stayed empty: no landing, no previews', () => {
    const r = boxLanding([s(0, ''), s(100, ''), s(200, '')], '')
    expect(r.text).toBe('')
    expect(Number.isNaN(r.at)).toBe(true)
    expect(r.previews).toEqual([])
  })
})
