import { keyDistance, phoneticKey } from './phonetic.ts'

/**
 * The wake word in a final (ARCHITECTURE 29.4.1; round 10: 32). Round 8 matched it as the first
 * word only. Round 10 (#2, LIMITED: on the recogniser's text, not an acoustic keyword spotter)
 * finds it anywhere in a final, splits a glued form ("ütlemine youtube'i"), and keeps literal uses
 * ("kirjuta ütle", „ütle”) as text. The states (PASSIVE, ACTIVE, HARD_OFF) are src/core/listen.ts.
 * Pure: no timers, no DOM.
 */

export const DEFAULT_WAKE_WORD = 'Ütle'
/** The chrome.storage.local key of the setting. */
export const WAKE_WORD_KEY = 'wakeWord'
/** At most this many letters in one word of the setting. */
const WORD_LETTERS = 20

export interface WakeState {
  /** The phonetic keys of the wake word's words, in order. */
  keys: string[]
  /** The wake word in lower-case Latin letters when it is one word, for glued forms; '' for two words. */
  glue: string
}

/** Where the word was found: the words before it (dropped by the caller in PASSIVE) and after it. */
export interface WakeHit {
  before: string
  after: string
}

/** The setting, checked: one or two words of letters (Estonian letters too), else the default. */
export function wakeWordFrom(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_WAKE_WORD
  const words = value.trim().split(/\s+/u).filter((w) => w !== '')
  if (words.length < 1 || words.length > 2) return DEFAULT_WAKE_WORD
  if (!words.every((w) => /^\p{L}+$/u.test(w) && w.length <= WORD_LETTERS)) return DEFAULT_WAKE_WORD
  return words.join(' ')
}

/** Cyrillic letters that look like Latin ones: the recogniser has written "Üтле" for "Ütle". */
const CYRILLIC: Readonly<Record<string, string>> = {
  а: 'a', в: 'v', д: 'd', е: 'e', ё: 'e', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'tš', ш: 'š', ы: 'õ', э: 'e',
  ю: 'ju', я: 'ja', б: 'b', г: 'g', ж: 'ž', з: 'z',
}

function latin(word: string): string {
  return [...word.toLowerCase()].map((ch) => CYRILLIC[ch] ?? ch).join('')
}

/** The key of one heard word, Cyrillic look-alikes read as Latin. */
function keyOf(word: string): string {
  return phoneticKey(latin(word))
}

export function createWake(word: string): WakeState {
  const words = wakeWordFrom(word).split(' ')
  return { keys: words.map(keyOf), glue: words.length === 1 ? latin(words[0] ?? '') : '' }
}

/**
 * One heard word is the wake word's word: the keys are equal, or of the same length (four or more)
 * and one letter or one swapped pair apart ("ütel"). A letter added is another word ("ütles").
 */
function same(heard: string, key: string): boolean {
  const k = keyOf(heard)
  if (k === '' || key === '') return false
  if (k === key) return true
  return k.length === key.length && k.length >= 4 && keyDistance(k, key, 1) <= 1
}

/**
 * Command verbs a glued form may end in: "Ütle, mine …" is heard as "ütlemine …". Only these: a
 * glued "ütle" + anything else is another word ("ütlesin", "ütlemise").
 */
const GLUE_VERBS = new Set(['mine', 'ava', 'otsi', 'keri', 'kirjuta', 'saada', 'sulge', 'vajuta', 'loe', 'näita', 'vali', 'mängi', 'peata', 'kustuta', 'vasta', 'vaata', 'pane', 'lülita', 'klõpsa'])
/**
 * After "ütlemine" these words make it the noun ("ütlemine on hõbe", "see ütlemine ei aita"): no
 * wake. "mine" with nothing after it is the noun too.
 */
