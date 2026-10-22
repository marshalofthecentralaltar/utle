import { keyDistance, phoneticKey } from './phonetic.ts'
import { normalise } from './quickReply.ts'

/**
 * Round 8, the listening mode "Äratussõnaga" (docs/ARCHITECTURE.md 29.4.1): the bar listens all
 * day and acts on a final only when it starts with his wake word, or while the dictation window is
 * open. A pure state machine: the engine keeps the state, passes each final through wakeGate and
 * publishes whether the window is open. No timers here: the caller passes `now`.
 */

export const DEFAULT_WAKE_WORD = 'Ütle'
/** The dictation window closes after this long with nothing heard. */
export const WAKE_WINDOW_MS = 20_000
/** The chrome.storage.local key of the setting. */
export const WAKE_WORD_KEY = 'wakeWord'
/** At most this many letters in one word of the setting. */
const WORD_LETTERS = 20

/** What ends the window, with or without the word ("aitab", "see on kõik", "that's all"). */
const STOP = new Set(['aitab', 'see on kõik', 'see oli kõik', 'thats all', 'that is all'])

export interface WakeState {
  /** The phonetic keys of the wake word's words, in order. */
  keys: string[]
  /** Date.now() until which the dictation window is open; 0 when it is closed. */
  openUntil: number
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
  return { keys: wakeWordFrom(word).split(' ').map(keyOf), openUntil: 0 }
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

/** The words of the final after the wake word, as said ('' for the bare word), or null when it does not start with it. */
export function wakeStarts(state: WakeState, final: string): string | null {
  let rest = final.trimStart()
  for (const key of state.keys) {
    const m = /^(\S+)\s*/u.exec(rest)
    if (!m?.[1] || !same(m[1], key)) return null
    rest = rest.slice(m[0].length)
  }
  // Punctuation after the word ("Ütle, …", "ütle... …") goes with it.
  return rest.replace(/^[\p{P}\s]+/u, '').trim()
}

export function wakeOpen(state: WakeState, now: number): boolean {
  return state.openUntil > now
}

/** Opens (or keeps open) the dictation window from now. */
export function wakeOpenWindow(state: WakeState, now: number): WakeState {
  return { ...state, openUntil: now + WAKE_WINDOW_MS }
}

export function wakeClose(state: WakeState): WakeState {
  return state.openUntil === 0 ? state : { ...state, openUntil: 0 }
}

/** Something was heard (a partial): an open window stays open from now. */
export function wakeHeard(state: WakeState, now: number): WakeState {
  return wakeOpen(state, now) ? wakeOpenWindow(state, now) : wakeClose(state)
}

/**
 * One final through the gate. utterance is what the engine acts on, the word stripped, or null:
 * dropped (closed, no word), a stop word (closes the window), or the bare word (opens it).
 */
export function wakeGate(state: WakeState, final: string, now: number): { state: WakeState; utterance: string | null } {
  const open = wakeOpen(state, now)
  const base = open ? state : wakeClose(state)
  const rest = wakeStarts(base, final)
  const words = rest ?? (open ? final : null)
  if (words === null) return { state: base, utterance: null }
  if (STOP.has(normalise(words))) return { state: wakeClose(base), utterance: null }
  if (words === '') return { state: wakeOpenWindow(base, now), utterance: null }
  return { state: open ? wakeOpenWindow(base, now) : base, utterance: words }
}
