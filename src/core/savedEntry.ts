import { familyOf } from './saved.ts'
import type { SavedItem, SavedKind } from './saved.ts'
import { SAVED_NAME_CHARS, SAVED_VALUE_CHARS } from './saved.ts'
import { normalise } from './quickReply.ts'
import { typedFromSpoken } from './spelling.ts'
import { STRINGS } from './strings.ts'
import type { Lang } from './strings.ts'

/**
 * Round 6, Minu andmed (docs/ARCHITECTURE.md 26.5): saving a value by voice, letter by letter, on
 * the options page. A pure state machine: the page holds the state, feeds each utterance through
 * entryStep, renders what comes back and stores `save` when there is one.
 */

export interface EntryState {
  step: 'kind' | 'name' | 'value'
  kind: SavedKind | null
  name: string
  /** What he has spelled so far, converted for the kind. */
  value: string
  /** An e-mail ending chosen whole ("gmail" is "@gmail.com"), appended at save; '' for none. */
  suffix: string
}

export interface EntryResult {
  /** Null when the flow is over (saved or abandoned). */
  state: EntryState | null
  /** The line for the strip and the page. */
  line: string
  /** What to store, once, when he said "valmis" and the value holds. */
  save?: { name: string; value: string; kind: SavedKind }
}

/** E-mail endings said whole (normalised: "mail.ee" is "mailee"). */
export const EMAIL_SUFFIXES: Readonly<Record<string, string>> = {
  gmail: '@gmail.com', 'gmail punkt com': '@gmail.com', 'gmail dot com': '@gmail.com', gmailcom: '@gmail.com',
  hotmail: '@hotmail.com', outlook: '@outlook.com', icloud: '@icloud.com', yahoo: '@yahoo.com',
  'mail punkt ee': '@mail.ee', 'mail dot ee': '@mail.ee', mailee: '@mail.ee',
}
const NO_SUFFIX = new Set(['oma lõpp', 'ilma lõputa', 'own ending', 'no ending'])
const CANCEL = new Set(['katkesta', 'katkesta kõik', 'tühista', 'cancel', 'cancel everything'])
const SAVE = new Set(['valmis', 'olen valmis', 'salvesta', 'done', 'save'])
const DELETE = new Set(['kustuta', 'kustuta täht', 'kustuta viimane', 'kustuta viimane täht', 'delete', 'backspace'])
const CLEAR = new Set(['kustuta kõik', 'tühjenda', 'alusta uuesti', 'delete everything', 'clear', 'start again'])
const READ = new Set(['loe ette', 'loe', 'loe uuesti', 'read it back', 'read back', 'read it'])
const OTHER = new Set(['muu', 'tekst', 'midagi muud', 'other', 'text'])

const SPOKEN: Readonly<Record<string, string>> = { '.': 'punkt', '@': 'ät', '-': 'kriips', _: 'alakriips', ' ': 'tühik' }

/** The value read the way he says it, one character at a time: "r a l f punkt t a m m". */
export function spokenLetters(value: string): string {
  return [...value].map((ch) => SPOKEN[ch] ?? ch).join(' ')
}

/** What the page shows: one chip per character, the ending apart. */
export function entryChips(state: EntryState): { letters: string[]; suffix: string } {
  return { letters: [...state.value], suffix: state.suffix }
}

function kindOf(clean: string): SavedKind | null {
  if (OTHER.has(clean)) return 'text'
  for (const word of clean.split(' ')) {
    const family = familyOf(word)
    if (family !== null) return family
  }
  return null
}

const taken = (existing: readonly SavedItem[], name: string): boolean => existing.some((item) => item.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase())

function valueLine(kind: SavedKind, lang: Lang): string {
  const s = STRINGS[lang].andmed
  return kind === 'email' ? `${s.stepValue} ${s.suffixHint}` : s.stepValue
}

