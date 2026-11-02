import { describe, expect, it } from 'vitest'
import { formsOf, labelOf, poissonUpper } from './kws-forms.ts'

describe('formsOf: every form of the verb "ütlema / öelda" in a transcript', () => {
  it('finds the wake form, its relatives and the öel- stem, case-insensitively', () => {
    expect(formsOf('Ütle, ava YouTube.')).toEqual(['ütle'])
    expect(formsOf('Ta ütles, et ma ei ütle midagi.')).toEqual(['ütles', 'ütle'])
    expect(formsOf('Seda on raske ütelda, öeldi eile.')).toEqual(['ütelda', 'öeldi'])
    expect(formsOf('Ma tahan öelda, et väljaütlemine oli hea.')).toEqual(['öelda', 'väljaütlemine'])
  })
  it('leaves out words that only contain the letters', () => {
    expect(formsOf('Templirüütlite ööelu ja Ülle hüütud nimi.')).toEqual([])
    expect(formsOf('Mine üle tee.')).toEqual([])
  })
})

describe('labelOf: one label per clip', () => {
  it('wake: the bare form "ütle", wherever it is', () => {
    expect(labelOf('Ütle talle, et ma tulen.')).toBe('wake')
    expect(labelOf('Ma ei ütle seda.')).toBe('wake')
  })
  it('literal: the word quoted or named as a word', () => {
    expect(labelOf('Ta ütles „ütle“ kaks korda.')).toBe('literal')
    expect(labelOf('Kirjuta sõna ütle.')).toBe('literal')
  })
  it('relative: another form of the ütl- / ütel- stem; kin: only the öel- stem; none: no form', () => {
    expect(labelOf('Ta ütles, et tuleb.')).toBe('relative')
    expect(labelOf('Seda on raske ütelda.')).toBe('relative')
    expect(labelOf('Ma tahan öelda üht asja.')).toBe('kin')
    expect(labelOf('Täna on ilus ilm.')).toBe('none')
  })
})

describe('poissonUpper: the one-sided 95 % upper bound of a Poisson count', () => {
  it('is about 3.0 for no events and 4.74 for one', () => {
    expect(poissonUpper(0)).toBeCloseTo(2.996, 2)
    expect(poissonUpper(1)).toBeCloseTo(4.744, 2)
    expect(poissonUpper(5)).toBeCloseTo(10.513, 2)
  })
})
