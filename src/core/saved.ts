import type { BoxState } from '../browser/protocol.ts'
import { soundsLike } from './phonetic.ts'
import { normalise } from './quickReply.ts'
import { STRINGS } from './strings.ts'
import type { Lang } from './strings.ts'

/**
 * Round 6, Minu andmed (docs/ARCHITECTURE.md 26.1, 26.2): an e-mail address, a phone number or an
 * ID code saved once and put into a field by voice. This module knows what is saved and which
 * saved item an utterance names. Pure: no storage, no DOM. The values stay on his machine: the
 * model is told savedNames, never a value.
 */

export type SavedKind = 'email' | 'tel' | 'code' | 'number' | 'text'

export interface SavedItem {
  id: string
  /** What he calls it: "minu e-post", "töö telefon". */
  name: string
  /** Exactly what is typed into the field. */
  value: string
  kind: SavedKind
  /** Other names for it: "emme number". */
  aliases?: string[]
}

export const SAVED_KINDS: readonly SavedKind[] = ['email', 'tel', 'code', 'number', 'text']
/** The chrome.storage.local key. */
export const SAVED_KEY = 'savedValues'
export const MAX_SAVED = 50
/** How many names the model is told (IntentRequestSchema takes the same). */
export const MAX_SAVED_NAMES = 20
export const SAVED_NAME_CHARS = 60
export const SAVED_VALUE_CHARS = 200

/** The word families of 26.2: every word of a family means the same thing. */
export type Family = 'email' | 'tel' | 'code'
const FAMILY: Readonly<Record<string, Family>> = {
  meil: 'email', meili: 'email', mail: 'email', maili: 'email', email: 'email', emaili: 'email', epost: 'email', eposti: 'email',
  emailiaadress: 'email', meiliaadress: 'email', epostiaadress: 'email', emailiga: 'email', meiliga: 'email', epostiga: 'email',
  number: 'tel', numbri: 'tel', numbrit: 'tel', numbriga: 'tel', telefon: 'tel', telefoni: 'tel', telefoninumber: 'tel', telefoninumbri: 'tel',
  telefoninr: 'tel', tel: 'tel', phone: 'tel', mobiil: 'tel', mobiili: 'tel', mobla: 'tel', telefoniga: 'tel',
  isikukood: 'code', isikukoodi: 'code', kood: 'code', koodi: 'code', idkood: 'code', idkoodi: 'code', code: 'code', isikukoodiga: 'code',
}

/** The family a single word belongs to, or null. */
export function familyOf(word: string): Family | null {
  return Object.hasOwn(FAMILY, word) ? (FAMILY[word] ?? null) : null
}

const VERBS = new Set(['kirjuta', 'sisesta', 'pane', 'trüki', 'lisa', 'täida', 'kleebi', 'type', 'enter', 'put', 'insert', 'write', 'fill', 'add', 'paste'])
const DETERMINERS = new Set(['minu', 'mu', 'mina', 'oma', 'my'])
const PLACES = new Set([
  'siia', 'sinna', 'see', 'sellesse', 'välja', 'väljale', 'kasti', 'palun', 'id', 'aadress', 'aadressi',
  'here', 'there', 'it', 'in', 'into', 'this', 'field', 'please', 'the', 'address',
])
const ORDINALS: Readonly<Record<string, number>> = { esimene: 0, teine: 1, kolmas: 2, neljas: 3, first: 0, second: 1, third: 2, fourth: 3 }
/** The everyday word of a family, for "Ütle: mu meil". */
const SHORT: Readonly<Record<Family, string>> = { email: 'meil', tel: 'number', code: 'kood' }

const words = (text: string): string[] => normalise(text).split(' ').filter((w) => w !== '')
const fold = (word: string): string => familyOf(word) ?? word
/** "phone number" is one tel, not two. */
const dedupe = (list: readonly string[]): string[] => list.filter((w, i) => i === 0 || w !== list[i - 1] || familyOf(w) === null)

