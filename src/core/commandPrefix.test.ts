import { describe, expect, it } from 'vitest'
import { COMMAND_FORMS, extendsCommand } from './commandPrefix.ts'

describe('a command that a longer command starts with (round 10, #7, 33.3)', () => {
  const ROWS: Array<[string, boolean]> = [
    // The timed scroll (33.4) and the seek by an amount (29.1): keri + a direction, then anything.
    ['keri alla', true],
    ['Keri üles.', true],
    ['keri allapoole', true],
    ['keri aeglaselt alla', true],
    ['keri tasa üles', true],
    ['keri edasi', true],
    ['keri tagasi', true],
    // Help-page phrases that a longer help-page phrase goes on from.
    ['saada', true],
    ['abi', true],
    ['stopp', true],
    ['kirjuta Marile', true],
    // Whole commands nothing longer starts with: released early as before.
    ['vaigista', false],
    ['keri natuke alla', false],
    ['keri alla kaks minutit', false],
    ['saada ära', false],
    ['näita numbreid', false],
    // Whole words only, and nothing at all.
    ['keri all', false],
    ['saad', false],
    ['tere Karin', false],
    ['', false],
  ]
  it.each(ROWS)('"%s" -> %s', (text, expected) => {
    expect(extendsCommand(text)).toBe(expected)
  })

  it('the phrases are the help page\'s Estonian forms, so a phrase added there is covered with no more code', () => {
    expect(COMMAND_FORMS).toContain('keri alla kaks minutit')
    expect(COMMAND_FORMS).toContain('saada ära')
    const withBack = [...COMMAND_FORMS, 'mine tagasi sinna kus ma olin']
    expect(extendsCommand('mine tagasi', withBack)).toBe(true)
    expect(extendsCommand('mine tagasi sinna kus ma olin', withBack)).toBe(false)
  })
})
