import { describe, expect, it } from 'vitest'
import type { SavedItem } from './saved.ts'
import { entryChips, entryStep, spokenLetters, startEntry } from './savedEntry.ts'
import type { EntryResult, EntryState } from './savedEntry.ts'
import { STRINGS } from './strings.ts'

const S = STRINGS.et.andmed

/** Feeds each utterance in turn; returns every result. Stops feeding when the flow ends. */
function walk(start: EntryResult, utterances: readonly string[], existing: readonly SavedItem[] = []): EntryResult[] {
  const results: EntryResult[] = [start]
  let state: EntryState | null = start.state
  for (const u of utterances) {
    if (state === null) throw new Error(`the flow ended before "${u}"`)
    const r = entryStep(state, u, existing, 'et')
    results.push(r)
    state = r.state
  }
  return results
}

describe('the entry flow: an e-mail spelled letter by letter', () => {
  it('"r a l f punkt t a m m", "gmail", "loe ette", "kustuta", "m", "valmis" saves ralf.tamm@gmail.com as "minu e-post"', () => {
    const start = startEntry('email', [], 'et')
    expect(start.state).toMatchObject({ step: 'value', kind: 'email', name: 'minu e-post', value: '', suffix: '' })
    expect(start.line).toContain('Ütle tähthaaval; „punkt“ on ., „ät“ on @; „valmis“ salvestab.')
    const results = walk(start, ['r', 'a', 'ell', 'f', 'punkt', 'tee', 'a', 'emm', 'm', 'gmail', 'loe ette', 'kustuta', 'm', 'valmis'])
    const at = (i: number): EntryResult => results[i] ?? start
    expect(at(9).state?.value).toBe('ralf.tamm')
    expect(at(10).state?.suffix).toBe('@gmail.com')
    expect(at(11).line).toBe(S.readBack('r a l f punkt t a m m', '@gmail.com'))
    expect(at(12).state?.value).toBe('ralf.tam')
    expect(at(13).state?.value).toBe('ralf.tamm')
    const last = at(14)
    expect(last.state).toBeNull()
    expect(last.save).toEqual({ name: 'minu e-post', value: 'ralf.tamm@gmail.com', kind: 'email' })
    expect(last.line).toBe(S.savedOk('minu e-post'))
  })

  it('a whole address in one breath works too, and the chips are one per character with the suffix apart', () => {
    const r = walk(startEntry('email', [], 'et'), ['ralf punkt tamm ät gmail punkt com'])
    expect(r[1]?.state?.value).toBe('ralf.tamm@gmail.com')
    const state = startEntry('email', [], 'et').state
    if (state === null) throw new Error('no state')
    expect(entryChips({ ...state, value: 'ab.', suffix: '@mail.ee' })).toEqual({ letters: ['a', 'b', '.'], suffix: '@mail.ee' })
  })

  it('the suffixes: hotmail, outlook, "mail punkt ee"; "oma lõpp" clears it', () => {
    const r = walk(startEntry('email', [], 'et'), ['ralf', 'hotmail', 'outlook', 'mail punkt ee', 'oma lõpp'])
    expect(r.map((x) => x.state?.suffix)).toEqual(['', '', '@hotmail.com', '@outlook.com', '@mail.ee', ''])
  })

  it('"kustuta kõik" clears value and suffix; "kustuta" with no value takes the suffix off', () => {
    const r = walk(startEntry('email', [], 'et'), ['ralf', 'gmail', 'kustuta kõik', 'gmail', 'kustuta'])
    expect(r[3]?.state).toMatchObject({ value: '', suffix: '' })
    expect(r[5]?.state).toMatchObject({ value: '', suffix: '' })
  })

  it('an e-mail without @ is not saved: the line says what is missing and the flow stays', () => {
    const r = walk(startEntry('email', [], 'et'), ['ralf', 'valmis'])
    expect(r[2]?.state?.value).toBe('ralf')
    expect(r[2]?.save).toBeUndefined()
    expect(r[2]?.line).toBe(S.needAt)
  })

  it('nothing said yet: "valmis" does not save', () => {
    const r = walk(startEntry('email', [], 'et'), ['valmis'])
    expect(r[1]?.save).toBeUndefined()
    expect(r[1]?.state).not.toBeNull()
  })
})

