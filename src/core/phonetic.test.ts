import { describe, expect, it } from 'vitest'
import { keyDistance, phoneticKey, phoneticStem, soundsLike } from './phonetic.ts'

describe('phoneticKey', () => {
  it.each([
    ['Keeri', 'keri'],
    ['saada', 'sata'],
    ['sada', 'sata'],
    ['alla', 'ala'],
    ['whatsapp', 'vatsap'],
    ['vatsap', 'vatsap'],
    ["youtube'i", 'ioutupei'],
    ['google', 'kokle'],
    ['gugel', 'kukel'],
    ['facebook', 'fakepok'],
    ['messendžer', 'mesentser'],
    ['Šokolaad', 'sokolat'],
    ['quiz', 'kuis'],
    ['extra', 'ekstra'],
    ['fäisbuk', 'fäispuk'],
    ['', ''],
  ])('%s -> %s', (word, key) => {
    expect(phoneticKey(word)).toBe(key)
  })
})

describe('phoneticStem', () => {
  it.each([
    ['youtubei', 'ioutupe'],
    ['googlesse', 'kokle'],
    ['delfist', 'telfi'],
    ['whatsappile', 'vatsapi'],
    ['avage', 'ava'],
    ['saadake', 'sata'],
    // Too little would be left: the word stays whole.
    ['keri', 'ker'],
    ['sse', 'se'],
    ['ke', 'ke'],
  ])('%s -> %s', (word, stem) => {
    expect(phoneticStem(word)).toBe(stem)
  })
})

describe('keyDistance', () => {
  it('counts a change, an insertion, a deletion and a swap as one', () => {
    expect(keyDistance('keri', 'keri', 2)).toBe(0)
    expect(keyDistance('keri', 'kari', 2)).toBe(1)
    expect(keyDistance('keri', 'kerie', 2)).toBe(1)
    expect(keyDistance('keri', 'kri', 2)).toBe(1)
    expect(keyDistance('keri', 'kire', 2)).toBe(2)
    expect(keyDistance('keri', 'krei', 2)).toBe(1)
    expect(keyDistance('ab', 'abcdef', 2)).toBe(3)
  })
})

describe('soundsLike', () => {
  it.each([
    ['juutuba', 'juutuub'],
    ['jutuub', 'juutuub'],
    ['uutuub', 'juutuub'],
    ['keeri', 'keri'],
    ['ala', 'alla'],
    ['aga', 'ava'],
    ['vatsap', 'whatsapp'],
    ['vatsapp', 'whatsapp'],
    ['votsap', 'whatsapp'],
    ['gugel', 'guugel'],
    ['youtubei', 'youtube'],
    ['delfist', 'delfi'],
    ['postimehesse', 'postimehe'],
    ['saadake', 'saada'],
    ['sada', 'saada'],
    ['mina', 'mine'],
    ['natuge', 'natuke'],
    ['kerri', 'keri'],
    ['numbreit', 'numbrid'],
  ])('"%s" sounds like "%s"', (heard, target) => {
    expect(soundsLike(heard, target)).toBe(true)
  })

  it.each([
    ['kass', 'keri'],
    ['kass', 'kast'],
    ['aitäh', 'aitab'],
    ['tere', 'keri'],
    ['ära', 'ava'],
    ['ega', 'ava'],
    ['koju', 'koos'],
    ['', 'ava'],
    ['ava', ''],
    ['uks', 'uus'],
  ])('"%s" does not sound like "%s"', (heard, target) => {
    expect(soundsLike(heard, target)).toBe(false)
  })
})
