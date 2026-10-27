import { describe, expect, it } from 'vitest'
import { PROMPTS, bucketOf, speechEndSample, charErrors, eer, formatLabels, insideRepo, normaliseEt, parseLabels, percentile, promptsFor, rate, ratesAt, rowsFromCaptureLog, sumCounts, wilson, wordErrors } from './measure.ts'
import type { LabelRow } from './measure.ts'

describe('normaliseEt', () => {
  it('lower-cases, keeps Estonian letters, drops punctuation and quotes', () => {
    expect(normaliseEt('Ütle, mine YouTube’i!')).toBe('ütle mine youtubei')
    expect(normaliseEt('Ta ütles „ütle”.')).toBe('ta ütles ütle')
    expect(normaliseEt('ÕUN ja ŠOKOLAAD')).toBe('õun ja šokolaad')
  })
  it('spells digits one by one and splits hyphens', () => {
    expect(normaliseEt('5551234')).toBe('viis viis viis üks kaks kolm neli')
    expect(normaliseEt('e-mail')).toBe('e mail')
  })
})

describe('wordErrors and charErrors', () => {
  it('counts substitutions, deletions and insertions over normalised words', () => {
    expect(wordErrors('Mine emaili.', 'mina emaili')).toEqual({ errors: 1, units: 2 })
    expect(wordErrors('Ütle, mine.', 'Ütlemine')).toEqual({ errors: 2, units: 2 })
    expect(wordErrors('Keri alla', 'keri alla palun')).toEqual({ errors: 1, units: 2 })
    expect(wordErrors('Keri alla', '')).toEqual({ errors: 2, units: 2 })
    expect(wordErrors('Minu number on 555', 'minu number on viis viis viis')).toEqual({ errors: 0, units: 6 })
  })
  it('CER counts characters including the space', () => {
    expect(charErrors('jah', 'ja')).toEqual({ errors: 1, units: 3 })
    expect(charErrors('ütle mine', 'ütlemine')).toEqual({ errors: 1, units: 9 })
  })
  it('a total rate is summed errors over summed units', () => {
    const total = sumCounts([
      { errors: 1, units: 2 },
      { errors: 0, units: 8 },
    ])
    expect(rate(total)).toBeCloseTo(0.1)
    expect(rate({ errors: 0, units: 0 })).toBe(0)
    expect(rate({ errors: 2, units: 0 })).toBe(1)
  })
})

describe('statistics', () => {
  it('percentile interpolates between ranks', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5)
    expect(percentile([10], 95)).toBe(10)
    expect(percentile([0, 100], 95)).toBe(95)
    expect(Number.isNaN(percentile([], 50))).toBe(true)
  })
  it('Wilson interval matches the textbook value', () => {
    const ci = wilson(1, 10)
    expect(ci.low).toBeCloseTo(0.0179, 3)
    expect(ci.high).toBeCloseTo(0.4042, 3)
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 })
  })
  it('FAR and FRR: a score at the threshold passes', () => {
    const r = ratesAt([0.6, 0.5, 0.7], [0.54, 0.2], 0.54)
    expect(r.falseRejects).toBe(1)
    expect(r.falseAccepts).toBe(1)
    expect(r.frr).toBeCloseTo(1 / 3)
    expect(r.far).toBe(0.5)
  })
  it('EER is 0 for separated scores, 0.5 for identical ones', () => {
    const sep = eer([0.8, 0.9], [0.1, 0.2])
    expect(sep.eer).toBe(0)
    expect(sep.bestErrors).toBe(0)
    expect(sep.bestThreshold).toBeGreaterThan(0.2)
    expect(sep.bestThreshold).toBeLessThanOrEqual(0.8)
    expect(eer([0.5, 0.5], [0.5, 0.5]).eer).toBe(0.5)
    expect(Number.isNaN(eer([], [0.1]).eer)).toBe(true)
  })
  it('length buckets follow issue #3', () => {
    expect(bucketOf(0.5)).toBe('<=0.7s')
    expect(bucketOf(0.7)).toBe('<=0.7s')
    expect(bucketOf(0.85)).toBe('0.7-1s')
    expect(bucketOf(1)).toBe('1-2s')
    expect(bucketOf(2)).toBe('1-2s')
    expect(bucketOf(2.01)).toBe('>2s')
  })
})

