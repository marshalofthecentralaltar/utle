import { describe, expect, it } from 'vitest'
import { wordErrorRate } from './wer.ts'

describe('wordErrorRate', () => {
  it('is zero for identical text', () => {
    expect(wordErrorRate('Change the budget deadline to Friday.', 'Change the budget deadline to Friday.')).toEqual({
      words: 6,
      errors: 0,
      rate: 0,
    })
  })

  it('ignores case and punctuation', () => {
    expect(wordErrorRate('Not Wednesday. Tuesday.', 'not wednesday tuesday').errors).toBe(0)
  })

  it('counts a substitution', () => {
    expect(wordErrorRate('move risks above next steps', 'move risk above next steps')).toEqual({
      words: 5,
      errors: 1,
      rate: 0.2,
    })
  })

  it('counts a deletion and an insertion as one error each', () => {
    expect(wordErrorRate('one two three four', 'one three four').errors).toBe(1)
    expect(wordErrorRate('one two three', 'one two extra three').errors).toBe(1)
  })

  it('gives rate 1 when nothing was heard', () => {
    expect(wordErrorRate('one two three', '')).toEqual({ words: 3, errors: 3, rate: 1 })
  })

  it('handles an empty expected line', () => {
    expect(wordErrorRate('', '')).toEqual({ words: 0, errors: 0, rate: 0 })
    expect(wordErrorRate('', 'noise')).toEqual({ words: 0, errors: 1, rate: 1 })
  })

  it('keeps Estonian letters', () => {
    expect(wordErrorRate('Mine kokkuvõtte juurde', 'mine kokkuvõtte juurde').errors).toBe(0)
    expect(wordErrorRate('Võta tagasi', 'vota tagasi').errors).toBe(1)
  })

  it('can exceed 1 when far more was heard than expected', () => {
    expect(wordErrorRate('yes', 'yes please do that').rate).toBe(3)
  })
})
