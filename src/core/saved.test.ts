import { describe, expect, it } from 'vitest'
import type { BoxState } from '../browser/protocol.ts'
import { MAX_SAVED, MAX_SAVED_NAMES, SAVED_NAME_CHARS, savedByName, savedFrom, savedHint, savedMatch, savedNames, savedPhrases } from './saved.ts'
import type { SavedItem } from './saved.ts'
import { STRINGS } from './strings.ts'

const EMAIL: SavedItem = { id: 'e1', name: 'minu e-post', value: 'ralf.tamm@gmail.com', kind: 'email' }
const WORK: SavedItem = { id: 'e2', name: 'töö e-post', value: 'ralf@firma.ee', kind: 'email' }
const PHONE: SavedItem = { id: 't1', name: 'minu telefon', value: '+37251234567', kind: 'tel' }
const CODE: SavedItem = { id: 'c1', name: 'minu isikukood', value: '39002100001', kind: 'code' }
const MOM: SavedItem = { id: 't2', name: 'ema telefon', value: '+37255555555', kind: 'tel', aliases: ['emme number'] }

const field = (fieldKind: BoxState['fieldKind'], armed = true): BoxState => ({ present: true, text: '', armed, kind: 'field', fieldKind, single: true, label: 'x' })

describe('savedMatch: one e-mail saved, free phrasing', () => {
  const items = [EMAIL, PHONE, CODE]
  for (const phrase of ['pane mu email sinna', 'minu meil', 'kirjuta mu e-post', 'my email', 'sisesta minu e-posti aadress', 'mu mail', 'type my email here', 'pane siia minu e-post']) {
    it(`"${phrase}" is the e-mail`, () => {
      expect(savedMatch(phrase, items, false)).toEqual({ kind: 'one', item: EMAIL })
    })
  }
  for (const phrase of ['minu telefon', 'pane mu number', 'kirjuta mu telefoninumber', 'my phone number', 'sisesta minu telefon']) {
    it(`"${phrase}" is the phone number`, () => {
      expect(savedMatch(phrase, items, false)).toEqual({ kind: 'one', item: PHONE })
    })
  }
  for (const phrase of ['pane mu isikukood', 'minu isikukood', 'kirjuta mu ID-kood', 'my ID code', 'mu kood']) {
    it(`"${phrase}" is the ID code`, () => {
      expect(savedMatch(phrase, items, false)).toEqual({ kind: 'one', item: CODE })
    })
  }
})

describe('savedMatch: two of a family', () => {
  const items = [EMAIL, WORK, PHONE, MOM]
  it('"pane mu email sinna" with two e-mails saved and no name asks which', () => {
    expect(savedMatch('pane mu email sinna', items, false)).toEqual({ kind: 'which', items: [EMAIL, WORK] })
  })
  it('a name picks one: "töö meil", "kirjuta töö e-post"', () => {
    expect(savedMatch('töö meil', items, false)).toEqual({ kind: 'one', item: WORK })
    expect(savedMatch('kirjuta töö e-post', items, false)).toEqual({ kind: 'one', item: WORK })
  })
  it('"minu e-post" is the one whose folded name is just the family word', () => {
    expect(savedMatch('minu e-post', items, false)).toEqual({ kind: 'one', item: EMAIL })
  })
  it('an alias names an item: "pane emme number"', () => {
    expect(savedMatch('pane emme number', items, false)).toEqual({ kind: 'one', item: MOM })
  })
  it('a misheard name word that sounds alike still names it: "ema telefoni" and "emma telefon"', () => {
    expect(savedMatch('pane ema telefoni', items, false)).toEqual({ kind: 'one', item: MOM })
    expect(savedMatch('pane emma telefon', items, false)).toEqual({ kind: 'one', item: MOM })
  })
})