interface Form {
  /** The name's words without the place words, as said: "minu epost". */
  literal: string
  /** Without determiners and place words, each word folded into its family: ["töö", "email"]. */
  folded: string[]
}

function formOf(name: string): Form {
  const all = words(name).filter((w) => !PLACES.has(w))
  return { literal: all.join(' '), folded: dedupe(all.filter((w) => !DETERMINERS.has(w)).map(fold)) }
}

function formsOf(item: SavedItem): Form[] {
  return [item.name, ...(item.aliases ?? [])].map(formOf)
}

/** The utterance with up to two leading verbs taken off; cue: it had a verb or a determiner. */
function heard(utterance: string): Form & { cue: boolean } {
  let list = words(utterance)
  let cue = false
  for (let i = 0; i < 2 && list.length > 0 && VERBS.has(list[0] ?? ''); i++) {
    list = list.slice(1)
    cue = true
  }
  if (list.some((w) => DETERMINERS.has(w))) cue = true
  return { ...formOf(list.join(' ')), cue }
}

const isFamily = (w: string): boolean => w === 'email' || w === 'tel' || w === 'code'
const distinguishing = (folded: readonly string[]): boolean => folded.some((w) => !isFamily(w))

/** Folded words equal one by one; a word that is no family word may sound like its partner ("emma", "ema"). */
function sameWords(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((w, i) => {
    const v = b[i] ?? ''
    if (w === v) return true
    return !isFamily(w) && !isFamily(v) && w.length >= 3 && v.length >= 3 && soundsLike(w, v)
  })
}

/** The family of a saved item: the family word in its name, else its kind's. */
function itemFamily(item: SavedItem): Family | null {
  const named = formOf(item.name).folded.find(isFamily)
  if (named === 'email' || named === 'tel' || named === 'code') return named
  return item.kind === 'email' || item.kind === 'tel' || item.kind === 'code' ? item.kind : null
}

export type SavedMatch = { kind: 'one'; item: SavedItem } | { kind: 'which'; items: SavedItem[] } | null

const many = (items: SavedItem[]): SavedMatch => {
  const [first] = items
  if (first === undefined) return null
  return items.length === 1 ? { kind: 'one', item: first } : { kind: 'which', items }
}

/**
 * Which saved item the utterance names (26.2). single: the armed box is a one-line field, where a
 * bare "email" is enough; elsewhere a verb or a determiner must be there, so one word of a chat
 * message is never taken for a saved value. Null when it names none.
 */
export function savedMatch(utterance: string, items: readonly SavedItem[], single: boolean): SavedMatch {
  if (items.length === 0) return null
  const h = heard(utterance)
  // Without a verb or a determiner, outside a one-line field, only a name with a word of its own ("töö meil").
  const loose = h.cue || single
  if (h.folded.length === 0 || h.folded.length > 4) return null
  // His name for it, as he saved it: "minu e-post" is that one even when there are two e-mails.
  const literal = items.filter((item) => formsOf(item).some((f) => f.literal === h.literal && (loose || distinguishing(f.folded))))
  if (literal.length === 1) return many(literal)
  // A name with a word of its own: "töö meil" is "töö e-post".
  const named = items.filter((item) => formsOf(item).some((f) => distinguishing(f.folded) && sameWords(f.folded, h.folded)))
  if (named.length > 0) return many(named)
  // Only the family: the one item of that family, or the question.
  const [only] = h.folded
  if (loose && h.folded.length === 1 && only !== undefined && isFamily(only)) return many(items.filter((item) => itemFamily(item) === only))
  return null
}

/**
 * The answer to "Kumb: a või b?": the candidate the utterance names, by an ordinal in the order
 * asked, by its name, or by words that only it has ("töö"). Null when it names none of them.
 */