describe('the entry flow: other kinds, names, read back', () => {
  it('a phone number: digits as words, saved as +372...', () => {
    const r = walk(startEntry('tel', [], 'et'), ['pluss kolm seitse kaks', 'viis üks kaks kolm', 'neli viis kuus seitse', 'loe ette', 'valmis'])
    expect(r[4]?.line).toBe(S.readBack('+ 3 7 2 5 1 2 3 4 5 6 7', ''))
    expect(r[5]?.save).toEqual({ name: 'minu telefon', value: '+37251234567', kind: 'tel' })
  })

  it('a second e-mail asks for a name first; a name in use is refused', () => {
    const existing: SavedItem[] = [{ id: 'e1', name: 'minu e-post', value: 'a@b.ee', kind: 'email' }]
    const start = startEntry('email', existing, 'et')
    expect(start.state?.step).toBe('name')
    expect(start.line).toBe(S.askName)
    const r = walk(start, ['minu e-post', 'töö e-post', 'r', 'ät', 'firma punkt ee', 'valmis'], existing)
    expect(r[1]?.line).toBe(S.nameTaken('minu e-post'))
    expect(r[1]?.state?.step).toBe('name')
    expect(r[2]?.state).toMatchObject({ step: 'value', name: 'töö e-post' })
    expect(r[6]?.save).toEqual({ name: 'töö e-post', value: 'r@firma.ee', kind: 'email' })
  })

  it('started without a kind, the first answer is the kind', () => {
    const start = startEntry(null, [], 'et')
    expect(start.state?.step).toBe('kind')
    const r = walk(start, ['isikukood', 'kolm üheksa null null kaks', 'valmis'])
    expect(r[1]?.state).toMatchObject({ step: 'value', kind: 'code', name: 'minu isikukood' })
    expect(r[3]?.save).toEqual({ name: 'minu isikukood', value: '39002', kind: 'code' })
  })

  it('a word that is no kind keeps asking', () => {
    const r = walk(startEntry(null, [], 'et'), ['banaan'])
    expect(r[1]?.state?.step).toBe('kind')
    expect(r[1]?.line).toBe(S.askKind)
  })

  it('reads characters the way he says them', () => {
    expect(spokenLetters('a.b@c-1_2+')).toBe('a punkt b ät c kriips 1 alakriips 2 +')
  })
})

describe('the entry flow: "katkesta" at any step leaves nothing saved', () => {
  const cases: [string, EntryResult, string[]][] = [
    ['kind', startEntry(null, [], 'et'), []],
    ['name', startEntry('email', [{ id: 'x', name: 'minu e-post', value: 'a@b.ee', kind: 'email' }], 'et'), []],
    ['value, empty', startEntry('email', [], 'et'), []],
    ['value, with letters and a suffix', startEntry('email', [], 'et'), ['r', 'a', 'gmail']],
  ]
  for (const [step, start, before] of cases) {
    it(`at ${step}`, () => {
      const r = walk(start, [...before, 'katkesta'])
      const last = r.at(-1)
      expect(last?.state).toBeNull()
      expect(last?.save).toBeUndefined()
      expect(last?.line).toBe(S.abandoned)
      expect(r.some((x) => x.save !== undefined)).toBe(false)
    })
  }
  it('"cancel" in English too', () => {
    const r = walk(startEntry('tel', [], 'et'), ['cancel'])
    expect(r[1]?.state).toBeNull()
    expect(r[1]?.save).toBeUndefined()
  })
})
