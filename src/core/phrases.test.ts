import { describe, expect, it } from 'vitest'
import type { BoxState } from '../browser/protocol.ts'
import { browserIntent } from './browserIntent.ts'
import { initialInpage, inpageStep } from './inpage.ts'
import type { InpageSession, InpageStep } from './inpage.ts'
import { HELP_EXAMPLES, PHRASE_GROUPS, helpGroupForHash, helpGroupOf, phraseFormCount, phraseSentence } from './phrases.ts'
import type { Phrase, PhraseContext } from './phrases.ts'
import { DEFAULT_PLACES, placeCommand, placeVoice } from './places.ts'
import { isReadStop } from './reading.ts'
import type { SavedItem } from './saved.ts'
import { entryStep } from './savedEntry.ts'
import type { EntryState } from './savedEntry.ts'
import { STRINGS } from './strings.ts'
import { createWake, wakeGate, wakeOpen, wakeOpenWindow } from './wake.ts'

// Every Estonian form of every entry of src/core/phrases.ts, through the rule the entry names, with
// what the entry says is in front. A phrase that drifts from the rules fails here (ARCHITECTURE 30.2.1).

const NOTHING: BoxState = { present: false, text: '', armed: false }
const SAVED: SavedItem[] = [
  { id: 'e1', name: 'minu e-post', value: 'ralf.tamm@gmail.com', kind: 'email' },
  { id: 't1', name: 'minu telefon', value: '+3725551234', kind: 'tel' },
  { id: 'c1', name: 'minu isikukood', value: '39021000001', kind: 'code' },
]
const field = (fieldKind: 'code' | 'email' | 'tel'): BoxState => ({ present: true, text: '', armed: true, kind: 'field', single: true, fieldKind })

const BOXES: Record<PhraseContext, BoxState> = {
  none: NOTHING,
  focused: { present: true, text: '', armed: false, kind: 'field' },
  empty: { present: true, text: '', armed: true, kind: 'composer' },
  text: { present: true, text: 'Tulen homme kooli kell kolm. Siis näeme', armed: true, kind: 'composer' },
  code: field('code'),
  email: field('email'),
  tel: field('tel'),
  mail: { present: true, text: '', armed: true, kind: 'composer', mail: true },
  document: { present: true, text: 'Esimene lause on siin. Teine lause tuleb siia.', armed: true, kind: 'field', document: true },
  hints: NOTHING,
  saved: field('email'),
  asleep: NOTHING,
  spelled: { present: true, text: '', armed: true, kind: 'composer' },
  entry: NOTHING,
  wakeShut: NOTHING,
  wakeOpen: NOTHING,
}

function sessionFor(context: PhraseContext): InpageSession {
  const base = initialInpage('et')
  if (context === 'text') return { ...base, undo: ['Tulen homme'] }
  if (context === 'hints') return { ...base, hints: true }
  if (context === 'asleep') return { ...base, asleep: true }
  if (context === 'saved') return { ...base, saved: SAVED }
  if (context === 'spelled') return { ...base, spell: 'code' }
  return base
}

/** What an in-page step did, in the words of Phrase.expect. */
function outcome(before: InpageSession, step: InpageStep): string {
  if (step.cancel === true) return 'cancel'
  if (!before.asleep && step.session.asleep) return 'sleep'
  if (before.asleep && !step.session.asleep) return 'wake'
  if (step.speak !== undefined) return 'speak'
  if ((before.spell ?? null) !== (step.session.spell ?? null)) return 'spell'
  const first = step.commands[0]
  if (first !== undefined) return first.kind
  return step.ask === true ? 'ask' : 'none'
}

const ENTRY: EntryState = { step: 'value', kind: 'email', name: 'minu e-post', value: 'ralf.tamm@mail.ee', suffix: '' }

