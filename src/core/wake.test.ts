import { describe, expect, it } from 'vitest'
import { createWake, wakeFind, wakeMentioned, wakeStarts, wakeWordFrom } from './wake.ts'

/** Twenty finals without the word: room talk, dictation, commands said to someone else. */
const WITHOUT_WORD = [
  'keri alla',
  'saada',
  'tere Mari',
  'ma tahtsin ütelda et tulen homme',
  'ütlesin talle juba',
  'ütles et tuleb',
  'ütleb ta',
  'mine whatsappi',
  'kas sa kuuled mind',
  'vaata uudiseid',
  'kell on viis',
  'jah',
  'ei',
  'aitäh',
  'pane raadio käima',
  'mis ilm on',
  'ava youtube',
  'see on hea',
  'ma ütlen sulle',
  'okei',
] as const

/** Ten finals with the word first, and what the engine gets. */
const WITH_WORD: ReadonlyArray<readonly [string, string]> = [
  ['Ütle, keri alla', 'keri alla'],
  ['ütle keri alla', 'keri alla'],
  ['ütel keri alla', 'keri alla'],
  ['Üтле, saada', 'saada'],
  ['ütle mine whatsappi', 'mine whatsappi'],
  ['Ütle: vaata uudiseid.', 'vaata uudiseid.'],
  ['ütle, pane raadio käima', 'pane raadio käima'],
  ['ÜTLE ava youtube', 'ava youtube'],
  ['ütle... mis ilm on', 'mis ilm on'],
  ['ütle näita numbreid', 'näita numbreid'],
]

const W = createWake('Ütle')
const anywhere = (final: string): string | null => wakeFind(W, final, true)?.after ?? null
const atStart = (final: string): string | null => wakeFind(W, final, false)?.after ?? null

describe('the wake word at the start (29.4)', () => {
  it('wake: 20 finals without the word are not a wake, anywhere; 10 with it first give the words after it', () => {
    expect(WITHOUT_WORD.filter((f) => anywhere(f) !== null)).toEqual([])
    expect(WITH_WORD.map(([f]) => atStart(f))).toEqual(WITH_WORD.map(([, want]) => want))
  })

  it('phonetic: a letter added is another word (ütles, ütleb, ütlen), Cyrillic look-alikes are read as Latin', () => {
    expect(wakeStarts(W, 'ütles et')).toBeNull()
    expect(wakeStarts(W, 'ütleb')).toBeNull()
    expect(wakeStarts(W, 'ütlen')).toBeNull()
    expect(wakeStarts(W, 'Üтле тере')).toBe('тере')
    expect(wakeStarts(W, 'ütle')).toBe('')
  })

  it('phonetic: a two-word wake word needs both words', () => {
    const two = createWake('Hei arvuti')
    expect(wakeStarts(two, 'hei arvuti keri alla')).toBe('keri alla')
    expect(wakeStarts(two, 'hei, arvuti, keri alla')).toBe('keri alla')
    expect(wakeStarts(two, 'hei keri alla')).toBeNull()
    expect(wakeStarts(two, 'arvuti keri alla')).toBeNull()
    expect(wakeFind(two, 'no nii hei arvuti ava youtube', true)).toEqual({ before: 'no nii', after: 'ava youtube' })
  })

  it('reads the setting: one or two words of letters, else the default', () => {
    expect(wakeWordFrom(undefined)).toBe('Ütle')
    expect(wakeWordFrom('')).toBe('Ütle')
    expect(wakeWordFrom('  Kuule  ')).toBe('Kuule')
    expect(wakeWordFrom('hei   arvuti')).toBe('hei arvuti')
    expect(wakeWordFrom('üks kaks kolm')).toBe('Ütle')
    expect(wakeWordFrom('r2d2')).toBe('Ütle')
    expect(wakeWordFrom(42)).toBe('Ütle')
    expect(wakeWordFrom('Õunapuu')).toBe('Õunapuu')
  })
})

describe('round 10 (#2, limited): the wake word anywhere in a final', () => {
  it('anywhere: the lead-in is dropped, only the words after the word go on', () => {
    expect(wakeFind(W, 'No nii, Ütle, ava YouTube.', true)).toEqual({ before: 'No nii,', after: 'ava YouTube.' })
    expect(anywhere('No kuule, ütle, mine tagasi')).toBe('mine tagasi')
    expect(anywhere('Ma mõtlesin… Ütle.')).toBe('')
    expect(anywhere('ma just mõtlesin et ütle keri alla')).toBe('keri alla')
  })

  it('anywhere: the word said twice is one wake ("ütle ütle ava youtube")', () => {
    expect(anywhere('ütle ütle ava youtube')).toBe('ava youtube')
    expect(anywhere('Ütle. Ütle, keri alla')).toBe('keri alla')
  })

  it('glued: "ütlemine youtube\'i" is the word and "mine youtube\'i"; the rest must start a command', () => {
    expect(anywhere("ütlemine youtube'i")).toBe("mine youtube'i")
    expect(anywhere("Ütlemine youtube'i ja ava video")).toBe("mine youtube'i ja ava video")
    expect(anywhere('no nii ütleava gmail')).toBe('ava gmail')
    expect(anywhere('ütleotsi kassivideod')).toBe('otsi kassivideod')
    expect(anywhere('ütlekeri alla')).toBe('keri alla')
  })

  it('never: ütlen, ütles, ütleb, ütlemine as a noun, ütlemise, ütelda', () => {
    for (const f of [
      'Ma ütlen sulle homme.',
      'ta ütles et tuleb',
      'mida ta ütleb',
      'see ütlemine on raske',
      'ütlemine on hõbe',
      'tema ütlemine',
      'ütlemise viis',
      'ma ei oska ütelda',
      'ütlemine ei aita',
    ]) {
      expect(anywhere(f), f).toBeNull()
    }
  })

  it('literal: "kirjuta ütle", "sõna ütle" and a quoted „ütle” are text, never a wake', () => {
    expect(anywhere('kirjuta ütle')).toBeNull()
    expect(anywhere('Kirjuta siia sõna ütle.')).toBeNull()
    expect(anywhere('ta ütles „ütle” ja läks')).toBeNull()
    expect(anywhere('trüki ütle palun')).toBeNull()
  })

  it('at the start only (an open window): a word inside a sentence is his text, a word after a full stop is a wake', () => {
    expect(atStart('kirjuta Marile et ütle emale tere')).toBeNull()
    expect(atStart('Tere. Ütle, keri alla')).toBe('keri alla')
    expect(atStart("ütlemine youtube'i")).toBe("mine youtube'i")
  })
})

describe('round 10 (#2, 35): the word written anywhere, literal or not (wakeMentioned)', () => {
  const W2 = createWake('Ütle')
  it('finds the word in a literal place, in quotes, inside his sentence and at the start', () => {
    expect(wakeMentioned(W2, 'Kirjuta siia sõna ütle.')).toBe(true)
    expect(wakeMentioned(W2, 'ta ütles „ütle”')).toBe(true)
    expect(wakeMentioned(W2, 'no nii ütle ava youtube')).toBe(true)
    expect(wakeMentioned(W2, 'Ütle.')).toBe(true)
  })
  it('a relative or another word is not the word', () => {
    expect(wakeMentioned(W2, 'Ma ütlen sulle homme.')).toBe(false)
    expect(wakeMentioned(W2, 'ütlemine on hõbe')).toBe(false)
    expect(wakeMentioned(W2, 'Kõik, ava YouTube')).toBe(false)
  })
})
