import { describe, expect, it } from 'vitest'
import { STRINGS } from '../../src/core/strings.ts'
import { phraseLine } from './voiceLines.ts'

describe('the phrase line (round 11, F2)', () => {
  it('says the computer is slow and to wait, never to read the phrase again, in both languages', () => {
    expect(phraseLine('slow', STRINGS.et.strip)).toBe(STRINGS.et.strip.phraseProblem.slow)
    expect(phraseLine('slow', STRINGS.et.strip)).toContain('aeglane')
    expect(phraseLine('slow', STRINGS.et.strip)).not.toContain('uuesti')
    expect(phraseLine('slow', STRINGS.en.strip)).toContain('slow')
    expect(phraseLine('slow', STRINGS.en.strip)).not.toContain('again')
    expect(phraseLine('too_short', STRINGS.et.strip)).toContain('uuesti')
    expect(phraseLine('nonsense', STRINGS.et.strip)).toBe('')
  })
})
