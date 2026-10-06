import { describe, expect, it } from 'vitest'
import { CONNECTIVE_HOLD_MS, chainLine, endsWithConnective, firstGoal, hasConnective, startsWithConnective } from './chain.ts'

describe('connectives (round 4)', () => {
  it.each(['mine whatsappi ja', 'ava Karin siis', 'keri alla ja siis', 'otsi kassivideod, pärast seda', 'mängi esimene seejärel', 'ava youtube ning', 'open youtube then', 'open youtube and then', 'search cats, after that'])(
    '"%s" ends with a connective',
    (text) => {
      expect(endsWithConnective(text)).toBe(true)
    },
  )

  it.each(['mine whatsappi', 'jah', 'ta on siis seal', 'ja', 'siis', '', '   '])('"%s" does not end with one that joins', (text) => {
    // A bare connective is not a trailing one: there is nothing before it to join.
    expect(endsWithConnective(text)).toBe(false)
  })

  it('ignores trailing punctuation and case', () => {
    expect(endsWithConnective('Mine whatsappi JA.')).toBe(true)
    expect(endsWithConnective('mine whatsappi ja…')).toBe(true)
  })

  it.each(['siis ava Karin', 'ja siis kustuta see', 'Seejärel saada', 'pärast seda keri alla', 'then play it', 'Then, play it'])('"%s" starts with a connective', (text) => {
    expect(startsWithConnective(text)).toBe(true)
  })

  it.each(['ja kustuta see', 'and then play', 'siis', 'ava Karin', 'siiski tulen', 'thenceforth'])('"%s" does not start a continuation', (text) => {
    // "ja" alone at the start is too common in speech to mean a continuation; "siis" alone has nothing after it.
    expect(startsWithConnective(text)).toBe(false)
  })

  it('holds a connective-ending final for 2.5 s', () => {
    expect(CONNECTIVE_HOLD_MS).toBe(2500)
  })

  // Round 5: care. A connective anywhere after the first word means the utterance may hold several goals.
  it.each(['mine whatsappi ja ava Karin', 'keri alla siis', 'Mine youtube\'i, seejärel otsi kassid', 'open youtube and then play', 'tulen homme ja toon leiba', 'mine whatsappi ja'])('"%s" has a connective', (text) => {
    expect(hasConnective(text)).toBe(true)
  })

  it.each(['ja', 'siis ava Karin', 'mine whatsappi', 'jah', '', 'siiski tulen', 'Jaan tuleb'])('"%s" has none that joins', (text) => {
    // A connective with nothing before it joins nothing; "siiski" and "Jaan" are not "siis" and "ja".
    expect(hasConnective(text)).toBe(false)
  })
})

describe('firstGoal', () => {
  it('is the utterance up to the first planned goal, without the joining words', () => {
    expect(firstGoal("mine youtube'i otsi kassivideod mängi esimene ja pane heli vaiksemaks", ['otsi kassivideod', 'mängi esimene', 'pane heli vaiksemaks'], 'lähen youtube')).toBe("mine youtube'i")
    expect(firstGoal('mine whatsappi, ava Karini viimane sõnum, kustuta see kõigi jaoks', ['ava Karini viimane sõnum', 'kustuta see kõigi jaoks'], '')).toBe('mine whatsappi')
    expect(firstGoal('mine whatsappi ja siis ava Karin', ['ava Karin'], '')).toBe('mine whatsappi')
  })

  it('matches the planned goal through case and punctuation', () => {
    expect(firstGoal("Mine YouTube'i ja otsi kassivideod.", ['Otsi kassivideod'], '')).toBe("Mine YouTube'i")
  })

  it('falls back to the say, then to the utterance, when the plan is not in his words', () => {
    expect(firstGoal('mine youtube ja otsi kassid', ['search for cats'], 'lähen youtube')).toBe('lähen youtube')
    expect(firstGoal('mine youtube ja otsi kassid', ['search for cats'], '')).toBe('mine youtube ja otsi kassid')
  })

  it('never answers an empty goal when the plan starts the utterance', () => {
    expect(firstGoal('otsi kassid', ['otsi kassid'], 'otsin')).toBe('otsin')
  })
})

describe('chainLine', () => {
  it('shows the goal and where it stands', () => {
    expect(chainLine({ original: 'x', completed: ['mine whatsappi'], goal: 'ava Karini viimane sõnum', remaining: ['kustuta see', 'saada'] })).toBe('2/4 · ava Karini viimane sõnum')
    expect(chainLine({ original: 'x', completed: [], goal: 'mine whatsappi', remaining: ['ava Karin'] })).toBe('1/2 · mine whatsappi')
  })
})