/** After the kind: a name when one of that kind is saved already (or the default is in use), else straight to the value. */
function afterKind(kind: SavedKind, existing: readonly SavedItem[], lang: Lang): EntryResult {
  const s = STRINGS[lang].andmed
  const name = s.defaultName(kind)
  if (existing.some((item) => item.kind === kind) || taken(existing, name)) {
    return { state: { step: 'name', kind, name: '', value: '', suffix: '' }, line: s.askName }
  }
  return { state: { step: 'value', kind, name, value: '', suffix: '' }, line: valueLine(kind, lang) }
}

/** The flow begins: with a kind ("lisa uus e-post") or asking for one ("Lisa" on the page with no kind). */
export function startEntry(kind: SavedKind | null, existing: readonly SavedItem[], lang: Lang): EntryResult {
  if (kind !== null) return afterKind(kind, existing, lang)
  return { state: { step: 'kind', kind: null, name: '', value: '', suffix: '' }, line: STRINGS[lang].andmed.askKind }
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u

/** One utterance of the flow. "katkesta" at any step ends it with nothing saved. */
export function entryStep(state: EntryState, utterance: string, existing: readonly SavedItem[], lang: Lang): EntryResult {
  const s = STRINGS[lang].andmed
  const clean = normalise(utterance)
  if (CANCEL.has(clean)) return { state: null, line: s.abandoned }
  if (clean === '') return { state, line: '' }

  if (state.step === 'kind' || state.kind === null) {
    const kind = kindOf(clean)
    return kind === null ? { state, line: s.askKind } : afterKind(kind, existing, lang)
  }
  const kind = state.kind

  if (state.step === 'name') {
    const name = utterance.trim().replace(/[.!?…]+$/u, '').replace(/\s+/gu, ' ').slice(0, SAVED_NAME_CHARS)
    if (name === '') return { state, line: s.askName }
    if (taken(existing, name)) return { state, line: s.nameTaken(name) }
    return { state: { ...state, step: 'value', name }, line: valueLine(kind, lang) }
  }

  const now = (next: EntryState): EntryResult => ({
    state: next,
    line: next.value === '' && next.suffix === '' ? valueLine(kind, lang) : s.now(next.value, next.suffix),
  })

  if (SAVE.has(clean)) {
    if (state.value === '' && state.suffix === '') return { state, line: s.nothingYet }
    const value = (state.suffix === '' ? state.value : state.value.replace(/@$/u, '') + state.suffix).slice(0, SAVED_VALUE_CHARS)
    if (kind === 'email' && !EMAIL.test(value)) return { state, line: s.needAt }
    if ((kind === 'tel' || kind === 'number') && !/\d/u.test(value)) return { state, line: s.needDigit }
    return { state: null, line: s.savedOk(state.name), save: { name: state.name, value, kind } }
  }
  if (DELETE.has(clean)) return now(state.value !== '' ? { ...state, value: [...state.value].slice(0, -1).join('') } : { ...state, suffix: '' })
  if (CLEAR.has(clean)) return now({ ...state, value: '', suffix: '' })
  if (READ.has(clean)) {
    if (state.value === '' && state.suffix === '') return { state, line: s.nothingYet }
    return { state, line: s.readBack(spokenLetters(state.value), state.suffix) }
  }
  if (kind === 'email') {
    const suffix = Object.hasOwn(EMAIL_SUFFIXES, clean) ? EMAIL_SUFFIXES[clean] : undefined
    if (suffix !== undefined) return now({ ...state, suffix })
    if (NO_SUFFIX.has(clean)) return now({ ...state, suffix: '' })
  }
  const typed = typedFromSpoken(utterance, kind)
  if (typed === '') return { state, line: valueLine(kind, lang) }
  const value = kind === 'text' && state.value !== '' ? `${state.value} ${typed}` : state.value + typed
  return now({ ...state, value: value.slice(0, SAVED_VALUE_CHARS) })
}
