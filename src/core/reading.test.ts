import { describe, expect, it } from 'vitest'
import { MAX_SENTENCE_CHARS, READ_IDLE, READ_MAX_CHARS, isReadStop, readStep, readingText, splitSentences } from './reading.ts'
import type { ReadEffect, ReadState } from './reading.ts'

describe('reading aloud (29.5): the sentence splitter', () => {
  it('ends a sentence at . ! ? and … followed by a space or the end', () => {
    expect(splitSentences('Tere. Kuidas läheb? Hästi! Ja siis…  Lõpp')).toEqual(['Tere.', 'Kuidas läheb?', 'Hästi!', 'Ja siis…', 'Lõpp'])
  })

  it('keeps closing quotes and brackets with their sentence', () => {
    expect(splitSentences('Ta ütles: „Tule.” Siis läks. (Nii see oli.) Lõpp.')).toEqual(['Ta ütles: „Tule.”', 'Siis läks.', '(Nii see oli.)', 'Lõpp.'])
  })

  it('does not split when the next word begins with a small letter or a digit (nt. kui, 22. oktoobril)', () => {
    expect(splitSentences('Seda tehakse nt. kui sajab. Koosolek on 22. oktoobril kell 10. Tule.')).toEqual(['Seda tehakse nt. kui sajab.', 'Koosolek on 22. oktoobril kell 10.', 'Tule.'])
    expect(splitSentences('Ta tuli 3. kohale. 2. koht jäi tühjaks.')).toEqual(['Ta tuli 3. kohale. 2. koht jäi tühjaks.'])
  })

  it('keeps titles and abbreviations that never end a sentence with the next word, even before a capital', () => {
    expect(splitSentences('Kohtusin dr. Tammega. Vt. Lisa 2. Mr. Smith came. A. Tamm kirjutas.')).toEqual(['Kohtusin dr. Tammega.', 'Vt. Lisa 2.', 'Mr. Smith came.', 'A. Tamm kirjutas.'])
    expect(splitSentences('Näiteks nt. Tallinnas.')).toEqual(['Näiteks nt. Tallinnas.'])
  })

  it('ends a sentence at jne. when a capital follows, and keeps it when a small letter follows', () => {
    expect(splitSentences('Õunad, pirnid jne. Siis tuli talv.')).toEqual(['Õunad, pirnid jne.', 'Siis tuli talv.'])
    expect(splitSentences('Õunad, pirnid jne. ja muu.')).toEqual(['Õunad, pirnid jne. ja muu.'])
  })

  it('never splits a decimal or an address', () => {
    expect(splitSentences('Hind tõusis 3.5 protsenti. Vaata err.ee lehte.')).toEqual(['Hind tõusis 3.5 protsenti.', 'Vaata err.ee lehte.'])
  })

  it('collapses white space and drops empty text', () => {
    expect(splitSentences('  Üks\n\n kaks.   ')).toEqual(['Üks kaks.'])
    expect(splitSentences(' \n ')).toEqual([])
  })

  it(`cuts a sentence over ${MAX_SENTENCE_CHARS} characters at a comma, else a space`, () => {
    const clause = 'see on üks pikk osalause mis kestab ja kestab'
    const long = `${Array.from({ length: 10 }, () => clause).join(', ')}.`
    const parts = splitSentences(long)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(MAX_SENTENCE_CHARS)
    expect(parts[0]?.endsWith(',')).toBe(true)
    expect(parts.join(' ')).toBe(long)
    const words = `${Array.from({ length: 80 }, () => 'sõna').join(' ')}.`
    const cut = splitSentences(words)
    for (const part of cut) expect(part.length).toBeLessThanOrEqual(MAX_SENTENCE_CHARS)
    expect(cut.join(' ')).toBe(words)
  })
})

describe('reading aloud (29.5): the text read', () => {
  it('splits each block on its own, so a heading is a sentence of its own', () => {
    const read = readingText(['Suur uudis', 'Esimene lause. Teine lause.'])
    expect(read.sentences).toEqual(['Suur uudis', 'Esimene lause.', 'Teine lause.'])
    expect(read.text).toBe('Suur uudis\n\nEsimene lause. Teine lause.')
  })

  it(`caps the text at ${READ_MAX_CHARS} characters at a block or sentence boundary`, () => {
    const block = `${'a'.repeat(180)}. ${'b'.repeat(180)}.`
    const read = readingText(Array.from({ length: 80 }, () => block))
    expect(read.text.length).toBeLessThanOrEqual(READ_MAX_CHARS)
    expect(read.text.length).toBeGreaterThan(READ_MAX_CHARS - 400)
    expect(read.sentences.every((s) => s.endsWith('.'))).toBe(true)
    expect(read.sentences.join(' ').length).toBeLessThanOrEqual(READ_MAX_CHARS)
  })

  it('a lead that opens with the headline does not say the headline twice (err.ee, 30.4)', () => {
    const read = readingText(['Veebikasiinode maksulangetus pole seni toonud lubatud lisaraha', 'Veebikasiinode maksulangetus pole seni toonud lubatud lisaraha. Kultuurkapital hoiatab.'])
    expect(read.sentences).toEqual(['Veebikasiinode maksulangetus pole seni toonud lubatud lisaraha', 'Kultuurkapital hoiatab.'])
  })

  it('the same sentence later in the text, not right after, is still read', () => {
    const read = readingText(['Jah.', 'Ei.', 'Jah.'])
    expect(read.sentences).toEqual(['Jah.', 'Ei.', 'Jah.'])
  })

  it('nothing to read: empty', () => {
    expect(readingText(['', '  '])).toEqual({ text: '', sentences: [] })
  })
})

