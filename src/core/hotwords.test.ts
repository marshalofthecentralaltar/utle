import { describe, expect, it } from 'vitest'
import { bpeVocabFromTokens, hotwordPhrases, hotwordsText, isEnglishPhrase } from './hotwords.ts'

describe('hotwords (28.1)', () => {
  const phrases = hotwordPhrases()

  it('holds the Estonian commands the recogniser most needs', () => {
    for (const p of ['saada', 'keri alla', 'keri üles', 'järgmine vaheleht', 'ava uus vaheleht', 'näita numbreid', 'kustuta see', 'tagasi', 'katkesta', 'kirjuta siia', 'võta tagasi', 'heli vaiksemaks']) {
      expect(phrases, p).toContain(p)
    }
  })

  it('holds the site names as written, not their sound-alike spellings', () => {
    for (const p of ['youtube', 'whatsapp', 'facebook', 'delfi', 'postimees']) expect(phrases, p).toContain(p)
    for (const p of ['juutuba', 'vatsap', 'guugel', 'whats app']) expect(phrases, p).not.toContain(p)
  })

  it('leaves out the English phrases', () => {
    for (const p of ['scroll down', 'send it', 'new tab', 'go to the end', 'delete this', 'close', 'write in digits', 'question mark', 'start again']) {
      expect(isEnglishPhrase(p), p).toBe(true)
      expect(phrases, p).not.toContain(p)
    }
    // An Estonian phrase with one borrowed word stays.
    expect(phrases).toContain('lisa uus email')
  })

  it('is lowercase plain words, each once, sorted', () => {
    expect(phrases.length).toBeGreaterThan(150)
    expect(new Set(phrases).size).toBe(phrases.length)
    expect([...phrases].sort()).toEqual(phrases)
    for (const p of phrases) expect(p, p).toMatch(/^[\p{Ll}\p{N}]+( [\p{Ll}\p{N}]+)*$/u)
  })

  it('the file is one phrase per line', () => {
    expect(hotwordsText(['keri alla', 'saada'])).toBe('keri alla\nsaada\n')
  })

  it('the vocabulary: piece and -ln(id), without the blank, the specials and the disambiguation ids', () => {
    const tokens = '<blk> 0\n<sos/eos> 1\n<unk> 2\n, 3\n▁on 8\n▁saada 628\n#0 1100\r\n'
    expect(bpeVocabFromTokens(tokens)).toBe(`,\t${(-Math.log(3)).toFixed(4)}\n▁on\t${(-Math.log(8)).toFixed(4)}\n▁saada\t${(-Math.log(628)).toFixed(4)}\n`)
  })
})