const NOUN_NEXT = new Set(['on', 'oli', 'olid', 'pole', 'polnud', 'ei', 'ja', 'et', 'ka', 'kui', 'sest', 'aga', 'see', 'oleks', 'võib', 'saab', 'sai', 'jääb', 'tuleb', 'peab', 'ju', 'nüüd', 'mul', 'sul', 'tal', 'meil', 'kõige', 'alati'])
/** The word after these is text he dictates, never a wake ("kirjuta ütle", "sõna ütle", "ta ütles ütle"). */
const LITERAL_BEFORE = new Set(['kirjuta', 'kirjutan', 'kirjutage', 'trüki', 'sisesta', 'sõna', 'sõnad', 'sõnaga', 'sõnu', 'ütles', 'ütleb', 'ütlen', 'ütlesin', 'ütlevad', 'öelda', 'ütelda', 'öeldi'])
const QUOTE_START = /^[„“”"«»‘’']/u
const QUOTE_END = /[„“”"«»‘’'][\p{P}]*$/u
/** A word ending a sentence: the next word may be a wake even when only the start is allowed. */
const SENTENCE_END = /[.!?…]$/u

interface Token {
  raw: string
  /** Without punctuation at either end. */
  core: string
  start: number
  end: number
}

function tokens(text: string): Token[] {
  const out: Token[] = []
  for (const m of text.matchAll(/\S+/gu)) {
    const start = m.index
    out.push({ raw: m[0], core: m[0].replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ''), start, end: start + m[0].length })
  }
  return out
}

/** What follows the match: punctuation after the word ("Ütle, …", "ütle... …") goes with it. */
const tail = (text: string): string => text.replace(/^[\p{P}\s]+/u, '').trim()

/** The wake word at token i: the words after it, or null. */
function matchAt(state: WakeState, text: string, list: readonly Token[], i: number): string | null {
  const first = list[i]
  if (first === undefined) return null
  const before = list[i - 1]
  if (before !== undefined && LITERAL_BEFORE.has(latin(before.core))) return null
  if (QUOTE_START.test(first.raw) || QUOTE_END.test(first.raw)) return null
  // The whole word (or both words of a two-word setting).
  let whole = true
  for (const [k, key] of state.keys.entries()) {
    const t = list[i + k]
    if (t === undefined || !same(t.core, key)) {
      whole = false
      break
    }
  }
  if (whole) {
    const last = list[i + state.keys.length - 1]
    return last === undefined ? null : tail(text.slice(last.end))
  }
  // A glued form: "ütlemine youtube'i" is "ütle" + "mine youtube'i".
  if (state.glue === '') return null
  const letters = latin(first.core)
  if (!letters.startsWith(state.glue)) return null
  const verb = letters.slice(state.glue.length)
  if (!GLUE_VERBS.has(verb)) return null
  const next = list[i + 1]
  if (verb === 'mine' && (next === undefined || NOUN_NEXT.has(latin(next.core)))) return null
  const rest = text.slice(first.end).trim()
  return rest === '' ? verb : `${verb} ${rest}`
}

/** The words of the final after the wake word when it is the first word ('' for the bare word), else null. */
export function wakeStarts(state: WakeState, final: string): string | null {
  return matchAt(state, final, tokens(final), 0)
}

/**
 * The first wake word in a final. anywhere: at any word (PASSIVE: the lead-in is room talk);
 * otherwise only at the start or after a full stop (ACTIVE: a word inside his sentence is his text).
 * The word said twice is one wake. Null when there is none, or when it is a literal use.
 */
export function wakeFind(state: WakeState, final: string, anywhere: boolean): WakeHit | null {
  const list = tokens(final)
  for (const [i, t] of list.entries()) {
    const prev = list[i - 1]
    if (!anywhere && prev !== undefined && !SENTENCE_END.test(prev.raw)) continue
    let after = matchAt(state, final, list, i)
    if (after === null) continue
    // "ütle ütle ava youtube", "Ütle. Ütle, keri alla": one wake.
    for (let again = wakeStarts(state, after); again !== null && again !== after; again = wakeStarts(state, after)) after = again
    return { before: final.slice(0, t.start).trim(), after }
  }
  return null
}