describe('savedMatch: never a word of a message', () => {
  const items = [EMAIL, PHONE]
  it('a bare family word with no verb or determiner is not a match in a composer', () => {
    expect(savedMatch('telefon', items, false)).toBeNull()
    expect(savedMatch('email', items, false)).toBeNull()
  })
  it('but is in a single field', () => {
    expect(savedMatch('email', items, true)).toEqual({ kind: 'one', item: EMAIL })
  })
  it('a sentence around the words is not a match', () => {
    expect(savedMatch('saada mulle oma email', items, false)).toBeNull()
    expect(savedMatch('mu telefon on katki', items, false)).toBeNull()
    expect(savedMatch('kirjuta et tulen homme', items, false)).toBeNull()
  })
  it('nothing saved of the family: no match', () => {
    expect(savedMatch('minu isikukood', items, false)).toBeNull()
  })
  it('no items: no match', () => {
    expect(savedMatch('minu meil', [], false)).toBeNull()
  })
})

describe('savedNames, savedByName, savedFrom', () => {
  it('the names only, at most MAX_SAVED_NAMES, each cut to SAVED_NAME_CHARS', () => {
    const many: SavedItem[] = Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, name: `${'n'.repeat(70)}${i}`, value: `v${i}`, kind: 'text' }))
    const names = savedNames(many)
    expect(names).toHaveLength(MAX_SAVED_NAMES)
    expect(names.every((n) => n.length <= SAVED_NAME_CHARS)).toBe(true)
    expect(JSON.stringify(names)).not.toContain('v1')
  })
  it('finds an item by name ignoring case and space', () => {
    expect(savedByName([EMAIL, WORK], '  Töö E-post ')).toBe(WORK)
    expect(savedByName([EMAIL], 'kolmas')).toBeUndefined()
  })
  it('cleans what storage holds: bad entries and passwords are dropped, at most MAX_SAVED', () => {
    const stored = [EMAIL, { id: 'p', name: 'parool', value: 'x', kind: 'password' }, { id: 1, name: 'x', value: 'y', kind: 'text' }, null, 'x', { ...PHONE, aliases: ['a', 3] }]
    expect(savedFrom(stored)).toEqual([EMAIL, { ...PHONE, aliases: ['a'] }])
    expect(savedFrom(undefined)).toEqual([])
    expect(savedFrom(Array.from({ length: 80 }, (_, i) => ({ ...EMAIL, id: `e${i}` })))).toHaveLength(MAX_SAVED)
  })
})

describe('the guidance', () => {
  it('the hint names the saved item of the armed field\'s kind', () => {
    expect(savedHint([EMAIL, PHONE], field('email'), 'et')).toBe(STRINGS.et.inpage.savedHint(['minu e-post']))
    expect(savedHint([EMAIL, PHONE], field('email'), 'et')).toBe(' Või ütle „minu e-post“.')
    expect(savedHint([EMAIL, WORK, PHONE], field('email'), 'et')).toBe(' Või ütle „minu e-post“ või „töö e-post“.')
    expect(savedHint([EMAIL, PHONE], field('tel'), 'en')).toBe(' Or say "minu telefon".')
  })
  it('no hint without a matching item, an armed single field, or for a text field', () => {
    expect(savedHint([PHONE], field('email'), 'et')).toBe('')
    expect(savedHint([EMAIL], field('email', false), 'et')).toBe('')
    expect(savedHint([EMAIL], { present: true, text: '', armed: true }, 'et')).toBe('')
    expect(savedHint([EMAIL], field('text'), 'et')).toBe('')
  })
  it('what to say for each item: the name, then a short form', () => {
    expect(savedPhrases(EMAIL)).toEqual(['minu e-post', 'mu meil'])
    expect(savedPhrases(PHONE)).toEqual(['minu telefon', 'mu number'])
    expect(savedPhrases(CODE)).toEqual(['minu isikukood', 'mu kood'])
    expect(savedPhrases(WORK)).toEqual(['töö e-post'])
  })
})