export function savedChoice(utterance: string, candidates: readonly SavedItem[]): SavedItem | null {
  const clean = normalise(utterance)
  if (Object.hasOwn(ORDINALS, clean)) return candidates[ORDINALS[clean] ?? -1] ?? null
  const h = heard(utterance)
  if (h.folded.length === 0) return null
  const unique = (list: SavedItem[]): SavedItem | null => (list.length === 1 ? (list[0] ?? null) : null)
  const literal = unique(candidates.filter((item) => formsOf(item).some((f) => f.literal === h.literal)))
  if (literal) return literal
  const named = unique(candidates.filter((item) => formsOf(item).some((f) => sameWords(f.folded, h.folded))))
  if (named) return named
  return unique(candidates.filter((item) => formsOf(item).some((f) => h.folded.every((w) => f.folded.includes(w)))))
}

/** The names the model is told (26.1): never a value. At most MAX_SAVED_NAMES, each cut to SAVED_NAME_CHARS. */
export function savedNames(items: readonly SavedItem[]): string[] {
  return items.slice(0, MAX_SAVED_NAMES).map((item) => item.name.slice(0, SAVED_NAME_CHARS))
}

const sameName = (a: string, b: string): boolean => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()

/** The item with this name, ignoring case and surrounding space (the model's insertSaved). */
export function savedByName(items: readonly SavedItem[], name: string): SavedItem | undefined {
  return items.find((item) => sameName(item.name, name))
}

/** True when the name is one of the names (pageIntentFrom). */
export function namedIn(names: readonly string[], name: string): boolean {
  return names.some((n) => sameName(n, name))
}

/** What storage holds, cleaned: well-formed entries of a known kind (never a password), at most MAX_SAVED. */
export function savedFrom(stored: unknown): SavedItem[] {
  if (!Array.isArray(stored)) return []
  const items: SavedItem[] = []
  for (const entry of stored as unknown[]) {
    if (entry === null || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const { id, name, value, kind, aliases } = e
    if (typeof id !== 'string' || typeof name !== 'string' || typeof value !== 'string' || typeof kind !== 'string') continue
    const known = SAVED_KINDS.find((k) => k === kind)
    if (known === undefined || name.trim() === '' || value === '') continue
    const item: SavedItem = { id, name: name.trim().slice(0, SAVED_NAME_CHARS), value: value.slice(0, SAVED_VALUE_CHARS), kind: known }
    if (Array.isArray(aliases)) item.aliases = (aliases as unknown[]).filter((a): a is string => typeof a === 'string' && a.trim() !== '').map((a) => a.slice(0, SAVED_NAME_CHARS))
    items.push(item)
    if (items.length >= MAX_SAVED) break
  }
  return items
}

/**
 * What to say for an item (26.6): its name, then a short form ("mu meil") when the name is only
 * the family word and no other item of that family is saved, so the short form is unambiguous.
 */
export function savedPhrases(item: SavedItem, items: readonly SavedItem[] = [item]): string[] {
  const phrases = [item.name]
  const family = itemFamily(item)
  const folded = formOf(item.name).folded
  if (family !== null && !distinguishing(folded) && items.filter((other) => itemFamily(other) === family).length <= 1) {
    const short = `mu ${SHORT[family]}`
    if (!sameName(short, item.name)) phrases.push(short)
  }
  return phrases
}

/** The bar's hint (26.2) for an armed one-line field with a saved value of its kind, or ''. */
export function savedHint(items: readonly SavedItem[], box: BoxState, lang: Lang): string {
  if (!box.present || !box.armed || box.single !== true) return ''
  const kind = box.fieldKind
  if (kind !== 'email' && kind !== 'tel' && kind !== 'code') return ''
  const names = items.filter((item) => item.kind === kind).slice(0, 2).map((item) => item.name)
  return names.length === 0 ? '' : STRINGS[lang].inpage.savedHint(names)
}

/** The saved item a typed text ends with (the read-back after an insert), or undefined. */
export function savedTyped(items: readonly SavedItem[], text: string): SavedItem | undefined {
  return items.find((item) => text === item.value || text.endsWith(` ${item.value}`))
}
