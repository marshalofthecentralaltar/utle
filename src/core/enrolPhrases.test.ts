import { describe, expect, it } from 'vitest'
import { BROWSER_PHRASES } from './browserIntent.ts'
import { ENROL_COMMAND_WORDS, ENROL_PHRASES, ENROL_VOWEL_LENGTHS, phraseWords } from './enrolPhrases.ts'

const words = new Set(ENROL_PHRASES.flatMap(phraseWords))
const text = ENROL_PHRASES.join(' ').toLowerCase()

describe('scripted enrolment phrases (round 7)', () => {
  it('are at least 12 short sentences', () => {
    expect(ENROL_PHRASES.length).toBeGreaterThanOrEqual(12)
    for (const phrase of ENROL_PHRASES) {
      expect(phraseWords(phrase).length).toBeGreaterThanOrEqual(3)
      expect(phraseWords(phrase).length).toBeLessThanOrEqual(12)
    }
    expect(new Set(ENROL_PHRASES).size).toBe(ENROL_PHRASES.length)
  })

  it('hold õ, ä, ö and ü', () => {
    for (const letter of ['õ', 'ä', 'ö', 'ü']) expect(text).toContain(letter)
  })

  it('hold short, long and overlong vowels', () => {
    for (const list of Object.values(ENROL_VOWEL_LENGTHS)) for (const word of list) expect(words.has(word), word).toBe(true)
    // Long and overlong are written with a double vowel; at least five different ones appear.
    const doubles = ['aa', 'ee', 'ii', 'oo', 'uu', 'õõ', 'ää', 'öö', 'üü'].filter((pair) => text.includes(pair))
    expect(doubles.length).toBeGreaterThanOrEqual(5)
  })

  it('hold every command word, ava, keri, saada, kustuta, tagasi, valmis, katkesta and uus leht among them', () => {
    for (const word of ENROL_COMMAND_WORDS) expect(words.has(word), word).toBe(true)
    for (const word of ['ava', 'keri', 'saada', 'kustuta', 'tagasi', 'valmis', 'katkesta']) expect(ENROL_COMMAND_WORDS).toContain(word)
    expect(text).toContain('uus leht')
  })

  it("take the command words from the browser's own tables, or the engine's three", () => {
    const browserWords = new Set(BROWSER_PHRASES.flatMap(phraseWords))
    const engineWords = new Set(['saada', 'valmis', 'katkesta'])
    for (const word of ENROL_COMMAND_WORDS) expect(browserWords.has(word) || engineWords.has(word), word).toBe(true)
  })

  it("cover the heads of the browser's Estonian commands", () => {
    // Every browser phrase that starts with one of these heads has its head in the phrases.
    const heads = ['ava', 'keri', 'sulge', 'näita', 'peida', 'tühjenda', 'kustuta', 'mängi', 'suurenda', 'vähenda', 'värskenda', 'lõpeta', 'salvesta', 'lisa']
    for (const head of heads) {
      expect(BROWSER_PHRASES.some((p) => p.startsWith(`${head} `) || p === head), head).toBe(true)
      expect(words.has(head), head).toBe(true)
    }
  })
})