/** What the rule the entry names makes of one Estonian form. */
function ruled(phrase: Phrase, form: string): string {
  const context = phrase.context ?? 'none'
  switch (phrase.rule) {
    case 'inpage': {
      const session = sessionFor(context)
      return outcome(session, inpageStep(session, form, BOXES[context]))
    }
    case 'browserIntent': {
      const direct = browserIntent(form)?.kind ?? 'none'
      // The extension reaches the table through inpage: both must agree.
      const session = sessionFor(context)
      const viaInpage = outcome(session, inpageStep(session, form, BOXES[context]))
      return direct === viaInpage ? direct : `${direct} (inpage: ${viaInpage})`
    }
    case 'model': {
      const session = sessionFor(context)
      const step = inpageStep(session, form, BOXES[context])
      const fixed = step.commands.some((c) => c.kind !== 'setText')
      return step.ask === true && !fixed ? 'ask' : outcome(session, step)
    }
    case 'places':
      return placeCommand(form, DEFAULT_PLACES) === null ? 'none' : 'goTo'
    case 'placeVoice':
      return placeVoice(form, false)?.action ?? 'none'
    case 'savedEntry': {
      const r = entryStep(ENTRY, form, [], 'et')
      if (r.save !== undefined) return 'save'
      if (r.state === null) return 'cancel'
      const before = ENTRY.value.length + ENTRY.suffix.length
      const after = r.state.value.length + r.state.suffix.length
      if (after > before) return 'add'
      if (after < before) return 'delete'
      return r.line === '' ? 'none' : 'read'
    }
    case 'readStop':
      return isReadStop(form) ? 'stop' : 'none'
    case 'wake': {
      const shut = createWake('Ütle')
      if (context === 'wakeOpen') {
        const open = wakeOpenWindow(shut, 1000)
        const gated = wakeGate(open, form, 2000)
        return gated.utterance === null && !wakeOpen(gated.state, 2000) ? 'close' : 'none'
      }
      const gated = wakeGate(shut, form, 1000)
      if (gated.utterance !== null) return 'pass'
      return wakeOpen(gated.state, 1000) ? 'open' : 'none'
    }
  }
}

const CASES = PHRASE_GROUPS.flatMap((g) => g.phrases.flatMap((p) => p.et.map((form) => ({ group: g.name, phrase: p, form }))))

describe('phrases: every Estonian form is answered by the rule its entry names', () => {
  it.each(CASES.map((c) => [c.group, c.form, c.phrase.rule, c.phrase.expect, c.phrase] as const))('%s: "%s" (%s) -> %s', (_group, form, _rule, expected, phrase) => {
    expect(ruled(phrase, form)).toBe(expected)
  })

  it(`checks ${CASES.length} phrases`, () => {
    console.log(`phrases checked: ${CASES.length} Estonian forms in ${PHRASE_GROUPS.reduce((n, g) => n + g.phrases.length, 0)} entries, ${PHRASE_GROUPS.length} groups`)
    expect(CASES.length).toBe(phraseFormCount())
    expect(CASES.length).toBeGreaterThan(200)
  })
})