describe('reading aloud (29.5): the stop words while reading', () => {
  it('stopp, aitab, stop, seis, lõpeta and the explicit phrases stop a reading, whatever the case and punctuation', () => {
    for (const said of ['stopp', 'Stopp!', 'aitab', 'Aitab.', 'stop', 'seis', 'lõpeta', 'lõpeta lugemine', 'Stop reading', 'lugemine seis', 'paus', 'Peata.']) expect(isReadStop(said)).toBe(true)
  })
  it('other words do not', () => {
    for (const said of ['loe edasi', 'stopp siia', 'aitäh', 'kirjuta stopp', '']) expect(isReadStop(said)).toBe(false)
  })
})

const run = (events: Parameters<typeof readStep>[1][], from: ReadState = READ_IDLE): { state: ReadState; effects: ReadEffect[][] } => {
  let state = from
  const effects: ReadEffect[][] = []
  for (const event of events) {
    const step = readStep(state, event)
    state = step.state
    effects.push(step.effects)
  }
  return { state, effects }
}

describe('reading aloud (29.5): the reader state machine', () => {
  const three = ['Üks.', 'Kaks.', 'Kolm.']

  it('start speaks the first sentence and turns reading on; each end speaks the next; after the last, reading is off and the line says it ended', () => {
    const { state, effects } = run([{ kind: 'start', sentences: three }, { kind: 'sentenceEnd' }, { kind: 'sentenceEnd' }, { kind: 'sentenceEnd' }])
    expect(effects[0]).toEqual([{ kind: 'reading', on: true }, { kind: 'speak', index: 0, text: 'Üks.' }])
    expect(effects[1]).toEqual([{ kind: 'speak', index: 1, text: 'Kaks.' }])
    expect(effects[2]).toEqual([{ kind: 'speak', index: 2, text: 'Kolm.' }])
    expect(effects[3]).toEqual([{ kind: 'reading', on: false }, { kind: 'line', line: 'ended' }])
    expect(state.phase).toBe('ended')
  })

  it('start with nothing to read does nothing', () => {
    expect(readStep(READ_IDLE, { kind: 'start', sentences: [] })).toEqual({ state: READ_IDLE, effects: [] })
  })

  it('a failed sentence is retried once, then skipped, and the skip line comes once per reading', () => {
    const { state, effects } = run([{ kind: 'start', sentences: three }, { kind: 'sentenceError' }, { kind: 'sentenceError' }, { kind: 'sentenceError' }, { kind: 'sentenceError' }, { kind: 'sentenceEnd' }])
    expect(effects[1]).toEqual([{ kind: 'speak', index: 0, text: 'Üks.' }])
    expect(effects[2]).toEqual([{ kind: 'line', line: 'skipped' }, { kind: 'speak', index: 1, text: 'Kaks.' }])
    expect(effects[3]).toEqual([{ kind: 'speak', index: 1, text: 'Kaks.' }])
    expect(effects[4]).toEqual([{ kind: 'speak', index: 2, text: 'Kolm.' }])
    expect(state.skipped).toBe(2)
    expect(effects[5]).toEqual([{ kind: 'reading', on: false }, { kind: 'line', line: 'ended' }])
  })

  it('a failed retry after a good sentence starts its own count: one retry per sentence', () => {
    const { effects } = run([{ kind: 'start', sentences: three }, { kind: 'sentenceError' }, { kind: 'sentenceEnd' }, { kind: 'sentenceError' }])
    expect(effects[3]).toEqual([{ kind: 'speak', index: 1, text: 'Kaks.' }])
  })

  it('stop while speaking cancels and turns reading off; continue speaks the next sentence of the same text', () => {
    const { state, effects } = run([{ kind: 'start', sentences: three }, { kind: 'stop' }, { kind: 'continue' }])
    expect(effects[1]).toEqual([{ kind: 'cancel' }, { kind: 'reading', on: false }])
    expect(effects[2]).toEqual([{ kind: 'reading', on: true }, { kind: 'speak', index: 1, text: 'Kaks.' }])
    expect(state.phase).toBe('speaking')
  })

  it('continue with nothing after the stopped sentence, from idle or after the end does nothing (the command says it ended)', () => {
    const stoppedLast = run([{ kind: 'start', sentences: ['Ainus.'] }, { kind: 'stop' }]).state
    expect(readStep(stoppedLast, { kind: 'continue' }).effects).toEqual([])
    expect(readStep(READ_IDLE, { kind: 'continue' }).effects).toEqual([])
    const ended = run([{ kind: 'start', sentences: ['Ainus.'] }, { kind: 'sentenceEnd' }]).state
    expect(readStep(ended, { kind: 'continue' }).effects).toEqual([])
  })

  it('stop when not reading does nothing; events after a stop are ignored', () => {
    expect(readStep(READ_IDLE, { kind: 'stop' }).effects).toEqual([])
    const stopped = run([{ kind: 'start', sentences: three }, { kind: 'stop' }]).state
    expect(readStep(stopped, { kind: 'sentenceEnd' }).effects).toEqual([])
    expect(readStep(stopped, { kind: 'sentenceError' }).effects).toEqual([])
  })

  it('a new start while speaking cancels the old sentence first, and the skip line may come again', () => {
    const first = run([{ kind: 'start', sentences: three }, { kind: 'sentenceError' }, { kind: 'sentenceError' }]).state
    const { state, effects } = run([{ kind: 'start', sentences: ['Uus.', 'Teine.'] }, { kind: 'sentenceError' }, { kind: 'sentenceError' }], first)
    expect(effects[0]).toEqual([{ kind: 'cancel' }, { kind: 'speak', index: 0, text: 'Uus.' }])
    expect(effects[2]).toEqual([{ kind: 'line', line: 'skipped' }, { kind: 'speak', index: 1, text: 'Teine.' }])
    expect(state.skipped).toBe(1)
  })
})