describe('labels.tsv', () => {
  const rows: LabelRow[] = [
    { file: 'ralf/cmd-01.wav', speaker: 'ralf', reference: 'Keri alla.', addressee: 'ütle', kind: 'command', durationS: 1.234 },
    { file: 'x.wav', speaker: '', reference: 'a\tb', addressee: '', kind: 'other', durationS: 0 },
  ]
  it('round-trips, tabs inside a field become spaces', () => {
    const back = parseLabels(formatLabels(rows))
    expect(back[0]).toEqual({ ...rows[0], durationS: 1.23 })
    expect(back[1]?.reference).toBe('a b')
  })
  it('refuses a wrong header, column count or kind', () => {
    expect(() => parseLabels('file\tspeaker\n')).toThrow(/first line/)
    expect(() => parseLabels(`${formatLabels([])}a.wav\tx\n`)).toThrow(/line 2: 2 columns/)
    expect(() => parseLabels(`${formatLabels([])}a.wav\t\t\t\tnope\t1\n`)).toThrow(/kind "nope"/)
  })
  it('a capture log imports with the speaker and reference blank, never the gate verdict', () => {
    const log = '20261027T101010000-owner-0.612.wav\t0.612\towner\tmina emaili\nnot-a-wav\t0\tnone\tx\n'
    const out = rowsFromCaptureLog(log, () => 1.5)
    expect(out).toHaveLength(1)
    expect(out[0]?.row).toEqual({ file: '20261027T101010000-owner-0.612.wav', speaker: '', reference: '', addressee: '', kind: 'other', durationS: 1.5 })
    expect(out[0]?.heard).toBe('mina emaili')
  })
})

describe('insideRepo', () => {
  it('refuses the repo and anything under it, with either slash and any case on Windows', () => {
    expect(insideRepo('C:\\Users\\ralfs\\utle', 'C:/Users/ralfs/utle', true)).toBe(true)
    expect(insideRepo('c:/users/ralfs/utle/scripts/out', 'C:\\Users\\ralfs\\utle\\', true)).toBe(true)
    expect(insideRepo('C:/Users/ralfs/utle-voice', 'C:/Users/ralfs/utle', true)).toBe(false)
    expect(insideRepo('C:/temp/utle-voice', 'C:/Users/ralfs/utle', true)).toBe(false)
    expect(insideRepo('/home/a/Utle/x', '/home/a/utle', false)).toBe(false)
  })
})

describe('prompts', () => {
  it('hold 10 commands, 10 dictations, the wake cases of issue #2 and the short words of issue #3', () => {
    expect(PROMPTS.filter((p) => p.kind === 'command')).toHaveLength(10)
    expect(PROMPTS.filter((p) => p.kind === 'dictation')).toHaveLength(10)
    const wake = PROMPTS.filter((p) => p.kind === 'wake').map((p) => p.text.toLowerCase())
    expect(wake.some((t) => t.startsWith('ütle,'))).toBe(true)
    expect(wake.some((t) => t.includes('ütlen'))).toBe(true)
    expect(wake.some((t) => t.includes('ütles'))).toBe(true)
    expect(PROMPTS.filter((p) => p.kind === 'short').map((p) => p.text)).toEqual(['Saada.', 'Jah.', 'Üks.'])
    expect(new Set(PROMPTS.map((p) => p.id)).size).toBe(PROMPTS.length)
    expect(promptsFor('short,wake').every((p) => p.kind === 'short' || p.kind === 'wake')).toBe(true)
    expect(() => promptsFor('bogus')).toThrow(/unknown kind/)
  })
})

describe('speechEndSample', () => {
  it('finds the end of the last loud 20 ms window and ignores a noise floor', () => {
    const s = new Float32Array(16000).fill(0.0005)
    for (let i = 3200; i < 8000; i += 1) s[i] = i % 2 === 0 ? 0.2 : -0.2
    expect(speechEndSample(s)).toBe(8000)
    expect(speechEndSample(new Float32Array(1600).fill(0.0005))).toBe(0)
  })
})