describe('phrases: the shape of the source', () => {
  it('has the 14 groups in the help page order', () => {
    expect(PHRASE_GROUPS.map((g) => g.name)).toEqual([
      'Sõnumid', 'Parandamine', 'Tekstis liikumine', 'Vormid', 'Kerimine', 'Vahelehed ja saidid', 'Video', 'Meil', 'Dokument', 'Lugemine', 'Minu andmed', 'Minu kohad', 'Hääl', 'Abi',
    ])
  })

  it('ids are unique ASCII slugs and every group has phrases', () => {
    const ids = PHRASE_GROUPS.map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const g of PHRASE_GROUPS) {
      expect(g.id).toMatch(/^[a-z-]+$/u)
      expect(g.phrases.length).toBeGreaterThan(0)
      expect(g.noteEn.trim()).not.toBe('')
    }
  })

  it('every meaning is one line ending in a full stop, in both languages', () => {
    for (const p of PHRASE_GROUPS.flatMap((g) => g.phrases)) {
      for (const line of [p.does, p.doesEn]) {
        expect(line).not.toMatch(/\n/u)
        expect(line).toMatch(/[.]["”]?$/u)
      }
      expect(p.et.length).toBeGreaterThan(0)
      expect(p.en.trim()).not.toBe('')
    }
  })

  it('reads a phrase as one sentence', () => {
    const scroll = PHRASE_GROUPS.find((g) => g.id === 'kerimine')?.phrases[0]
    expect(scroll && phraseSentence(scroll)).toBe('„keri alla“ või „keri üles“: kerib lehte peaaegu ekraani võrra.')
    const rest = PHRASE_GROUPS.find((g) => g.id === 'haal')?.phrases[0]
    expect(rest && phraseSentence(rest)).toBe('„puhka“ või „ära kuula“: Ütle ei kirjuta midagi, kuni äratad.')
  })

  it('the new-tab examples come from the source', () => {
    expect(HELP_EXAMPLES.length).toBeGreaterThanOrEqual(6)
    expect(HELP_EXAMPLES).toContain('„abi“')
    expect(STRINGS.et.strip.examples).toEqual(HELP_EXAMPLES)
  })
})

describe('abi: the commands that open the help page', () => {
  it.each(['abi', 'Abi.', 'mida ma öelda saan', 'Mida ma saan öelda?', 'näita käske', 'käsud', 'help', 'What can I say?', 'show commands'])('abi: "%s" opens the help page', (words) => {
    expect(browserIntent(words)).toEqual({ kind: 'openHelp' })
    expect(inpageStep(initialInpage('et'), words, NOTHING).commands).toEqual([{ kind: 'openHelp' }])
  })

  it('abi: "abi <group>" and "help <group>" open that group, for every word of every group', () => {
    for (const g of PHRASE_GROUPS) {
      for (const word of g.say) {
        expect(browserIntent(`abi ${word}`), `abi ${word}`).toEqual({ kind: 'openHelp', group: g.id })
        expect(browserIntent(`help ${word}`), `help ${word}`).toEqual({ kind: 'openHelp', group: g.id })
      }
    }
    expect(browserIntent('abi kerimine')).toEqual({ kind: 'openHelp', group: 'kerimine' })
    expect(browserIntent('abi vormid')).toEqual({ kind: 'openHelp', group: 'vormid' })
  })

  it('abi: the strip says what opens', () => {
    const step = inpageStep(initialInpage('et'), 'abi kerimine', NOTHING)
    expect(step.line).toBe('Avan abi: Kerimine.')
    expect(inpageStep(initialInpage('et'), 'abi', NOTHING).line).toBe('Avan abi.')
    expect(inpageStep(initialInpage('en'), 'help', NOTHING).line).toBe('Opening help.')
  })

  it('abi: one word "abi" is typed while the armed box has words (a message, not a command)', () => {
    const step = inpageStep(initialInpage('et'), 'abi', BOXES.text)
    expect(step.commands[0]?.kind).toBe('setText')
  })

  it('abi: "abi" in an empty armed box opens the page', () => {
    expect(inpageStep(initialInpage('et'), 'abi', BOXES.empty).commands).toEqual([{ kind: 'openHelp' }])
  })

  it('abi: helpGroupOf and helpGroupForHash', () => {
    expect(helpGroupOf('Minu andmed')?.id).toBe('minu-andmed')
    expect(helpGroupOf('nonsense')).toBeUndefined()
    expect(helpGroupForHash('#kerimine').id).toBe('kerimine')
    expect(helpGroupForHash('').id).toBe('sonumid')
    expect(helpGroupForHash('#nonsense').id).toBe('sonumid')
  })

  it('abi: notUnderstood ends with the way to help, in both languages', () => {
    expect(STRINGS.et.inpage.notUnderstood).toMatch(/või ütle „abi“\.$/u)
    expect(STRINGS.en.inpage.notUnderstood).toMatch(/or say "help"\.$/u)
  })
})
