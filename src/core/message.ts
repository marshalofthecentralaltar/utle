import type { Lang } from './strings.ts'
import { normalise } from './quickReply.ts'

/**
 * Commands that start, send or drop a message draft (docs/ARCHITECTURE.md section 20.3).
 * Estonian first; English kept because it costs nothing. Whole utterances only.
 */
export type MessageCommand =
  | { kind: 'start'; to: string | null; text: string | null }
  | { kind: 'send' }
  | { kind: 'drop' }

/**
 * Send is never reached by a correction (21.3), so every form the recogniser writes is here as
 * heard: the polite plural "saadake" and the "we" form "saadame" (round 3, 23.2).
 */
const SEND = new Set([
  'saada', 'saada ära', 'saada sõnum', 'saada see', 'saadake', 'saadake ära', 'saadake sõnum', 'saadame', 'saadame ära',
  'send', 'send it', 'send the message', 'send message',
])
const DROP = new Set([
  'katkesta sõnum',
  'loobu sõnumist',
  'tühista sõnum',
  'cancel the message',
  'cancel message',
  'drop the message',
  'discard the message',
])

/** "Kirjuta Marile, et ..." and "write to Mari that ...": a recipient and the text in one breath. */
const ONE_BREATH_ET = /^\s*(?:kirjuta|saada)\s+(?:sõnum\s+)?((?:\p{L}+\s+)?\p{L}+le)(?:\s+sõnum)?\s*,?\s+et\s+(.+)$/iu
const ONE_BREATH_EN = /^\s*(?:write to|tell|message)\s+((?:\p{L}+\s+)?\p{L}+)\s*,?\s+that\s+(.+)$/iu

const START_ET = /^(?:(?:kirjuta|uus) sõnum|sõnum|saada sõnum)(?: ((?:\p{L}+ )?\p{L}+le))?$/u
const START_ET_BARE = /^kirjuta ((?:\p{L}+ )?\p{L}+le)(?: sõnum)?$/u
const START_EN = /^(?:(?:write|send|new) (?:a )?message(?: to)?|message)(?: (\p{L}+(?: \p{L}+)?))?$/u

/** F1 (30.3): words said before a name that are never the first of a two-word name. */
export const FILLERS: ReadonlySet<string> = new Set(['siis', 'ja', 'aga', 'nüüd', 'palun', 'kohe', 'ka'])
/** F1: what after a filler makes the utterance dictation: the allative pronouns and the verbs ending in "-le". */
export const NOT_A_NAME: ReadonlySet<string> = new Set(['mulle', 'sulle', 'talle', 'meile', 'teile', 'neile', 'endale', 'tule', 'mõtle', 'kuule', 'vaatle'])

/**
 * F1 (30.3): the Estonian recipient as spoken, without a leading filler word ("palun Marile" is
 * "Marile"). Null when the word after the filler is a pronoun or a verb: "kirjuta siis mulle" is
 * dictation, not a chat with "Siis Mul". A real two-word name is returned as it is.
 */
export function recipientFromSpoken(spoken: string): string | null {
  const words = spoken.trim().split(/\s+/)
  const [first, second] = words
  if (words.length !== 2 || first === undefined || second === undefined || !FILLERS.has(first.toLowerCase())) return spoken
  return NOT_A_NAME.has(second.toLowerCase()) ? null : second
}

function capitalise(word: string): string {
  return word.charAt(0).toLocaleUpperCase() + word.slice(1)
}

/**
 * The name to send to the extension. Estonian: the last word loses its allative "-le"
 * (Marile, Mari; Jaanile, Jaani). A stem that changes (Märdile, Märdi, not Mart) is left to the
 * extension's fuzzy match, which may not find it. English: as heard.
 */
export function nameFromSpoken(spoken: string, lang: Lang): string {
  const words = spoken.trim().split(/\s+/).filter(Boolean)
  const last = words.at(-1)
  if (lang === 'et' && last !== undefined && last.length > 3 && last.toLowerCase().endsWith('le')) {
    words[words.length - 1] = last.slice(0, -2)
  }
  return words.map((word) => capitalise(word.toLowerCase())).join(' ')
}

/** Dictated words as a sentence: trimmed, a capital first letter, a full stop unless it already ends. */
export function asSentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed === '') return ''
  const capital = capitalise(trimmed)
  return /[.!?…]$/.test(capital) ? capital : `${capital}.`
}

export function messageCommand(text: string): MessageCommand | null {
  const et = ONE_BREATH_ET.exec(text)
  if (et?.[1] && et[2]) {
    const to = recipientFromSpoken(et[1])
    return to === null ? null : { kind: 'start', to: nameFromSpoken(to, 'et'), text: asSentence(et[2]) }
  }
  const en = ONE_BREATH_EN.exec(text)
  if (en?.[1] && en[2]) return { kind: 'start', to: nameFromSpoken(en[1], 'en'), text: asSentence(en[2]) }

  const clean = normalise(text)
  if (clean === '') return null
  if (SEND.has(clean)) return { kind: 'send' }
  if (DROP.has(clean)) return { kind: 'drop' }

  const start = START_ET.exec(clean) ?? START_ET_BARE.exec(clean)
  if (start) {
    const to = start[1] ? recipientFromSpoken(start[1]) : undefined
    if (to === null) return null
    return { kind: 'start', to: to !== undefined ? nameFromSpoken(to, 'et') : null, text: null }
  }
  const startEn = START_EN.exec(clean)
  if (startEn) {
    // "message" alone is too little to act on.
    if (clean === 'message') return null
    return { kind: 'start', to: startEn[1] ? nameFromSpoken(startEn[1], 'en') : null, text: null }
  }
  return null
}
