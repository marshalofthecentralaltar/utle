import type { IntentChain } from './pageIntent.ts'

/**
 * Round 4: one breath may hold many goals, and a pause need not break a chain. The words that
 * join one goal to the next, shared by the speech side (the hold after them, the continuation
 * before them), the rules (a text ending with one is never instant) and the engine (the strip's
 * chain line, the first goal of a plan). Pure.
 */

/** How long a final that ends with a connective is held for the next one, instead of the normal hold. */
export const CONNECTIVE_HOLD_MS = 2500

/** A final may continue the utterance delivered this recently when it starts with a connective. */
export const CONTINUE_WINDOW_MS = CONNECTIVE_HOLD_MS

/** Words that end a part and promise another: "mine whatsappi ja", "ava Karin siis". Longest first. */
const TRAILING = ['pärast seda', 'ja siis', 'and then', 'after that', 'seejärel', 'siis', 'ning', 'then', 'ja']
/** Words that open a continuation of what was just said: "siis ava Karin". A bare "ja" is too common to count. */
const LEADING = ['pärast seda', 'ja siis', 'seejärel', 'siis', 'then']

const tidy = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim()

/** True when the text ends with a connective and has words before it. */
export function endsWithConnective(text: string): boolean {
  const clean = tidy(text)
  return TRAILING.some((word) => clean.length > word.length && clean.endsWith(` ${word}`))
}

/** True when the text starts with a connective and has words after it. */
export function startsWithConnective(text: string): boolean {
  const clean = tidy(text)
  return LEADING.some((word) => clean.length > word.length && clean.startsWith(`${word} `))
}

/** Trailing commas, connectives and spaces, so "mine whatsappi ja siis " becomes "mine whatsappi". */
function trimTail(text: string): string {
  let out = text.trim().replace(/[\s,.;:…]+$/u, '')
  for (;;) {
    const before = out
    for (const word of TRAILING) {
      const re = new RegExp(`\\s${word.replace(' ', '\\s+')}$`, 'iu')
      out = out.replace(re, '')
    }
    out = out.replace(/[\s,.;:…]+$/u, '')
    if (out === before) return out
  }
}

const escape = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where the words of `part` begin in `text`, whatever the case and the punctuation between them; -1 when absent. */
function wordsAt(text: string, part: string): number {
  const words = tidy(part).split(' ').filter((w) => w !== '')
  if (words.length === 0) return -1
  const re = new RegExp(`(?<![\\p{L}\\p{N}'])${words.map(escape).join("[^\\p{L}\\p{N}']+")}(?![\\p{L}\\p{N}'])`, 'iu')
  return text.search(re)
}

/**
 * The goal the model's first action served, when the answer carried a plan: the utterance up to
 * where the first planned goal begins, in his words. When the plan is not in his words (the model
 * paraphrased), the model's say; with none, the whole utterance.
 */
export function firstGoal(utterance: string, plan: readonly string[], say: string): string {
  const next = plan[0]
  if (next !== undefined) {
    const at = wordsAt(utterance, next)
    if (at > 0) {
      const head = trimTail(utterance.slice(0, at))
      if (head !== '') return head
    }
  }
  if (say.trim() !== '') return say.trim()
  return utterance.trim()
}

/** The strip's chain line: "2/4 · ava Karini viimane sõnum". */
export function chainLine(chain: IntentChain): string {
  const n = chain.completed.length + 1
  const total = n + chain.remaining.length
  return `${n}/${total} · ${chain.goal}`
}
